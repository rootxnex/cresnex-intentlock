import { IntentBuilder } from "@/components/IntentBuilder";
import { WalletButton } from "@/components/WalletButton";
import { AccountConsole } from "@/components/AccountConsole";
import { ExecutionSimulator } from "@/components/ExecutionSimulator";

export default function Home() {
  return (
    <main>
      <nav><div className="brand"><span className="mark">C</span><span>Cresnex <b>IntentLock</b></span></div><div className="navlinks"><a href="#agents">Agents</a><a href="#builder">Intent lab</a><a href="#events">Evidence</a></div><WalletButton /></nav>
      <header className="hero">
        <div><div className="eyebrow live">Research prototype · Base Sepolia</div><h1>Let agents act.<br/><em>Keep outcomes bounded.</em></h1><p>Owner-signed intent before execution. Financial proof after execution. Harmful effects roll back while violation evidence survives.</p><a className="primary link" href="#builder">Build an intent →</a></div>
        <div className="containment">
          <div className="ring"><div><small>Protection state</small><strong>ARMED</strong><span>3 checks active</span></div></div>
          <div className="flow"><span>Authenticate</span><i>→</i><span>Isolate</span><i>→</i><span>Verify outcome</span></div>
        </div>
      </header>
      <AccountConsole />
      <section className="grid">
        <section className="panel"><div className="eyebrow">Containment</div><h2>Persistent response</h2><div className="agent"><div className="avatar">AI</div><div><strong>Authenticated agent</strong><code>Unsafe nested effects revert atomically</code></div><span className="badge">Evidence survives</span></div><div className="strikebar"><i/><i/><i/></div><p className="muted">A valid but unsafe attempt consumes its nonce and adds a strike. Authentication mistakes revert without punishment.</p></section>
        <ExecutionSimulator />
      </section>
      <IntentBuilder />
      <section className="comparison"><div><div className="eyebrow">Academic evaluation</div><h2>What changes with outcome binding?</h2></div><div className="compare-grid"><article><span>Path-only validation</span><strong>Checks where</strong><p>Can miss harmful financial results from an allowed target.</p></article><article className="highlight"><span>Cresnex IntentLock</span><strong>Checks what happened</strong><p>Reverts unsafe nested effects and preserves compact evidence outside.</p></article></div><p className="demo-note">Conceptual comparison. Measured gas and experiment results must be generated from the included test plan.</p></section>
      <footer><div className="brand"><span className="mark">C</span>Cresnex IntentLock</div><span>Final-year Web3 security research · Not audited · Not for real assets</span></footer>
    </main>
  );
}
