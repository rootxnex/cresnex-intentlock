import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";

export type ExecutionCall = { target: Address; value: bigint; data: Hex };

const callTypeHash = keccak256(
  new TextEncoder().encode("ExecutionCall(address target,uint256 value,bytes data)"),
);

export function hashCalls(calls: ExecutionCall[]): Hex {
  const hashes = calls.map((call) =>
    keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32,address,uint256,bytes32"), [
        callTypeHash,
        call.target,
        call.value,
        keccak256(call.data),
      ]),
    ),
  );
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256,bytes32[]"), [BigInt(calls.length), hashes]),
  );
}

export const intentTypes = {
  IntentManifest: [
    { name: "account", type: "address" },
    { name: "agent", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "callsHash", type: "bytes32" },
    { name: "inputToken", type: "address" },
    { name: "maxInputAmount", type: "uint256" },
    { name: "outputToken", type: "address" },
    { name: "minOutputAmount", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "approvalToken", type: "address" },
    { name: "approvalSpender", type: "address" },
    { name: "maxFinalAllowance", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "validAfter", type: "uint48" },
    { name: "validUntil", type: "uint48" },
    { name: "allowBatch", type: "bool" },
  ],
} as const;

