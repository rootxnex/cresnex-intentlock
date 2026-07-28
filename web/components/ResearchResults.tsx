import { accountV2Address, deploymentV2Block } from "@/lib/contracts";

const results = [
  { system: "A / Signature only", benign: "80,319", attack: "81,825", outcome: "Harm survived" },
  { system: "B / Spend limit", benign: "79,902", attack: "81,892", outcome: "Harm survived" },
  { system: "C / Path + spend", benign: "81,007", attack: "82,931", outcome: "Harm survived" },
  { system: "D / IntentLock v2", benign: "135,939", attack: "223,004", outcome: "Contained + evidence" },
];

export function ResearchResults() {
  return (
    <section className="panel comparison" id="research-results">
      <div className="comparison-intro">
        <div className="panel-number">PHASE 6 / MEASURED</div>
        <div className="eyebrow">Thirty-run Foundry experiment</div>
        <h2>Deployment and research results</h2>
        <p>Wrong-recipient transfers survive the three minimal baselines. IntentLock rolls them back and persists a strike-backed evidence hash.</p>
      </div>
      <div className="policy">
        <span>Configured v2 account <strong>{accountV2Address ?? "Not configured"}</strong></span>
        <span>Deployment block <strong>{deploymentV2Block > 0n ? deploymentV2Block.toString() : "Not configured"}</strong></span>
        <span>Network target <strong>Local Anvil / Base Sepolia only</strong></span>
      </div>
      <div className="compare-grid">
        {results.map((result) => <article className={result.system.startsWith("D") ? "highlight" : ""} key={result.system}>
          <span>{result.system}</span>
          <strong>{result.outcome}</strong>
          <p>Benign mean gas {result.benign}<br />Wrong-recipient mean gas {result.attack}</p>
        </article>)}
      </div>
      <p className="demo-note">Forge test-function gas, not Base Sepolia receipt gas. Conventional mock ERC-20; 30 fresh-fixture trials per row. No latency claim.</p>
    </section>
  );
}
