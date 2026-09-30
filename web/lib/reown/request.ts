import {
  decodeFunctionData,
  encodeAbiParameters,
  isAddress,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import {
  PolicyModule,
  type ExecutionCallV2,
  type PolicyV2,
} from "../intentV2.ts";

export const BASE_SEPOLIA_CAIP2 = "eip155:84532";

export const INTENTLOCK_WALLETKIT_METHODS = [
  "eth_sendTransaction",
] as const;

export const INTENTLOCK_WALLETKIT_EVENTS = [
  "accountsChanged",
  "chainChanged",
] as const;

export const erc20WalletKitAbi = parseAbi([
  "function transfer(address to,uint256 amount) returns (bool)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

export type WalletConnectRequestInput = {
  chainId: string;
  method: string;
  params: unknown;
};

export type ClassifiedWalletRequest =
  | {
      kind: "transfer";
      module: typeof PolicyModule.Transfer;
      token: Address;
      recipient: Address;
      amount: bigint;
    }
  | {
      kind: "approval";
      module: typeof PolicyModule.Approval;
      token: Address;
      spender: Address;
      amount: bigint;
    };

function quantity(value: unknown, field: string): bigint {
  if (value === undefined || value === null) return 0n;

  if (
    typeof value !== "string" ||
    !/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(value)
  ) {
    throw new Error(`${field} is not a valid Ethereum quantity`);
  }

  const parsed = BigInt(value);

  if (parsed < 0n) {
    throw new Error(`${field} cannot be negative`);
  }

  return parsed;
}

function transactionObject(params: unknown): Record<string, unknown> {
  if (
    !Array.isArray(params) ||
    params.length !== 1 ||
    !params[0] ||
    typeof params[0] !== "object"
  ) {
    throw new Error(
      "eth_sendTransaction must contain exactly one transaction object",
    );
  }

  return params[0] as Record<string, unknown>;
}

/**
 * Convert a WalletConnect eth_sendTransaction request into IntentLock's
 * canonical ExecutionCallV2 format.
 */
export function normalizeWalletConnectRequest(
  request: WalletConnectRequestInput,
  account: Address,
): ExecutionCallV2 {
  if (request.chainId !== BASE_SEPOLIA_CAIP2) {
    throw new Error(
      `Unsupported chain ${request.chainId}; IntentLock WalletKit currently supports Base Sepolia only`,
    );
  }

  if (request.method !== "eth_sendTransaction") {
    throw new Error(
      `Unsupported method ${request.method}; only eth_sendTransaction is enabled`,
    );
  }

  const tx = transactionObject(request.params);

  if (typeof tx.from !== "string" || !isAddress(tx.from)) {
    throw new Error("Transaction from address is missing or invalid");
  }

  if (tx.from.toLowerCase() !== account.toLowerCase()) {
    throw new Error(
      "WalletConnect transaction does not originate from the configured IntentLock account",
    );
  }

  if (typeof tx.to !== "string" || !isAddress(tx.to)) {
    throw new Error("Transaction target is missing or invalid");
  }

  const data = tx.data ?? "0x";

  if (
    typeof data !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(data)
  ) {
    throw new Error("Transaction calldata is invalid");
  }

  return {
    target: tx.to as Address,
    value: quantity(tx.value, "value"),
    data: data as Hex,
    operation: 0,
  };
}

/**
 * WalletKit MVP deliberately supports only well-understood ERC20 actions.
 * Unknown selectors never fall through to arbitrary execution.
 */
export function classifyWalletConnectCall(
  call: ExecutionCallV2,
): ClassifiedWalletRequest {
  if (call.value !== 0n) {
    throw new Error(
      "Native-value WalletConnect transactions are not enabled yet",
    );
  }

  let decoded: ReturnType<typeof decodeFunctionData>;

  try {
    decoded = decodeFunctionData({
      abi: erc20WalletKitAbi,
      data: call.data,
    });
  } catch {
    throw new Error(
      "Unsupported calldata; WalletKit MVP supports ERC20 transfer() and approve() only",
    );
  }

  if (decoded.functionName === "transfer") {
    const args = decoded.args;

    if (!Array.isArray(args) || args.length !== 2) {
      throw new Error("Invalid ERC20 transfer() arguments");
    }

    const [recipient, amount] = args;

    if (
      typeof recipient !== "string" ||
      !isAddress(recipient) ||
      typeof amount !== "bigint"
    ) {
      throw new Error("Invalid ERC20 transfer() arguments");
    }

    return {
      kind: "transfer",
      module: PolicyModule.Transfer,
      token: call.target,
      recipient,
      amount,
    };
  }

  if (decoded.functionName === "approve") {
    const args = decoded.args;

    if (!Array.isArray(args) || args.length !== 2) {
      throw new Error("Invalid ERC20 approve() arguments");
    }

    const [spender, amount] = args;

    if (
      typeof spender !== "string" ||
      !isAddress(spender) ||
      typeof amount !== "bigint"
    ) {
      throw new Error("Invalid ERC20 approve() arguments");
    }

    return {
      kind: "approval",
      module: PolicyModule.Approval,
      token: call.target,
      spender,
      amount,
    };
  }

  throw new Error(
    "Unsupported ERC20 action; only transfer() and approve() are enabled",
  );
}

/**
 * Generate an exact IntentLock V2 policy from the decoded WalletConnect call.
 *
 * This is intentionally restrictive:
 * - requested token is fixed
 * - recipient/spender is fixed
 * - requested amount is the maximum
 * - transfer requires the recipient to receive the requested amount
 * - approval cannot leave an allowance above the requested amount
 */
export function buildExactWalletConnectPolicy(
  request: ClassifiedWalletRequest,
): PolicyV2 {
  if (request.kind === "transfer") {
    return {
      module: PolicyModule.Transfer,

      assets: [
        {
          token: request.token,
          maxSpend: request.amount,
          recipient: request.recipient,
          minReceive: request.amount,
          minFinalBalance: 0n,
        },
      ],

      allowances: [],

      nativeConstraint: {
        maxSpend: 0n,
        minFinalBalance: 0n,
      },

      moduleData: encodeAbiParameters(
        parseAbiParameters(
          "address,address,uint256,bool,address,bytes4",
        ),
        [
          request.token,
          request.recipient,
          request.amount,
          false,
          request.token,
          "0xa9059cbb",
        ],
      ),
    };
  }

  return {
    module: PolicyModule.Approval,

    assets: [],

    allowances: [
      {
        token: request.token,
        spender: request.spender,
        maxFinalAllowance: request.amount,
      },
    ],

    nativeConstraint: {
      maxSpend: 0n,
      minFinalBalance: 0n,
    },

    moduleData: encodeAbiParameters(
      parseAbiParameters(
        "address,address,uint256,bool",
      ),
      [
        request.token,
        request.spender,
        request.amount,
        false,
      ],
    ),
  };
}
