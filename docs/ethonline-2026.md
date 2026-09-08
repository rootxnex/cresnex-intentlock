# ETHOnline 2026 Continuity specification

## Status and scope

This document records work performed on the `ethonline-2026` branch after continuity baseline commit `b5aaed21110a1836724d546b357af95bae23a325`. The V1 and V2 accounts, EIP-712 intent flow, policy modules, outcome containment, evidence, strikes, quarantine, tests, SDK, and dashboard pre-date ETHOnline 2026.

ETHOnline work now includes a project-owned subgraph that indexes real V2 `IntentViolation` events, a successful live Graph Studio deployment and query, and a deterministic fail-closed evaluator. The account contracts remain unchanged. Graph-derived decisions are not yet enforced onchain, and no attestation or Chainlink CRE workflow has been implemented.

## Verified Base Sepolia deployment

| Field | Verified value |
| --- | --- |
| Network | Base Sepolia |
| Chain ID | `84532` |
| V2 account | `0x4423D32fE243D06D7F025Ef4855BC24185704168` |
| V2 creation transaction | `0xb6f649f528206152b2604606ccf8fde67bced5ba1d23da5e37f7b427356548d8` |
| V2 start block | `46426662` |
| Owner | `0xEDa2435282D178a5A9c8c001793b1857Fef84E28` |
| Phase4PolicyValidator | `0xdea973338cEF48A1Cc7E0d6Fad9E8Fac5F199f7b` |
| Smoke test | Passed |

The subgraph starts at the actual V2 creation block, `46426662`. It deliberately does not use the deployment manifest's generic stack start block, `46426645`.

## Live Graph deployment and evidence

| Field | Verified value |
| --- | --- |
| Graph Studio subgraph | `cresnex-intent-lock-agent-risk-base-sepolia` |
| Studio version | `v0.1.0` |
| Indexed network | Base Sepolia |
| Indexing health | `_meta.hasIndexingErrors = false` |
| Observed freshness | Indexed near the contemporaneous Base Sepolia chain head |

The live qualification path indexed a real V2 violation with matching onchain and Graph evidence:

| Field | Verified value |
| --- | --- |
| Transaction | `0x1ab7f7a000da3e71293c48db84c4e363bb541fbb3f86df6aeac5c88214fa2679` |
| Block | `46470151` |
| Intent digest | `0xf60531b6345b18b63a29977f8ea9c766e0d8750a527f72d5d1c0ffe02b54fa98` |
| Evidence hash | `0x4bd9a6accc413bef1ec8e4e7dee93410ed5e0a6cfe44e8b49fccf0d66b3d872a` |
| Violation code | `3` / `WrongRecipient` |
| Policy module | `0` / `Transfer` |
| Strike count | `1` |
| Quarantined | `false` |
| Graph lifetime violation count | `1` |

This proves the live zero-to-one transition. It does not demonstrate three or more live violations.

## Indexed signal

The subgraph indexes only:

```text
IntentViolation(bytes32,address,uint8,uint8,bytes32,uint256,bool)
```

This event represents an authenticated policy violation classified by the V2 account. The emitting account address and block/transaction/log metadata come from the event context. The subgraph does not index `ExecutionFailed`; ordinary target failures do not count. Authentication failures revert without emitting `IntentViolation` and therefore do not count.

The signal means only:

> recent indexed IntentLock policy violations

It does **not** mean:

> safe agent

It is not cross-protocol or universal reputation. It covers only the explicit IntentLock deployments listed as subgraph data sources.

## Deterministic decision rule

The evaluator counts an exact agent's indexed `IntentViolation` events in the preceding 24 hours:

| Recent violations | Decision |
| ---: | --- |
| 0 | `ALLOW` |
| 1–2 | `ESCALATE` |
| 3 or more | `BLOCK` |

`ESCALATE` never silently becomes `ALLOW`. The evaluator is implemented in `web/lib/graphRisk.ts` and unit-tested in `web/lib/graphRisk.test.ts`.

## Graph query

The query supplies the lowercase agent address as `Bytes!` and a Unix timestamp equal to evaluation time minus 24 hours as `BigInt!`.

```graphql
query AgentRecentViolations($agent: Bytes!, $windowStart: BigInt!) {
  violations(
    first: 3
    where: { agent: $agent, timestamp_gte: $windowStart }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    account
    intentDigest
    evidenceHash
    code
    module
    strikeCount
    quarantined
    blockNumber
    blockHash
    timestamp
    transactionHash
    logIndex
  }
  agent(id: $agent) {
    id
    lifetimeViolationCount
    lastViolationBlock
    lastViolationTimestamp
  }
  _meta {
    block {
      number
      hash
    }
    hasIndexingErrors
  }
}
```

Fetching only three recent records is sufficient to distinguish the three planned decisions. Lifetime count is informational and does not replace the 24-hour query.

## Trust assumptions

The current evidence path trusts:

- the public subgraph manifest, schema, and mapping logic;
- the explicitly listed IntentLock deployment addresses and start blocks;
- The Graph indexer's faithful processing of canonical Base Sepolia events;
- the Graph response metadata used to assess freshness; and
- the deterministic evaluator's response validation and decision boundaries.

The account owner and existing signed policy remain trusted as described in the main threat model. The agent, external targets, browser input, stale responses, and caller-supplied evidence remain untrusted.

## Freshness and fail-closed behavior

Live validation observed the Studio deployment indexing near the contemporaneous Base Sepolia chain head. The earlier proposal of a permanent 100-block maximum lag remains unfinalized; the evaluator instead accepts an explicit maximum allowed lag from its caller so the policy can be selected from measured behavior.

Missing, malformed, stale, future-block, or indexing-error Graph data fails closed to `BLOCK`. `_meta.hasIndexingErrors` must be false, `_meta.block` must be present, and violation timestamps must fall within the exact 24-hour window. The evaluator does not itself provide an onchain enforcement path.

## Indexing limitations

- The subgraph indexes one verified V2 account; no second account is invented.
- Events before the configured start block are outside the data source.
- Events from unlisted IntentLock deployments are invisible.
- Indexing necessarily lags the chain head.
- Chain reorganizations may temporarily change recent query results.
- A new agent address has no linked history.
- Harm outside indexed IntentLock accounts is not represented.
- A policy that permits a harmful result may produce no violation event.
- The subgraph cannot observe authentication failures because they emit no qualifying event.

## False positives and false negatives

False positives can arise when a correctly contained test, an overly strict owner policy, or an operational mistake produces a real `IntentViolation`. The query therefore returns the underlying records, uses a rolling window, and distinguishes escalation from blocking.

False negatives can arise when an agent rotates addresses, acts outside indexed deployments, exploits an overly permissive signed policy, or acts more recently than the indexer's current head. The signal must never be described as proof that an agent is benign.

## Qualification boundary

Hackathon qualification uses live Base Sepolia events returned by the deployed subgraph. Mocked or static Graph responses support unit tests, but they do not demonstrate the sponsor integration. Live subgraph deployment, live query validation, and deterministic evaluation are complete; attestation, Chainlink CRE, and onchain enforcement remain separate, unimplemented review gates. This is an unaudited research prototype for testnet use, not a production-ready reputation or enforcement system.
