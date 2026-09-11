import assert from "node:assert/strict";
import test from "node:test";
import { buildPaymentIntent, parsePaymentRequired } from "./adapter.ts";
import { hashX402Evidence } from "./evidence.ts";
import { evaluateX402Policy } from "./policy.ts";
import type { X402PaymentRequired, X402RiskInput } from "./types.ts";

const account = "0x4423D32fE243D06D7F025Ef4855BC24185704168" as const;
const agent = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const token = "0x0929e7B83466A0BB6A3dBff58d3624A3C8b65368" as const;
const recipient = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const other = "0xf6F454F3c28559d4E06b5106EF1fd32921a834e0" as const;
const zero = `0x${"00".repeat(32)}` as const;
const now = 1_789_000_000n;

function payment(overrides: Partial<X402PaymentRequired["accepts"][number]> = {}): X402PaymentRequired {
  return { x402Version: 2, resource: { url: "https://api.example.com/wallet-analysis" }, accepts: [{ scheme: "exact", network: "eip155:84532", amount: "50000", asset: token, payTo: recipient, maxTimeoutSeconds: 60, ...overrides }] };
}
function policy() { return { allowedDomains: ["api.example.com"], allowedMethods: ["GET"] as const, allowedChainId: 84532n, allowedToken: token, allowedRecipients: [recipient], maxAmount: 100000n, sessionBudgetRemaining: 150000n, now }; }
function evaluate(required = payment(), risk: X402RiskInput = { decision: "ALLOW", evidenceUsable: true }) { return evaluateX402Policy(buildPaymentIntent(parsePaymentRequired(required), "GET", 0, now), policy(), risk); }

test("parses a valid x402 v2 exact requirement and allows it with usable risk evidence", () => {
  const intent = buildPaymentIntent(parsePaymentRequired(payment()), "GET", 0, now);
  assert.equal(intent.serviceDomain, "api.example.com");
  assert.equal(intent.amount, 50000n);
  assert.equal(evaluate().decision, "ALLOW");
});
test("rejects malformed requirements and unsupported payment schemes", () => {
  assert.throws(() => parsePaymentRequired({ x402Version: 2, resource: {}, accepts: [] }));
  assert.throws(() => parsePaymentRequired(payment({ scheme: "upto" as "exact" })));
});
test("blocks unsupported chain, token, domain, recipient, amount, and expired requirement", () => {
  assert.equal(evaluate(payment({ network: "eip155:1" })).decision, "BLOCK");
  assert.equal(evaluate(payment({ asset: other })).decision, "BLOCK");
  assert.equal(evaluate({ ...payment(), resource: { url: "https://unapproved.example/paid" } }).decision, "BLOCK");
  assert.equal(evaluate(payment({ payTo: other })).decision, "BLOCK");
  assert.equal(evaluate(payment({ amount: "100001" })).decision, "BLOCK");
  const expired = buildPaymentIntent(parsePaymentRequired(payment({ maxTimeoutSeconds: 1 })), "GET", 0, now);
  assert.equal(evaluateX402Policy({ ...expired, validUntil: now }, policy(), { decision: "ALLOW", evidenceUsable: true }).decision, "BLOCK");
});
test("preserves Graph/CRE escalation and fails closed on unusable evidence", () => {
  assert.equal(evaluate(payment(), { decision: "ESCALATE", evidenceUsable: true }).decision, "ESCALATE");
  assert.equal(evaluate(payment(), { decision: "BLOCK", evidenceUsable: false }).decision, "BLOCK");
});
test("evidence binding is deterministic and changes with recipient, amount, or request", () => {
  const first = buildPaymentIntent(parsePaymentRequired(payment()), "GET", 0, now);
  const binding = { account, agent, nonce: 1n, callsHash: first.requestHash, policyHash: zero };
  const hash = hashX402Evidence(first, binding, "ALLOW");
  assert.equal(hashX402Evidence(first, binding, "ALLOW"), hash);
  const changedRecipient = buildPaymentIntent(parsePaymentRequired(payment({ payTo: other })), "GET", 0, now);
  assert.notEqual(hashX402Evidence(changedRecipient, { ...binding, callsHash: changedRecipient.requestHash }, "ALLOW"), hash);
  const changedAmount = buildPaymentIntent(parsePaymentRequired(payment({ amount: "50001" })), "GET", 0, now);
  assert.notEqual(hashX402Evidence(changedAmount, { ...binding, callsHash: changedAmount.requestHash }, "ALLOW"), hash);
});
