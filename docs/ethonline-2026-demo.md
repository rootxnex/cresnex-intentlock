# ETHOnline 2026 demo and submission evidence

## Three-minute video script

**0:00–0:20 — Problem.** A valid signature proves authorization, not that an autonomous action produces a safe financial outcome.

**0:20–0:45 — Existing IntentLock V2.** Show the owner-signed policy, isolated execution, measured postconditions, rollback, persistent evidence, strikes, and quarantine. Label this as pre-existing Continuity work.

**0:45–1:15 — The Graph.** Show the live Base Sepolia V2 data source and real indexed `IntentViolation`. Run the rolling 24-hour query. Explain that the current result may be zero because the proven violation aged out; the rule uses current data rather than a staged score.

**1:15–1:45 — Chainlink CRE.** Run local workflow simulation with a specific intent binding. Show CRE's Graph HTTP request, Base Sepolia head check, `runtime.now()`, deterministic decision, evidence hash, `runtime.report()`, and simulated `EVMClient.writeReport()`.

**1:45–2:15 — V3 enforcement.** Show tests proving only a fresh, correctly bound `ALLOW` can be consumed. State plainly that the consumer, V3, and workflow await live deployment access; do not present simulator addresses as deployments.

**2:15–2:40 — Security.** Demonstrate tests for wrong binding, stale/malformed/indexing-error evidence, wrong workflow identity, replay, and downstream rollback. CRE `ALLOW` is necessary but all original IntentLock policy checks still run.

**2:40–3:00 — Continuity.** Show the baseline commit and branch disclosure, summarize what existed before ETHOnline, and list the Graph/CRE/V3 work built during the event.

## ETHGlobal draft

**Project:** Cresnex IntentLock

**Tagline:** Security and outcome enforcement for autonomous onchain agents.

**Description:** Cresnex IntentLock lets an owner authorize an autonomous agent with an EIP-712 intent bound to exact calls, policy, account, chain, nonce, and validity. Existing IntentLock execution isolates external calls, measures final outcomes, rolls back policy violations, and preserves discipline evidence. During ETHOnline 2026, a project-owned The Graph subgraph turns real Base Sepolia `IntentViolation` events into a narrow rolling 24-hour behavioral signal. A Chainlink CRE workflow independently queries that signal, verifies index freshness against the chain head, fails closed, and builds an execution-bound `RiskVerdict`. A separately versioned V3 requires a consumable `ALLOW` report before it runs every existing IntentLock policy check.

**Technologies:** Solidity, Foundry, OpenZeppelin, EIP-712, The Graph, Chainlink CRE, Base Sepolia, TypeScript, Next.js, viem, wagmi.

**Continuity disclosure:** V1/V2, owner-signed intents, isolation, policy enforcement, evidence, strikes, quarantine, tests, and the dashboard pre-date ETHOnline 2026. The subgraph, live Graph proof, risk evaluator, CRE workflow/report, report consumer, workflow authentication, V3 gate, and related deployment tooling were built during ETHOnline 2026.

**Prize tracks:** The Graph and Chainlink.

### x402 payment proof

One real Base Sepolia proof transferred `1000` atomic units (`0.001 USDC`) of official Circle USDC from the dedicated payer to the merchant in transaction `0x27aa742192f21bdebd4f60cbbbb05672504141d3de4e6a367ef23d192669c7b0` (block `46724208`). The flow was HTTP `402` → MetaMask/viem EIP-712 authorization → facilitator settlement → HTTP `200`. This does not claim HTTP domain/path enforcement by IntentLock.

## Prize evidence checklist

### The Graph

- [x] Project-owned deployed subgraph
- [x] Explicit Base Sepolia V2 data source and start block
- [x] Real indexed violation with matching transaction/evidence
- [x] Public Graph Studio query endpoint documented
- [x] Rolling 24-hour query and fail-closed evaluator source
- [x] Graph evidence used inside the CRE decision path

### Chainlink

- [x] Official TypeScript CRE project
- [x] Graph HTTP request through CRE
- [x] Deterministic time from `runtime.now()`
- [x] Base Sepolia EVM header/head read
- [x] `runtime.report()` report construction
- [x] `EVMClient.writeReport()` integration and local simulation
- [x] Solidity `onReport` consumer
- [x] Immutable Forwarder plus workflow ID/owner authentication
- [x] V3 verdict gate and adversarial tests
- [ ] CRE deployment access enabled
- [ ] Live workflow deployment ID and hashes captured
- [ ] Real KeystoneForwarder delivery transaction captured
- [ ] First live V3 execution transaction captured

## Evidence capture checklist

- [ ] Final repository commit and public branch
- [ ] Demo video URL
- [ ] Live app URL
- [ ] Graph endpoint and query response
- [ ] V2 violation transaction and block
- [ ] CRE simulation output and hashes
- [ ] Foundry, Bun, TypeScript, lint, and build results
- [ ] Consumer/V3 deployment addresses and receipts, when deployed
- [ ] Workflow identity and deployment evidence, when deployed
- [ ] First report and V3 execution receipts, when deployed
