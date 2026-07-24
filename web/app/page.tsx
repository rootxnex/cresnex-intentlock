import Image from "next/image";
import { IntentBuilder } from "@/components/IntentBuilder";
import { WalletButton } from "@/components/WalletButton";
import { AccountConsole } from "@/components/AccountConsole";
import { ExecutionSimulator } from "@/components/ExecutionSimulator";

export default function Home() {
  return (
    <main>
      <nav><div className="brand"><Image className="brand-logo" src="/brand/cresnex-logo.jpeg" width={42} height={40} priority alt="Cresnex logo" /><span>CRESNEX <i>/</i> <b>INTENTLOCK</b></span></div><div className="navlinks"><a href="#agents">Agents</a><a href="#builder">Intents</a><a href="#events">Evidence</a></div><WalletButton /></nav>
      <header className="hero">
        <div><div className="eyebrow live">Research prototype · Base Sepolia</div><h1>Let agents act.<br/><em>Keep outcomes bounded.</em></h1><p>Enforce owner-approved financial outcomes for autonomous smart wallets. Harmful effects roll back while compact violation evidence survives.</p><div className="hero-actions"><a className="primary link" href="#builder">Build an intent</a><a className="secondary link" href="#events">View evidence</a></div></div>
        <div className="containment">
          <div className="protection-card"><div className="eyebrow">Protection state</div><div className="armed"><span className="status-dot" />ARMED</div><dl><div><dt>Active controls</dt><dd>3</dd></div><div><dt>Unresolved violations</dt><dd>0</dd></div><div><dt>Network</dt><dd>Base Sepolia</dd></div></dl><a href="#agents">View policy engine <span>→</span></a></div>
        </div>
      </header>
      <section className="pipeline" aria-label="Execution pipeline"><span>01 Intent</span><i>→</i><span>02 Verify</span><i>→</i><span>03 Execute</span><i>→</i><span>04 Validate</span></section>
      <AccountConsole />
      <section className="grid">
        <section className="panel decision-card allowed"><div className="eyebrow">Containment</div><h2>Persistent response</h2><div className="agent"><div className="avatar">AI</div><div><strong>Authenticated agent</strong><code>Unsafe nested effects revert atomically</code></div><span className="badge">✓ EVIDENCE SURVIVES</span></div><div className="strikebar"><i/><i/><i/></div><p className="muted">A valid but unsafe attempt consumes its nonce and adds a strike. Authentication mistakes revert without punishment.</p></section>
        <ExecutionSimulator />
      </section>
      <IntentBuilder />
      <section className="comparison"><div><div className="eyebrow">Academic evaluation</div><h2>What changes with outcome binding?</h2></div><div className="compare-grid"><article><span>Path-only validation</span><strong>Checks where</strong><p>Can miss harmful financial results from an allowed target.</p></article><article className="highlight"><span>Cresnex IntentLock</span><strong>Checks what happened</strong><p>Reverts unsafe nested effects and preserves compact evidence outside.</p></article></div><p className="demo-note">Conceptual comparison. Measured gas and experiment results must be generated from the included test plan.</p></section>
      <footer><div className="brand"><Image className="brand-logo footer-logo" src="/brand/cresnex-logo.jpeg" width={36} height={34} alt="" /><span>Cresnex IntentLock</span></div><span>Final-year Web3 security research · Not audited · Not for real assets</span></footer>
    </main>
  );
}
