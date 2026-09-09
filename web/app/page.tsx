import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WalletButton } from "@/components/WalletButton";

const pipeline = [
  ["01", "Signed Intent", "Owner-authorized execution context"],
  ["02", "The Graph Risk", "Live indexed policy violations"],
  ["03", "Chainlink CRE Verdict", "Fresh, deterministic risk decision"],
  ["04", "IntentLock Enforcement", "Risk gate plus existing policy checks"],
];

export default function Home() {
  return <main className="landing-shell">
    <nav><a className="brand" href="#top"><Image className="brand-logo" src="/brand/cresnex-intentlock-logo.png" width={38} height={38} priority alt="" /><span>Cresnex <b>IntentLock</b></span></a><div className="navlinks"><a href="#architecture">Architecture</a><a href="#status">Status</a><a href="#continuity">Continuity</a></div><div className="nav-actions"><ThemeToggle /><WalletButton /><Link className="primary link nav-launch" href="/app">Open app</Link></div></nav>
    <header className="hero landing-hero" id="top"><div className="hero-backdrop" aria-hidden="true" /><div className="hero-copy"><div className="eyebrow"><span className="live-dot" />ETHOnline 2026 · Security research</div><h1>Cresnex <span>IntentLock</span></h1><p>Security and outcome enforcement for autonomous onchain agents.</p><div className="hero-actions"><Link className="primary link" href="/app">Open security console</Link><a className="secondary link" href="#architecture">See how it works</a></div></div></header>
    <section className="landing-section" id="architecture"><div className="section-heading"><span className="kicker">Enforcement pipeline</span><h2>One decision path. Multiple fail-closed checks.</h2><p>An exact owner-signed intent is evaluated against live indexed behavior before IntentLock applies its existing onchain policies.</p></div><div className="pipeline">{pipeline.map(([number,title,copy], index) => <article className="pipeline-card" key={title}><span className="pipeline-index">{number}</span><div><strong>{title}</strong><p>{copy}</p></div>{index < 3 && <i aria-hidden="true">→</i>}</article>)}</div></section>
    <section className="landing-section" id="status"><div className="section-heading"><span className="kicker">Public evidence</span><h2>System status</h2></div><article className="dashboard-card system-summary"><div><span className="status-dot live" /><span>Base Sepolia V2</span><strong>LIVE</strong></div><div><span className="status-dot live" /><span>The Graph</span><strong>LIVE</strong></div><div><span className="status-dot simulation" /><span>Chainlink CRE</span><strong>WORKING IN SIMULATION</strong></div><div><span className="status-dot pending" /><span>Live CRE workflow</span><strong>PENDING DEPLOY ACCESS</strong></div></article><p className="status-disclosure">CRE Consumer and CRE-gated V3 are tested but not deployed. Real KeystoneForwarder delivery is not yet proven.</p></section>
    <section className="landing-section continuity-section" id="continuity"><div className="section-heading"><span className="kicker">Continuity Track</span><h2>What existed, and what changed</h2></div><div className="support-grid"><article className="dashboard-card continuity"><h3>Pre-existing</h3><p>IntentLock V1/V2 signed policy enforcement, isolation, evidence, strikes, and quarantine.</p></article><article className="dashboard-card continuity"><h3>Built during ETHOnline</h3><p>The Graph risk indexing, Chainlink CRE evaluation and RiskVerdict reporting, CRE consumer, and V3 risk gate.</p></article></div><Link className="secondary link" href="/app">Explore the operational app</Link></section>
    <footer><a className="brand" href="#top"><Image className="brand-logo footer-logo" src="/brand/cresnex-intentlock-logo.png" width={36} height={36} alt="" /><span>Cresnex IntentLock</span></a><span>Web3 security research · Testnet only · Not audited</span><Link href="/app">Open app →</Link></footer>
  </main>;
}
