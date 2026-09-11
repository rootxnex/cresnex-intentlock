"use client";

import { useMemo, useState } from "react";
import { buildPaymentIntent, parsePaymentRequired } from "@/lib/x402/adapter";
import { hashX402Evidence } from "@/lib/x402/evidence";
import { evaluateX402Policy } from "@/lib/x402/policy";
import type { X402PaymentRequired, X402RiskInput } from "@/lib/x402/types";

const account = "0x4423D32fE243D06D7F025Ef4855BC24185704168" as const;
const agent = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const token = "0x0929e7B83466A0BB6A3dBff58d3624A3C8b65368" as const;
const recipient = "0xEDa2435282D178a5A9c8c001793b1857Fef84E28" as const;
const alternativeRecipient = "0xf6F454F3c28559d4E06b5106EF1fd32921a834e0" as const;

type Scenario = "allow" | "amount" | "recipient" | "escalate" | "stale";

function requirement(scenario: Scenario): X402PaymentRequired {
  return {
    x402Version: 2,
    resource: { url: "https://api.example.com/wallet-analysis", description: "Mock paid API resource" },
    accepts: [{ scheme: "exact", network: "eip155:84532", amount: scenario === "amount" ? "250000" : "50000", asset: token, payTo: scenario === "recipient" ? alternativeRecipient : recipient, maxTimeoutSeconds: 60, extra: { name: "mUSDC", mock: true } }],
  };
}

export function X402PaymentSimulator() {
  const [scenario, setScenario] = useState<Scenario>("allow");
  const result = useMemo(() => {
    const now = 1_789_000_000n;
    const intent = buildPaymentIntent(parsePaymentRequired(requirement(scenario)), "GET", 0, now);
    const risk: X402RiskInput = scenario === "escalate"
      ? { decision: "ESCALATE", evidenceUsable: true }
      : scenario === "stale"
        ? { decision: "BLOCK", evidenceUsable: false }
        : { decision: "ALLOW", evidenceUsable: true };
    const evaluation = evaluateX402Policy(intent, {
      allowedDomains: ["api.example.com"], allowedMethods: ["GET"], allowedChainId: 84532n,
      allowedToken: token, allowedRecipients: [recipient], maxAmount: 100000n,
      sessionBudgetRemaining: 150000n, now,
    }, risk);
    const evidenceHash = hashX402Evidence(intent, { account, agent, nonce: 1n, callsHash: intent.requestHash, policyHash: evaluation.policyHash }, evaluation.decision);
    return { intent, risk, evaluation, evidenceHash };
  }, [scenario]);
  const amount = Number(result.intent.amount) / 1_000_000;
  const allowed = result.evaluation.decision === "ALLOW";

  return <section className="panel x402-simulator" aria-labelledby="x402-title">
    <div className="panel-number">MOCK / NO SETTLEMENT</div>
    <div className="eyebrow">x402 payment adapter</div>
    <h2 id="x402-title">x402 Payment</h2>
    <p className="muted">A mock HTTP 402 requirement is parsed into an IntentLock payment context. This panel creates no payment authorization, signature, or network request.</p>
    <label>Mock scenario<select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)}><option value="allow">Approved request + risk ALLOW</option><option value="amount">Amount exceeds policy</option><option value="recipient">Recipient mismatch</option><option value="escalate">Risk ESCALATE</option><option value="stale">Unavailable risk evidence</option></select></label>
    <dl className="x402-details"><div><dt>Service</dt><dd>{result.intent.serviceDomain}</dd></div><div><dt>Endpoint</dt><dd>{result.intent.resourcePath}</dd></div><div><dt>Scheme / chain</dt><dd>exact · Base Sepolia</dd></div><div><dt>Token / amount</dt><dd>mUSDC · {amount.toFixed(2)}</dd></div><div><dt>Recipient</dt><dd title={result.intent.recipient}>{result.intent.recipient}</dd></div><div><dt>Request hash</dt><dd title={result.intent.requestHash}>{result.intent.requestHash}</dd></div></dl>
    <div className={`x402-verdict ${result.evaluation.decision.toLowerCase()}`}><span>IntentLock evaluation</span><strong>{result.evaluation.decision}</strong><p>{result.evaluation.reason}</p><small>Policy: {allowed ? "PASS" : "FAIL / REVIEW"} · Risk: {result.risk.evidenceUsable ? result.risk.decision : "UNUSABLE → BLOCK"}</small></div>
    <div className="hash"><span>Mock x402 evidence binding</span><code>{result.evidenceHash}</code></div>
    <p className="demo-note">{allowed ? "MOCK PAYMENT AUTHORIZATION ELIGIBLE — no authorization was produced." : "MOCK PAYMENT NOT AUTHORIZED — no authorization was produced."}</p>
  </section>;
}
