import assert from "node:assert/strict";
import test from "node:test";
import {
  hashCallsV2,
  hashPolicyV2,
  parsePackageV2,
  PolicyModule,
  stringifyPackageV2,
  type SignedIntentPackageV2,
  type ExecutionCallV2,
  type PolicyV2,
} from "./intentV2.ts";
import type { Address } from "viem";

const account = "0x0000000000000000000000000000000000000001" as Address;
const recipient = "0x0000000000000000000000000000000000000002" as Address;
const calls: ExecutionCallV2[] = [{ target: account, value: 7n, data: "0x1234", operation: 0 }];
const policy: PolicyV2 = {
  module: PolicyModule.Transfer,
  assets: [{
    token: account,
    maxSpend: 7n,
    recipient,
    minReceive: 0n,
    minFinalBalance: 1n,
  }],
  allowances: [],
  nativeConstraint: { maxSpend: 0n, minFinalBalance: 0n },
  moduleData: "0x" as const,
};

test("v2 canonical hashing remains deterministic", () => {
  assert.equal(hashCallsV2(calls), "0xf5d9acff88dbe4aceff314356a1f252c31aa5b763b2e5457b47cf6a5bd0eefd9");
  assert.equal(hashPolicyV2(policy), "0xc9381f6ab0d9d0e44637c236e9d82e768ba269ad1d4870b3a44b6d6a5d7f0701");
});

test("v2 JSON round trip preserves bigint fields and validates hashes", () => {
  const packageValue: SignedIntentPackageV2 = {
    schemaVersion: 2,
    moduleName: "Token transfer",
    manifest: {
      version: 2,
      account,
      owner: recipient,
      agent: recipient,
      chainId: 31337n,
      callsHash: hashCallsV2(calls),
      policyHash: hashPolicyV2(policy),
      nonce: 9n,
      validAfter: 1,
      validUntil: 2,
      allowBatch: false,
      evidenceMode: 1,
    },
    calls,
    policy,
    ownerSignature: `0x${"11".repeat(65)}`,
  };
  const parsed = parsePackageV2(stringifyPackageV2(packageValue));
  assert.equal(parsed.manifest.nonce, 9n);
  assert.equal(parsed.calls[0].value, 7n);
});

test("v2 import rejects content changed after signing", () => {
  const value = {
    schemaVersion: 2,
    moduleName: "Token transfer",
    manifest: {
      version: 2,
      account,
      owner: recipient,
      agent: recipient,
      chainId: "31337",
      callsHash: hashCallsV2(calls),
      policyHash: hashPolicyV2(policy),
      nonce: "9",
      validAfter: 1,
      validUntil: 2,
      allowBatch: false,
      evidenceMode: 1,
    },
    calls: [{ ...calls[0], value: "8" }],
    policy: JSON.parse(stringifyPackageV2({ policy } as unknown as SignedIntentPackageV2)).policy,
    ownerSignature: `0x${"11".repeat(65)}`,
  };
  assert.throws(() => parsePackageV2(JSON.stringify(value)), /Calls hash does not match/);
});
