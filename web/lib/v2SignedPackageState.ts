import type { Address, Hex } from "viem";
import { hashCallsV2, hashPolicyV2, type SignedIntentPackageV2 } from "./intentV2.ts";

export type SignedPackageSnapshot = {
  agent: Address;
  nonce: bigint;
  callsHash: Hex;
  policyHash: Hex;
  callTarget: Address;
  callValue: bigint;
  calldata: Hex;
  moduleName: string;
  recipient: Address | null;
  validAfter: number;
  validUntil: number;
};

export function packageCanonicalHashesMatch(value: SignedIntentPackageV2): boolean {
  return hashCallsV2(value.calls) === value.manifest.callsHash
    && hashPolicyV2(value.policy) === value.manifest.policyHash;
}

export function signedPackageSnapshot(value: SignedIntentPackageV2): SignedPackageSnapshot {
  const firstCall = value.calls[0];
  if (!firstCall) throw new Error("Signed package has no calls");
  return {
    agent: value.manifest.agent,
    nonce: value.manifest.nonce,
    callsHash: value.manifest.callsHash,
    policyHash: value.manifest.policyHash,
    callTarget: firstCall.target,
    callValue: firstCall.value,
    calldata: firstCall.data,
    moduleName: value.moduleName,
    recipient: value.policy.assets[0]?.recipient ?? null,
    validAfter: value.manifest.validAfter,
    validUntil: value.manifest.validUntil,
  };
}

export function canUseSignedPackage(value: SignedIntentPackageV2 | null, signatureStale: boolean): boolean {
  return value !== null && !signatureStale && packageCanonicalHashesMatch(value);
}
