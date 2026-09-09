import Image from "next/image";
import { IntentBuilder } from "@/components/IntentBuilder";
import { WalletButton } from "@/components/WalletButton";
import { AccountConsole } from "@/components/AccountConsole";
import { ExecutionSimulator } from "@/components/ExecutionSimulator";
import { V2IntentLab } from "@/components/V2IntentLab";
import { V2EvidenceTimeline } from "@/components/V2EvidenceTimeline";
import { ResearchResults } from "@/components/ResearchResults";
import { V2AccountConsole } from "@/components/V2AccountConsole";
import { ProtectionStatus } from "@/components/ProtectionStatus";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SecurityOverview } from "@/components/SecurityOverview";

export default function Home() {
  return (
    <main>
      <nav><a className="brand" href="#overview" aria-label="Cresnex IntentLock overview"><Image className="brand-logo" src="/brand/cresnex-intentlock-logo.png" width={38} height={38} priority alt="" /><span>Cresnex <b>IntentLock</b></span></a><div className="navlinks"><a href="#overview">Overview</a><a href="#v2-builder">Intent</a><a href="#risk">Risk</a><a href="#v2-events">Evidence</a><a href="#research">Research</a></div><div className="nav-actions"><ThemeToggle /><WalletButton /></div></nav>
      <header className="hero">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="hero-copy" id="overview"><div className="eyebrow"><span className="live-dot" />ETHOnline 2026 · Security research</div><h1>Cresnex <span>IntentLock</span></h1><p>Security and outcome enforcement for autonomous onchain agents.</p><div className="hero-actions"><a className="primary link" href="#v2-builder">Build signed intent</a><a className="secondary link" href="#risk">Inspect risk controls</a></div></div>
        <ProtectionStatus />
      </header>
      <section className="pipeline" aria-label="Primary security pipeline">
        {[["✎","Signed Intent","Owner-authorized execution context"],["◇","The Graph Risk","Live indexed policy violations"],["◈","Chainlink CRE Verdict","Fresh, deterministic risk decision"],["✓","IntentLock Enforcement","Risk gate plus existing policy checks"]].map(([icon,title,copy], index) => <div className="pipeline-card" key={title}><span className="pipeline-icon" aria-hidden="true">{icon}</span><div><small>0{index + 1}</small><strong>{title}</strong><p>{copy}</p></div>{index < 3 && <i aria-hidden="true">→</i>}</div>)}
      </section>
      <section className="status-bento" aria-label="System deployment status">
        {[["Base Sepolia V2","LIVE","live","◉"],["The Graph Risk Index","LIVE","live","◇"],["CRE Risk Evaluation","SIMULATION READY","simulation","◈"],["CRE Consumer","TESTED / NOT DEPLOYED","tested","✓"],["CRE-Gated V3","TESTED / NOT DEPLOYED","tested","✓"],["Live CRE Workflow","PENDING ACCESS","pending","◷"]].map(([title,status,tone,icon]) => <article className={`status-card ${tone}`} key={title}><span className="status-icon" aria-hidden="true">{icon}</span><div><h2>{title}</h2><span className={`status-badge ${tone}`}>{status}</span></div></article>)}
      </section>
      <SecurityOverview />
      <section className="support-grid">
        <article className="dashboard-card continuity"><span className="kicker">ETHOnline 2026</span><h2>Continuity</h2><div><strong>Pre-existing</strong><p>IntentLock V1/V2 signed policy enforcement, isolation, evidence, strikes, and quarantine.</p></div><div><strong>Built during ETHOnline</strong><p>The Graph risk indexing, Chainlink CRE evaluation, RiskVerdict, CRE consumer, and V3 risk gate.</p></div></article>
        <article className="dashboard-card deployment"><span className="kicker">Verified public state</span><h2>Deployment Status</h2><dl><div><dt>Network</dt><dd>Base Sepolia</dd></div><div><dt>V2 / Graph</dt><dd><span className="status-badge live">LIVE</span></dd></div><div><dt>CRE</dt><dd><span className="status-badge simulation">SIMULATION READY</span></dd></div><div><dt>Consumer / V3</dt><dd>NOT DEPLOYED</dd></div><div><dt>Workflow</dt><dd>PENDING DEPLOY ACCESS</dd></div><div><dt>Forwarder</dt><dd title="0xF8344CFd5c43616a4366C34E3EEE75af79a74482">0xF8344C…a74482 · official</dd></div><div><dt>Forwarder delivery</dt><dd>NOT YET PROVEN</dd></div></dl></article>
      </section>
      <V2AccountConsole />
      <AccountConsole />
      <section className="grid">
        <section className="panel decision-card allowed"><div className="panel-number">01 — CONTAINMENT</div><div className="eyebrow">Persistent response</div><h2>Rollback the harm.<br/>Keep the signal.</h2><div className="agent"><div className="avatar">AI</div><div><strong>Authenticated agent</strong><code>unsafe nested effects → atomic revert</code></div><span className="badge">✓ EVIDENCE SURVIVES</span></div><div className="strikebar"><i/><i/><i/></div><p className="muted">A valid but unsafe attempt consumes its nonce and adds a strike. Authentication mistakes revert without punishment.</p></section>
        <ExecutionSimulator />
      </section>
      <IntentBuilder />
      <V2IntentLab />
      <V2EvidenceTimeline />
      <div id="research"><ResearchResults /></div>
      <section className="comparison"><div className="comparison-intro"><div className="eyebrow">Academic evaluation</div><h2>Path is not outcome.</h2><p>Calling an approved target does not guarantee an approved financial result.</p></div><div className="compare-grid"><article><span>CONTROL / A</span><strong>Checks where</strong><p>Path-only validation can miss harmful results produced by an allowed target.</p><div className="compare-mark bad">PATH ≠ SAFETY</div></article><article className="highlight"><span>CONTROL / B</span><strong>Checks what happened</strong><p>IntentLock measures final state, reverts unsafe effects, and preserves evidence outside.</p><div className="compare-mark good">OUTCOME BOUND</div></article></div><p className="demo-note">Conceptual comparison. Generate measured gas and experiment results from the included test plan.</p></section>
      <footer><a className="brand" href="#"><Image className="brand-logo footer-logo" src="/brand/cresnex-intentlock-logo.png" width={36} height={36} alt="" /><span>Cresnex IntentLock</span></a><span>Web3 security research · Testnet only · Not audited</span><a href="#builder">Return to intent lab ↑</a></footer>
    </main>
  );
}
