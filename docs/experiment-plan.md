# Reproducible experiment plan

Compare four systems: A, an unprotected account; B, a maximum-spend check; C, target/function path validation; and D, Cresnex IntentLock.

Run each system against benign swap, overspend, insufficient output, wrong recipient, excess approval, hidden batch action, replay, expiry and reentrancy cases. Repeat deterministic cases at least 30 times for latency statistics; record the chain/client, compiler, optimizer, machine, commit and timestamp.

Measure attack-blocking rate, benign success rate, false positives, gas, wall-clock latency, rollback success, evidence persistence and quarantine effectiveness. A blocked attack counts only when harmful balances/allowances are unchanged. Do not fill final results from expectations.

## Results template

| System | Scenario | Trials | Accepted | Blocked | False positives | Mean gas | p95 latency | Rollback | Evidence | Quarantine |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A/B/C/D | case | 0 | 0 | 0 | 0 | TBD | TBD | TBD | TBD | TBD |

Commands:

```bash
cd contracts
forge test -vvv
forge test --match-path 'test/fuzz/*'
forge test --match-path 'test/invariant/*'
forge snapshot
```

## Stateful security properties

The invariant handler repeatedly submits authenticated unsafe swaps and approvals, attempts nonce replay, probes a pre-quarantined account and attempts non-owner recovery. It checks:

1. Unsafe execution never changes the protected account input balance or recipient output balance.
2. Unsafe execution never leaves router allowance above the signed cap.
3. A consumed nonce cannot execute again.
4. A quarantined agent cannot successfully execute.
5. A non-owner cannot clear quarantine.
6. Violation evidence and strike accounting remain after the harmful inner frame reverts.

Invariant limitations: the handler uses the conventional mock ERC-20s and router, one agent, one protected token pair and generated values within its bounds. It does not prove correctness for malicious token semantics, arbitrary targets or all possible call graphs.
