import assert from "node:assert/strict";
import test from "node:test";
import { buildPaymentIntent } from "../adapter.ts";
import { buildUnsignedExactAuthorization } from "./authorization.ts";
import { hashLiveX402Binding } from "./binding.ts";
import { BASE_SEPOLIA_USDC, parsePaymentRequiredHeader } from "./requirements.ts";

const account = "0x4423D32fE243D06D7F025Ef4855BC24185704168" as const;
const agent = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const recipient = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" as const;
const nonce = `0x${"11".repeat(32)}` as const;
const zero = `0x${"00".repeat(32)}` as const;
const now = 1_789_000_000n;

function header(overrides: Record<string, unknown> = {}): string {
  return btoa(JSON.stringify({ x402Version: 2, resource: { url: "https://resource.example/weather" }, accepts: [{ scheme: "exact", network: "eip155:84532", amount: "1000", asset: BASE_SEPOLIA_USDC, payTo: recipient, maxTimeoutSeconds: 60, ...overrides }] }));
}

test("parses an official-shaped Base Sepolia v2 PAYMENT-REQUIRED header without signing", () => {
  const parsed = parsePaymentRequiredHeader(header(), "GET", now);
  assert.equal(parsed.intent.chainId, 84532n);
  assert.equal(parsed.intent.token, BASE_SEPOLIA_USDC);
  assert.equal(parsed.intent.amount, 1000n);
});
test("rejects unsupported live network, token, and malformed headers", () => {
  assert.throws(() => parsePaymentRequiredHeader(header({ network: "eip155:1" }), "GET", now));
  assert.throws(() => parsePaymentRequiredHeader(header({ asset: account }), "GET", now));
  assert.throws(() => parsePaymentRequiredHeader("not base64", "GET", now));
});
test("unsigned authorization retains a null signature and an explicit one-time nonce", () => {
  const intent = parsePaymentRequiredHeader(header(), "GET", now).intent;
  const prepared = buildUnsignedExactAuthorization(intent, agent, now, nonce);
  assert.equal(prepared.payload.signature, null);
  assert.equal(prepared.payload.authorization.nonce, nonce);
  assert.equal(prepared.payload.authorization.to, recipient);
});
test("live binding is deterministic and commits to authorization nonce, request amount, recipient, domain, and path", () => {
  const first = parsePaymentRequiredHeader(header(), "GET", now).intent;
  const binding = { account, agent, nonce: 9n, callsHash: zero, policyHash: zero, authorizationNonce: nonce };
  const hash = hashLiveX402Binding(first, binding);
  assert.equal(hashLiveX402Binding(first, binding), hash);
  const changedAmount = parsePaymentRequiredHeader(header({ amount: "1001" }), "GET", now).intent;
  assert.notEqual(hashLiveX402Binding(changedAmount, binding), hash);
  const changedRecipient = parsePaymentRequiredHeader(header({ payTo: account }), "GET", now).intent;
  assert.notEqual(hashLiveX402Binding(changedRecipient, binding), hash);
  const changedPath = buildPaymentIntent({ ...parsePaymentRequiredHeader(header(), "GET", now).required, resource: { url: "https://resource.example/other" } }, "GET", 0, now);
  assert.notEqual(hashLiveX402Binding(changedPath, binding), hash);
  assert.notEqual(hashLiveX402Binding(first, { ...binding, authorizationNonce: `0x${"12".repeat(32)}` }), hash);
  assert.notEqual(hashLiveX402Binding(first, { ...binding, nonce: 10n }), hash);
});
