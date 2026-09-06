# ETHOnline 2026 Continuity specification

## Status and scope

This document records work performed on the `ethonline-2026` branch after continuity baseline commit `b5aaed21110a1836724d546b357af95bae23a325`. The V1 and V2 accounts, EIP-712 intent flow, policy modules, outcome containment, evidence, strikes, quarantine, tests, SDK, and dashboard pre-date ETHOnline 2026.

The Phase 1 hackathon addition is a project-owned subgraph that indexes real V2 `IntentViolation` events. Phase 1 does not modify the account contracts, evaluate risk, issue attestations, or enforce Graph results onchain. Those steps remain unimplemented until live indexing is demonstrated and reviewed.

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

## Planned deterministic decision rule

The future evaluator will count an exact agent's indexed `IntentViolation` events in the preceding 24 hours:

| Recent violations | Decision |
| ---: | --- |
| 0 | `ALLOW` |
| 1–2 | `ESCALATE` |
| 3 or more | `BLOCK` |

`ESCALATE` must never silently become `ALLOW`. This rule is documented here but is not implemented in Phase 1.

## Planned query

The evaluator will supply the lowercase agent address as `Bytes!` and a Unix timestamp equal to evaluation time minus 24 hours as `BigInt!`.

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

The eventual decision path will trust:

- the public subgraph manifest, schema, and mapping logic;
- the explicitly listed IntentLock deployment addresses and start blocks;
- The Graph indexer's faithful processing of canonical Base Sepolia events;
- the Graph response metadata used to assess freshness; and
- later evaluator and attestation components, once separately specified and implemented.

The account owner and existing signed policy remain trusted as described in the main threat model. The agent, external targets, browser input, stale responses, and caller-supplied evidence remain untrusted.

## Freshness and fail-closed behavior

The provisional proposal of a 100-block maximum indexing lag is not finalized. Phase 2 must measure actual Base Sepolia lag by comparing `_meta.block.number` with the contemporaneous Base Sepolia RPC head across multiple samples. The measured behavior and chosen safety margin must be documented before any constant is added to application or contract code.

Missing, malformed, stale, or indexing-error Graph data must never produce `ALLOW`. `_meta.hasIndexingErrors` must be false, and `_meta.block` must be present. Until the evaluator and enforcement path exist, the subgraph output is observational only.

## Indexing limitations

- Phase 1 indexes one verified V2 account; no second account is invented.
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

Hackathon qualification must use live Base Sepolia events returned by the deployed subgraph. Mocked or static Graph responses may later support unit tests, but they cannot demonstrate the sponsor integration. Subgraph deployment, live query validation, deterministic evaluation, attestation, and onchain enforcement are separate review gates.
