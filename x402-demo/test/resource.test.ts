import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC, loadConfig } from "../src/config.ts";
import { createDemoApp } from "../src/payment.ts";

const { buildUnsignedExactAuthorization } = await import("../../web/lib/x402/live/authorization.ts");
const { hashLiveX402Binding } = await import("../../web/lib/x402/live/binding.ts");
const { parsePaymentRequiredHeader } = await import("../../web/lib/x402/live/requirements.ts");
const { evaluateX402Policy } = await import("../../web/lib/x402/policy.ts");

const recipient = "0x1111111111111111111111111111111111111111" as const;
const account = "0x4423D32fE243D06D7F025Ef4855BC24185704168" as const;
const agent = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const zero = `0x${"00".repeat(32)}` as const;
const authNonce = `0x${"11".repeat(32)}` as const;
const now = 1_789_000_000n;

function testConfig(port = 4021) {
  return loadConfig({ X402_DEMO_RECIPIENT: recipient, X402_DEMO_AMOUNT_ATOMIC: "1000", X402_DEMO_PORT: String(port) });
}

test("configuration rejects missing, malformed, and zero recipient values", () => {
  assert.throws(() => loadConfig({ X402_DEMO_AMOUNT_ATOMIC: "1000" }));
  assert.throws(() => loadConfig({ X402_DEMO_RECIPIENT: "0x0000000000000000000000000000000000000000", X402_DEMO_AMOUNT_ATOMIC: "1000" }));
  assert.throws(() => loadConfig({ X402_DEMO_RECIPIENT: recipient, X402_DEMO_AMOUNT_ATOMIC: "0" }));
});

test("unpaid protected resource emits an official v2 402 requirement and no payment header", async () => {
  const app = createDemoApp(testConfig());
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/protected`, { headers: { accept: "application/json" } });
  const encoded = response.headers.get("payment-required");
  assert.equal(response.status, 402);
  assert.ok(encoded);
  assert.equal(response.headers.get("payment-signature"), null);
  const parsed = parsePaymentRequiredHeader(encoded, "GET", now);
  assert.equal(parsed.intent.chainId, 84532n);
  assert.equal(parsed.required.accepts[0].network, BASE_SEPOLIA_NETWORK);
  assert.equal(parsed.intent.token, BASE_SEPOLIA_USDC);
  assert.equal(parsed.intent.amount, 1000n);
  assert.equal(parsed.intent.recipient.toLowerCase(), recipient.toLowerCase());
  assert.equal(parsed.intent.paymentScheme, "exact");
  const unsigned = buildUnsignedExactAuthorization(parsed.intent, agent, now, authNonce);
  assert.equal(unsigned.payload.signature, null);
  const binding = { account, agent, nonce: 1n, callsHash: zero, policyHash: zero, authorizationNonce: authNonce };
  assert.equal(hashLiveX402Binding(parsed.intent, binding), hashLiveX402Binding(parsed.intent, binding));
  const policy = evaluateX402Policy(parsed.intent, {
    allowedDomains: ["127.0.0.1"], allowedMethods: ["GET"], allowedChainId: 84532n,
    allowedToken: BASE_SEPOLIA_USDC, allowedRecipients: [recipient], maxAmount: 1000n,
    sessionBudgetRemaining: 1000n, now,
  }, { decision: "ALLOW", evidenceUsable: true });
  assert.equal(policy.decision, "ALLOW");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
