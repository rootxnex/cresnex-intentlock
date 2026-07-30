import Image from "next/image";
import { IntentBuilder } from "@/components/IntentBuilder";
import { WalletButton } from "@/components/WalletButton";
import { AccountConsole } from "@/components/AccountConsole";
import { ExecutionSimulator } from "@/components/ExecutionSimulator";
import { V2IntentLab } from "@/components/V2IntentLab";
import { V2EvidenceTimeline } from "@/components/V2EvidenceTimeline";
import { ResearchResults } from "@/components/ResearchResults";
import { V2AccountConsole } from "@/components/V2AccountConsole";

export default function Home() {
  return (
    <main>
      <nav><a className="brand" href="#" aria-label="Cresnex IntentLock home"><Image className="brand-logo" src="/brand/cresnex-intentlock-logo.png" width={42} height={42} priority alt="" /><span>CRESNEX <i>/</i> <b>INTENTLOCK</b></span></a><div className="navlinks"><a href="#agents">Agents</a><a href="#builder">Intent lab</a><a href="#events">Evidence</a></div><WalletButton /></nav>
      <header className="hero">
        <div className="hero-copy"><div className="eyebrow live">Research prototype · Base Sepolia</div><h1>Let agents act.<br/><em>Keep outcomes bounded.</em></h1><p>Owner-signed financial boundaries for autonomous smart wallets. Unsafe effects roll back. Compact evidence survives.</p><div className="hero-actions"><a className="primary link" href="#builder">Build an intent <span>↗</span></a><a className="secondary link" href="#events">Inspect evidence</a></div><div className="hero-proof"><span>01 / Exact calls</span><span>02 / Measured outcomes</span><span>03 / Persistent response</span></div></div>
        <div className="containment" aria-label="Intent containment model">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="containment-label label-input">OWNER INTENT</div>
          <div className="containment-label label-output">BOUNDED RESULT</div>
          <div className="containment-core"><span className="core-index">IL / 01</span><strong>CONTAIN</strong><small>execute · measure · decide</small></div>
          <div className="protection-chip"><span className="status-dot" /><div><small>Protection state</small><strong>ARMED</strong></div></div>
        </div>
      </header>
      <section className="pipeline" aria-label="Execution pipeline"><span><b>01</b> Intent</span><i>→</i><span><b>02</b> Authenticate</span><i>→</i><span><b>03</b> Isolate</span><i>→</i><span><b>04</b> Measure</span><i>→</i><span><b>05</b> Commit / contain</span></section>
      <V2AccountConsole />
      <AccountConsole />
      <section className="grid">
        <section className="panel decision-card allowed"><div className="panel-number">01 — CONTAINMENT</div><div className="eyebrow">Persistent response</div><h2>Rollback the harm.<br/>Keep the signal.</h2><div className="agent"><div className="avatar">AI</div><div><strong>Authenticated agent</strong><code>unsafe nested effects → atomic revert</code></div><span className="badge">✓ EVIDENCE SURVIVES</span></div><div className="strikebar"><i/><i/><i/></div><p className="muted">A valid but unsafe attempt consumes its nonce and adds a strike. Authentication mistakes revert without punishment.</p></section>
        <ExecutionSimulator />
      </section>
      <IntentBuilder />
      <V2IntentLab />
      <V2EvidenceTimeline />
      <ResearchResults />
      <section className="comparison"><div className="comparison-intro"><div className="eyebrow">Academic evaluation</div><h2>Path is not outcome.</h2><p>Calling an approved target does not guarantee an approved financial result.</p></div><div className="compare-grid"><article><span>CONTROL / A</span><strong>Checks where</strong><p>Path-only validation can miss harmful results produced by an allowed target.</p><div className="compare-mark bad">PATH ≠ SAFETY</div></article><article className="highlight"><span>CONTROL / B</span><strong>Checks what happened</strong><p>IntentLock measures final state, reverts unsafe effects, and preserves evidence outside.</p><div className="compare-mark good">OUTCOME BOUND</div></article></div><p className="demo-note">Conceptual comparison. Generate measured gas and experiment results from the included test plan.</p></section>
      <footer><a className="brand" href="#"><Image className="brand-logo footer-logo" src="/brand/cresnex-intentlock-logo.png" width={36} height={36} alt="" /><span>Cresnex IntentLock</span></a><span>Web3 security research · Testnet only · Not audited</span><a href="#builder">Return to intent lab ↑</a></footer>
    </main>
  );
}
