"use client";

import { useState } from "react";

const binding = [
  ["Account", "0x4423D32fE243D06D7F025Ef4855BC24185704168"],
  ["Chain", "Base Sepolia · 84532"],
  ["Agent", "0xEDa2435282D178a5A9c8c001793b1857Fef84E28"],
  ["Nonce", "202609090001"],
  ["Calls Hash", "0x1111111111111111111111111111111111111111111111111111111111111111"],
  ["Policy Hash", "0x2222222222222222222222222222222222222222222222222222222222222222"],
] as const;

function compact(value: string) {
  return value.startsWith("0x") && value.length > 18
    ? `${value.slice(0, 10)}…${value.slice(-8)}`
    : value;
}

export function SecurityOverview() {
  const [copied, setCopied] = useState("");

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1400);
  }

  return (
    <>
      <section className="overview-grid" id="risk" aria-label="Risk evaluation overview">
        <article className="dashboard-card risk-card">
          <div className="card-heading">
            <div><span className="kicker">Latest verified CRE simulation</span><h2>Agent Risk</h2></div>
            <span className="status-badge allow"><span aria-hidden="true">✓</span> ALLOW</span>
          </div>
          <div className="risk-metrics" role="status" aria-label="Latest verified risk result: allow">
            <div><span>Recent indexed violations</span><strong>0</strong></div>
            <div><span>Window</span><strong>24 hours</strong></div>
            <div><span>Evidence</span><strong className="allow-text">✓ Usable</strong></div>
            <div><span>Indexing lag</span><strong>1 block</strong></div>
          </div>
          <p className="source-line"><span aria-hidden="true">●</span> Source: live The Graph data at simulation time</p>
          <div className="risk-rule" aria-label="Deterministic risk decision rule">
            <div className="rule allow-rule"><span>0 violations</span><strong>ALLOW</strong></div>
            <div className="rule escalate-rule"><span>1–2 violations</span><strong>ESCALATE</strong></div>
            <div className="rule block-rule"><span>3+ violations</span><strong>BLOCK</strong></div>
          </div>
        </article>

        <article className="dashboard-card binding-card">
          <div className="card-heading"><div><span className="kicker">Latest simulation fixture</span><h2>Execution Binding</h2></div><span className="status-badge info"><span aria-hidden="true">↔</span> EXACT CONTEXT</span></div>
          <p>Each CRE verdict is bound to one exact intent context and cannot authorize a different execution.</p>
          <dl className="binding-list">
            {binding.map(([label, value]) => <div key={label}>
              <dt>{label}</dt>
              <dd title={value}>{compact(value)}</dd>
              <button type="button" title={`Copy full ${label}`} aria-label={`Copy full ${label}`} onClick={() => copy(label, value)}>{copied === label ? "Copied" : "Copy"}</button>
            </div>)}
          </dl>
        </article>
      </section>

      <section className="dashboard-card guarantees" aria-labelledby="guarantees-title">
        <div className="card-heading"><div><span className="kicker">Enforcement invariants</span><h2 id="guarantees-title">Security Guarantees</h2></div></div>
        <div className="guarantee-grid">
          {[
            ["Wrong binding", "REJECT", "block"],
            ["Stale Graph evidence", "BLOCK", "block"],
            ["Graph unavailable", "BLOCK", "block"],
            ["ESCALATE", "NO AUTONOMOUS EXECUTION", "escalate"],
            ["BLOCK", "NO AUTONOMOUS EXECUTION", "block"],
            ["CRE rejection", "NONCE NOT CONSUMED", "neutral"],
            ["Verdict replay", "REJECT", "block"],
            ["ALLOW", "POLICY CHECKS STILL RUN", "allow"],
          ].map(([condition, result, tone]) => <div className={`guarantee ${tone}`} key={condition}>
            <span><i aria-hidden="true">{tone === "allow" ? "✓" : tone === "escalate" ? "!" : tone === "block" ? "×" : "→"}</i>{condition}</span>
            <strong>{result}</strong>
          </div>)}
        </div>
      </section>
    </>
  );
}
