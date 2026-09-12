import assert from "node:assert/strict";
import test from "node:test";
import type { SignedIntentPackageV2 } from "./intentV2.ts";
import { hashCallsV2, hashPolicyV2, PolicyModule } from "./intentV2.ts";
import { canUseSignedPackage, packageCanonicalHashesMatch, signedPackageSnapshot } from "./v2SignedPackageState.ts";

const account = "0x4423D32fE243D06D7F025Ef4855BC24185704168" as const;
const agent = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const token = "0x0929e7B83466A0BB6A3dBff58d3624A3C8b65368" as const;
const recipient = "0x0C8700bF8864f4B85b05CDF0BefD14f4b00e720B" as const;
const otherRecipient = "0x80AB2fEd3E5E1076CdEAE06749aAf183E98f0Cd6" as const;
const callData = `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}` as const;

function packageValue(): SignedIntentPackageV2 {
  const calls = [{ target: token, value: 0n, data: callData, operation: 0 as const }];
  const policy = {
    module: PolicyModule.Transfer,
    assets: [{ token, maxSpend: 1n, recipient, minReceive: 0n, minFinalBalance: 0n }],
    allowances: [],
    nativeConstraint: { maxSpend: 0n, minFinalBalance: 0n },
    moduleData: "0x" as const,
  };
  return {
    schemaVersion: 2,
    moduleName: "Token transfer",
    manifest: {
      version: 2,
      account,
      owner: agent,
      agent,
      chainId: 84532n,
      callsHash: hashCallsV2(calls),
      policyHash: hashPolicyV2(policy),
      nonce: 1n,
      validAfter: 100,
      validUntil: 200,
      allowBatch: false,
      evidenceMode: 1,
    },
    calls,
    policy,
    ownerSignature: `0x${"11".repeat(65)}` as const,
  };
}

test("signed package is usable only while current and canonical", () => {
  const value = packageValue();
  assert.equal(packageCanonicalHashesMatch(value), true);
  assert.equal(canUseSignedPackage(value, false), true);
  assert.equal(canUseSignedPackage(value, true), false);
  assert.equal(canUseSignedPackage(null, false), false);
});

test("signed snapshot is immutable package data, not mutable draft data", () => {
  const value = packageValue();
  const snapshot = signedPackageSnapshot(value);
  assert.equal(snapshot.callsHash, value.manifest.callsHash);
  assert.equal(snapshot.policyHash, value.manifest.policyHash);
  assert.equal(snapshot.callTarget, token);
  assert.equal(snapshot.calldata, callData);
  assert.equal(snapshot.recipient, recipient);

  const mutatedDraftRecipient = otherRecipient;
  assert.notEqual(snapshot.recipient, mutatedDraftRecipient);
});

test("recipient, calldata, amount, module, and imported hash mismatches invalidate use", () => {
  const value = packageValue();
  const mutations = [
    { ...value, policy: { ...value.policy, assets: [{ ...value.policy.assets[0], recipient: otherRecipient }] } },
    { ...value, calls: [{ ...value.calls[0], data: `0xa9059cbb${otherRecipient.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}` as const }] },
    { ...value, policy: { ...value.policy, assets: [{ ...value.policy.assets[0], maxSpend: 2n }] } },
    { ...value, policy: { ...value.policy, module: PolicyModule.Approval } },
    { ...value, manifest: { ...value.manifest, callsHash: `0x${"22".repeat(32)}` as const } },
  ];
  for (const changed of mutations) {
    assert.equal(canUseSignedPackage(changed, false), false);
  }
  assert.equal(canUseSignedPackage(value, true), false, "any signed-field edit must set stale state");
  assert.equal(canUseSignedPackage({ ...value, manifest: { ...value.manifest, agent: otherRecipient } }, true), false);
  assert.equal(canUseSignedPackage({ ...value, manifest: { ...value.manifest, nonce: 2n } }, true), false);
});
