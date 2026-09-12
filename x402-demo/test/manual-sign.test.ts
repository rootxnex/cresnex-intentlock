import assert from "node:assert/strict";
import test from "node:test";
import { createMetaMaskSigner, validatePaymentRequired } from "../src/manual-sign.ts";

const valid = () => ({
  x402Version: 2,
  resource: { url: "http://127.0.0.1:4021/protected", description: "IntentLock x402 protected demo resource", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "1000", payTo: "0x80AB2fEd3E5E1076CdEAE06749aAf183E98f0Cd6", maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" } }],
});

test("accepts the reviewed payment requirement", () => assert.doesNotThrow(() => validatePaymentRequired(valid())));
test("rejects wrong x402 version", () => assert.throws(() => validatePaymentRequired({ ...valid(), x402Version: 1 })));
test("rejects multiple accepts entries", () => assert.throws(() => validatePaymentRequired({ ...valid(), accepts: [valid().accepts[0], valid().accepts[0]] })));
test("rejects wrong timeout", () => assert.throws(() => validatePaymentRequired({ ...valid(), accepts: [{ ...valid().accepts[0], maxTimeoutSeconds: 30 }] })));
test("rejects wrong resource metadata", () => assert.throws(() => validatePaymentRequired({ ...valid(), resource: { ...valid().resource, mimeType: "text/plain" } })));
test("rejects missing or wrong EIP-712 asset metadata", () => {
  assert.throws(() => validatePaymentRequired({ ...valid(), accepts: [{ ...valid().accepts[0], extra: undefined }] }));
  assert.throws(() => validatePaymentRequired({ ...valid(), accepts: [{ ...valid().accepts[0], extra: { name: "USD Coin", version: "2" } }] }));
  assert.throws(() => validatePaymentRequired({ ...valid(), accepts: [{ ...valid().accepts[0], extra: { name: "USDC", version: "1" } }] }));
});
test("viem signer adapter forwards typed data to the wallet transport", async () => {
  const calls: unknown[][] = [];
  const provider = { request: async ({ method, params }: { method: string; params?: unknown[] }) => { calls.push([method, params]); return "0x" + "11".repeat(65); } };
  const account = "0x0C8700bF8864f4B85b05CDF0BefD14f4b00e720B" as `0x${string}`;
  const signer = createMetaMaskSigner(provider, account);
  await signer.signTypedData({ domain: { name: "USDC", version: "2", chainId: 84532n, verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }, types: { Permit: [{ name: "value", type: "uint256" }] }, primaryType: "Permit", message: { value: 1000n } });
  assert.equal(calls[0][0], "eth_signTypedData_v4");
});
