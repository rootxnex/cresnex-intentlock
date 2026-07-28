import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

export const PolicyModule = {
  Transfer: 0,
  Swap: 1,
  Approval: 2,
  Batch: 3,
  DeFiDeposit: 4,
  DeFiWithdrawal: 5,
  YieldRebalance: 6,
  TreasuryPayment: 7,
  Payroll: 8,
  Subscription: 9,
  NftPurchase: 10,
  Administration: 11,
} as const;

export type PolicyModule = (typeof PolicyModule)[keyof typeof PolicyModule];

export const policyModuleNames = [
  "Token transfer",
  "Token swap",
  "Token approval",
  "Ordered batch",
  "DeFi deposit",
  "DeFi withdrawal",
  "Yield rebalance",
  "DAO treasury payment",
  "Payroll payment",
  "Subscription payment",
  "NFT purchase",
  "Protocol administration",
] as const;

export type ExecutionCallV2 = {
  target: Address;
  value: bigint;
  data: Hex;
  operation: 0;
};

export type AssetConstraint = {
  token: Address;
  maxSpend: bigint;
  recipient: Address;
  minReceive: bigint;
  minFinalBalance: bigint;
};

export type AllowanceConstraint = {
  token: Address;
  spender: Address;
  maxFinalAllowance: bigint;
};

export type PolicyV2 = {
  module: PolicyModule;
  assets: AssetConstraint[];
  allowances: AllowanceConstraint[];
  nativeConstraint: { maxSpend: bigint; minFinalBalance: bigint };
  moduleData: Hex;
};

export type IntentManifestV2 = {
  version: 2;
  account: Address;
  owner: Address;
  agent: Address;
  chainId: bigint;
  callsHash: Hex;
  policyHash: Hex;
  nonce: bigint;
  validAfter: number;
  validUntil: number;
  allowBatch: boolean;
  evidenceMode: 1;
};

export type SignedIntentPackageV2 = {
  schemaVersion: 2;
  moduleName: string;
  manifest: IntentManifestV2;
  calls: ExecutionCallV2[];
  policy: PolicyV2;
  ownerSignature: Hex;
};

const utf8 = (value: string) => new TextEncoder().encode(value);
const callTypeHash = keccak256(utf8("ExecutionCall(address target,uint256 value,bytes data,uint8 operation)"));
const assetTypeHash = keccak256(
  utf8("AssetConstraint(address token,uint256 maxSpend,address recipient,uint256 minReceive,uint256 minFinalBalance)"),
);
const allowanceTypeHash = keccak256(
  utf8("AllowanceConstraint(address token,address spender,uint256 maxFinalAllowance)"),
);
const policyTypeHash = keccak256(
  utf8("Policy(uint8 module,bytes32 assetsHash,bytes32 allowancesHash,uint256 maxNativeSpend,uint256 minFinalNativeBalance,bytes32 moduleDataHash)"),
);

export const intentTypesV2 = {
  IntentManifest: [
    { name: "version", type: "uint16" },
    { name: "account", type: "address" },
    { name: "owner", type: "address" },
    { name: "agent", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "callsHash", type: "bytes32" },
    { name: "policyHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "validAfter", type: "uint48" },
    { name: "validUntil", type: "uint48" },
    { name: "allowBatch", type: "bool" },
    { name: "evidenceMode", type: "uint8" },
  ],
} as const;

const hashArray = (hashes: Hex[]) =>
  keccak256(encodeAbiParameters(parseAbiParameters("uint256,bytes32[]"), [BigInt(hashes.length), hashes]));

export function hashCallsV2(calls: ExecutionCallV2[]): Hex {
  return hashArray(calls.map((call) => keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,address,uint256,bytes32,uint8"),
    [callTypeHash, call.target, call.value, keccak256(call.data), call.operation],
  ))));
}

export function hashPolicyV2(policy: PolicyV2): Hex {
  const assetsHash = hashArray(policy.assets.map((asset) => keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,address,uint256,address,uint256,uint256"),
    [assetTypeHash, asset.token, asset.maxSpend, asset.recipient, asset.minReceive, asset.minFinalBalance],
  ))));
  const allowancesHash = hashArray(policy.allowances.map((allowance) => keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,address,address,uint256"),
    [allowanceTypeHash, allowance.token, allowance.spender, allowance.maxFinalAllowance],
  ))));
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,uint8,bytes32,bytes32,uint256,uint256,bytes32"),
    [
      policyTypeHash,
      policy.module,
      assetsHash,
      allowancesHash,
      policy.nativeConstraint.maxSpend,
      policy.nativeConstraint.minFinalBalance,
      keccak256(policy.moduleData),
    ],
  ));
}

export function stringifyPackageV2(value: SignedIntentPackageV2): string {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

function bigint(value: unknown, field: string): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`${field} must be an integer`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error(`${field} cannot be negative`);
  return parsed;
}

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${field} is not an address`);
  return value;
}

function hex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) throw new Error(`${field} is not hex`);
  return value as Hex;
}

function bytes32(value: unknown, field: string): Hex {
  const parsed = hex(value, field);
  if (parsed.length !== 66) throw new Error(`${field} is not bytes32`);
  return parsed;
}

export function parsePackageV2(json: string): SignedIntentPackageV2 {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (raw.schemaVersion !== 2) throw new Error("Only schemaVersion 2 packages are accepted");
  const manifest = raw.manifest as Record<string, unknown>;
  const policy = raw.policy as Record<string, unknown>;
  if (!manifest || !policy || !Array.isArray(raw.calls)) throw new Error("Package fields are missing");
  if (!Array.isArray(policy.assets) || !Array.isArray(policy.allowances)) throw new Error("Policy arrays are missing");
  const parsedPolicy: PolicyV2 = {
    module: Number(policy.module) as PolicyModule,
    assets: policy.assets.map((item, index) => {
      const asset = item as Record<string, unknown>;
      return {
        token: address(asset.token, `assets[${index}].token`),
        maxSpend: bigint(asset.maxSpend, `assets[${index}].maxSpend`),
        recipient: address(asset.recipient, `assets[${index}].recipient`),
        minReceive: bigint(asset.minReceive, `assets[${index}].minReceive`),
        minFinalBalance: bigint(asset.minFinalBalance, `assets[${index}].minFinalBalance`),
      };
    }),
    allowances: policy.allowances.map((item, index) => {
      const allowance = item as Record<string, unknown>;
      return {
        token: address(allowance.token, `allowances[${index}].token`),
        spender: address(allowance.spender, `allowances[${index}].spender`),
        maxFinalAllowance: bigint(allowance.maxFinalAllowance, `allowances[${index}].maxFinalAllowance`),
      };
    }),
    nativeConstraint: {
      maxSpend: bigint((policy.nativeConstraint as Record<string, unknown>)?.maxSpend, "native maxSpend"),
      minFinalBalance: bigint(
        (policy.nativeConstraint as Record<string, unknown>)?.minFinalBalance,
        "native minFinalBalance",
      ),
    },
    moduleData: hex(policy.moduleData, "moduleData"),
  };
  if (parsedPolicy.module < 0 || parsedPolicy.module >= policyModuleNames.length) {
    throw new Error("Unknown policy module");
  }
  if (
    parsedPolicy.assets.length > 8 || parsedPolicy.allowances.length > 8
      || raw.calls.length === 0 || raw.calls.length > 16
  ) {
    throw new Error("Package exceeds protocol array bounds");
  }
  const calls = raw.calls.map((item, index) => {
    const call = item as Record<string, unknown>;
    if (Number(call.operation) !== 0) throw new Error(`calls[${index}] uses an unsupported operation`);
    return {
      target: address(call.target, `calls[${index}].target`),
      value: bigint(call.value, `calls[${index}].value`),
      data: hex(call.data, `calls[${index}].data`),
      operation: 0 as const,
    };
  });
  const parsedManifest: IntentManifestV2 = {
    version: 2,
    account: address(manifest.account, "manifest.account"),
    owner: address(manifest.owner, "manifest.owner"),
    agent: address(manifest.agent, "manifest.agent"),
    chainId: bigint(manifest.chainId, "manifest.chainId"),
    callsHash: bytes32(manifest.callsHash, "manifest.callsHash"),
    policyHash: bytes32(manifest.policyHash, "manifest.policyHash"),
    nonce: bigint(manifest.nonce, "manifest.nonce"),
    validAfter: Number(manifest.validAfter),
    validUntil: Number(manifest.validUntil),
    allowBatch: Boolean(manifest.allowBatch),
    evidenceMode: 1,
  };
  if (manifest.version !== 2 || manifest.evidenceMode !== 1) throw new Error("Unsupported manifest configuration");
  if (
    !Number.isSafeInteger(parsedManifest.validAfter) || !Number.isSafeInteger(parsedManifest.validUntil)
      || parsedManifest.validAfter < 0 || parsedManifest.validUntil <= parsedManifest.validAfter
      || parsedManifest.validUntil > 2 ** 48 - 1
  ) throw new Error("Invalid manifest validity window");
  if (calls.length > 1 && !parsedManifest.allowBatch) throw new Error("Batch calls are not enabled");
  if (hashCallsV2(calls) !== parsedManifest.callsHash) throw new Error("Calls hash does not match package contents");
  if (hashPolicyV2(parsedPolicy) !== parsedManifest.policyHash) throw new Error("Policy hash does not match package contents");
  const ownerSignature = hex(raw.ownerSignature, "ownerSignature");
  if (ownerSignature.length !== 132) throw new Error("ownerSignature must be 65 bytes");
  return {
    schemaVersion: 2,
    moduleName: String(raw.moduleName ?? policyModuleNames[parsedPolicy.module]),
    manifest: parsedManifest,
    calls,
    policy: parsedPolicy,
    ownerSignature,
  };
}
