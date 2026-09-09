"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { AccountConsole } from "./AccountConsole";
import { ExecutionSimulator } from "./ExecutionSimulator";
import { IntentBuilder } from "./IntentBuilder";
import { ProtectionStatus } from "./ProtectionStatus";
import { ResearchResults } from "./ResearchResults";
import { SecurityOverview } from "./SecurityOverview";
import { ThemeToggle } from "./ThemeToggle";
import { V2AccountConsole } from "./V2AccountConsole";
import { V2EvidenceTimeline } from "./V2EvidenceTimeline";
import { V2IntentLab } from "./V2IntentLab";
import { WalletButton } from "./WalletButton";

type View = "overview" | "policies" | "activity" | "evidence" | "simulator" | "research";
const views: Array<[View, string]> = [["overview","Overview"],["policies","Policies"],["activity","Activity"],["evidence","Evidence"],["simulator","Simulator"]];

export function IntentLockApp() {
  const [view, setView] = useState<View>("overview");
  const select = (next: View) => { setView(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const title = views.find(([key]) => key === view)?.[1] ?? "Developer details";
  return <main className="app-shell">
    <nav className="app-topbar"><Link className="brand" href="/"><Image className="brand-logo" src="/brand/cresnex-intentlock-logo.png" width={36} height={36} priority alt="" /><span>Cresnex <b>IntentLock</b></span></Link><div className="nav-actions"><ThemeToggle /><WalletButton /></div></nav>
    <div className="app-heading"><div><span className="kicker">Base Sepolia security console</span><h1>{title}</h1></div><ProtectionStatus /></div>
    <nav className="workspace-nav" aria-label="Security console">{views.map(([key,label]) => <button className={view === key ? "active" : ""} type="button" key={key} aria-current={view === key ? "page" : undefined} onClick={() => select(key)}>{label}</button>)}<button type="button" className={view === "research" ? "active developer-tab" : "developer-tab"} onClick={() => select("research")}>Developer details</button></nav>
    <div className="workspace">
      {view === "overview" && <Overview onNavigate={select} />}
      {view === "policies" && <Policies />}
      {view === "activity" && <ScreenHeading kicker="Onchain outcomes" title="Security activity" copy="Allowed executions, contained violations, and target failures from the configured V2 deployment."><V2EvidenceTimeline limit={30} title="Activity timeline" /></ScreenHeading>}
      {view === "evidence" && <Evidence />}
      {view === "simulator" && <Simulator />}
      {view === "research" && <Research />}
    </div>
    <nav className="mobile-nav" aria-label="Mobile security console">{views.slice(0,3).map(([key,label]) => <button className={view === key ? "active" : ""} type="button" key={key} onClick={() => select(key)}>{label}</button>)}<details><summary>More</summary><div>{[["evidence","Evidence"],["simulator","Simulator"],["research","Research"]].map(([key,label]) => <button type="button" key={key} onClick={() => select(key as View)}>{label}</button>)}</div></details></nav>
  </main>;
}

function ScreenHeading({ kicker, title, copy, children }: { kicker: string; title: string; copy: string; children: React.ReactNode }) { return <section><div className="section-heading compact"><span className="kicker">{kicker}</span><h2>{title}</h2><p>{copy}</p></div>{children}</section>; }

function Overview({ onNavigate }: { onNavigate: (view: View) => void }) { return <>
  <section className="overview-priority"><article className="dashboard-card security-state"><div><span className="kicker">Security state</span><h2><span className="status-dot live" />Protection active</h2><p>V2 enforcement is live on Base Sepolia. Existing policy checks remain the final execution boundary.</p></div><button className="primary" type="button" onClick={() => onNavigate("simulator")}>Test intent</button></article><article className="dashboard-card verdict-summary"><span className="kicker">Latest verified simulation</span><strong className="allow-text">ALLOW</strong><p>0 recent indexed violations · evidence usable · 1-block observed lag</p></article><article className="dashboard-card policy-summary"><div className="card-heading"><div><span className="kicker">Policy coverage</span><h2>4 core checks</h2></div><span className="status-badge info">PER INTENT</span></div><ul className="check-list"><li>Spend limit</li><li>Recipient</li><li>Minimum output</li><li>Approval rules</li></ul><button className="text-link" type="button" onClick={() => onNavigate("policies")}>View all policies →</button></article></section>
  <section className="overview-lower"><div><div className="section-heading compact"><span className="kicker">Recent activity</span><h2>Latest onchain outcomes</h2></div><V2EvidenceTimeline limit={3} title="Recent activity" compact /></div><SystemSummary /></section>
  </>; }

function SystemSummary() { return <article className="dashboard-card system-panel"><div className="card-heading"><div><span className="kicker">System status</span><h2>Verified components</h2></div></div><dl className="compact-status"><div><dt>Base Sepolia V2</dt><dd className="allow-text">LIVE</dd></div><div><dt>The Graph</dt><dd className="allow-text">LIVE</dd></div><div><dt>Chainlink CRE</dt><dd>SIMULATION READY</dd></div><div><dt>Consumer / V3</dt><dd>TESTED · NOT DEPLOYED</dd></div><div><dt>Live workflow</dt><dd className="escalate-text">PENDING ACCESS</dd></div></dl></article>; }

function Policies() { const items = [["Spend limit","Maximum input and native value are bounded"],["Recipient allowlist","Execution output is bound to an approved recipient"],["Minimum output","Post-execution asset output must meet its floor"],["Approval policy","Final token allowance cannot exceed its signed cap"],["Batch policy","Call count and ordering are bound by the signed intent"]]; return <ScreenHeading kicker="Owner-defined boundaries" title="Policy status" copy="Review policy families, then open the verified owner consoles only when management is required."><article className="dashboard-card policy-list">{items.map(([title,summary]) => <details key={title}><summary><span><strong>{title}</strong><small>{summary}</small></span><span className="status-badge allow">ENFORCED</span></summary><p>Exact values are part of each owner-signed intent package. IntentLock validates measured post-state before committing execution.</p></details>)}</article><details className="advanced-section"><summary>V2 owner controls</summary><V2AccountConsole /></details><details className="advanced-section"><summary>Legacy V1 controls</summary><AccountConsole /></details></ScreenHeading>; }

function Evidence() { return <ScreenHeading kicker="Technical proof" title="Evidence" copy="Decoded persistent V2 outcomes. Technical density is contained here for deliberate inspection."><V2EvidenceTimeline limit={30} title="V2 evidence timeline" detailed /><details className="advanced-section"><summary>CRE execution binding and fail-closed guarantees</summary><SecurityOverview /></details></ScreenHeading>; }
function Simulator() { return <ScreenHeading kicker="Safe execution workspace" title="Test intent" copy="Build, sign, inspect, and submit an intent without mixing operational controls into the overview."><V2IntentLab /><details className="advanced-section"><summary>Legacy V1 intent workflow</summary><IntentBuilder /><ExecutionSimulator /></details></ScreenHeading>; }
function Research() { return <ScreenHeading kicker="Developer details" title="Research" copy="Measured experiments and protocol-level comparison are isolated from operational state."><ResearchResults /><section className="comparison"><div className="comparison-intro"><div className="eyebrow">Academic evaluation</div><h2>Path is not outcome.</h2><p>Calling an approved target does not guarantee an approved financial result.</p></div><div className="compare-grid"><article><span>CONTROL / A</span><strong>Checks where</strong><p>Path-only validation can miss harmful results produced by an allowed target.</p><div className="compare-mark bad">PATH ≠ SAFETY</div></article><article className="highlight"><span>CONTROL / B</span><strong>Checks what happened</strong><p>IntentLock measures final state, reverts unsafe effects, and preserves evidence outside.</p><div className="compare-mark good">OUTCOME BOUND</div></article></div></section></ScreenHeading>; }
