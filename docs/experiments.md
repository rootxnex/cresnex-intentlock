# Measured Phase 6 experiments

> Cresnex IntentLock is an unaudited research prototype intended only for local development and public testnets. It is not production-ready and must not be used with real assets.

The comparison uses four contracts:

- A: `SignatureOnlyAccount`, which authorizes an agent and validity window but no action or outcome.
- B: `SpendLimitGuardAccount`, which limits a standard transfer amount but not its recipient.
- C: `PathAndSpendGuardAccount`, which binds target, selector, and amount but not recipient or post-state.
- D: `CresnexIntentLockAccountV2`, which binds the call and policy, measures state, contains violations, and persists discipline evidence.

All A–C contracts are intentionally incomplete academic baselines and are never suitable for custody.

## Reproduction

```bash
cd contracts
forge test --match-contract AcademicBaselinesTest --fuzz-runs 30 -vv
```

Each fuzz case starts from a fresh fixture and varies the nonce across 30 runs. The current deterministic results are stored in [JSON](../reports/phase6-experiments.json) and [CSV](../reports/phase6-experiments.csv).

## Result

| System | Benign mean gas | Wrong-recipient mean gas | Harm survived | Evidence | Strike |
|---|---:|---:|---:|---:|---:|
| A Signature-only | 80,319 | 81,825 | yes | no | 0 |
| B Spend-limit | 79,902 | 81,892 | yes | no | 0 |
| C Path + spend | 81,007 | 82,931 | yes | no | 0 |
| D IntentLock v2 | 135,939 | 223,004 | no | yes | 1 |

IntentLock incurs additional gas for policy authentication, isolated execution, measured outcomes, rollback classification, and persistent evidence. This slice demonstrates the wrong-recipient distinction; it is not a claim of universal attack-blocking effectiveness.

## Measurement limitations

These values are Forge test-function gas, not transaction-receipt gas on Base Sepolia. They include comparable harness operations and assertions and omit network latency. The experiment uses a conventional mock ERC-20, one owner, one agent, and one transfer policy. The broader suite separately tests swap, approval, batch, DeFi, payments, NFT, administration, replay, expiry, reentrancy, and quarantine behavior, but this baseline table does not yet provide 30-run A/B/C/D comparisons for every scenario.
