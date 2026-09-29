# IntentLock evidence collection

Source commit: 361743f6d7d595caa4cf20ecc1c4d916856a353f

Branch: paper-experiments-2026

Status: correctness gate collected; NOT a publication dataset.

Failed checks: coverage

Continuation: `forge coverage --ir-minimum` also failed during compilation
with a Yul stack-depth exception. Both complete failure logs are retained.
No contract or compiler configuration was changed to bypass this gate.

Recorded correctness results: 378 Forge tests passed, 0 failed; separate
fuzz rerun 79 passed, 0 failed; separate invariant rerun 17 passed, 0 failed;
SDK 2 passed, 0 failed. Reruns overlap the full suite and are not independent
scenario counts. Format, build, gas report, snapshot, frontend lint,
typecheck and build each exited successfully in the original collection.

Source inventory additions: `system/intent-schema.json`,
`system/policy-modules.json`, `system/test-source-inventory.json`.
Regenerate these in a new artifact tree using `scripts/paper-source-inventory.py`;
the script refuses to overwrite existing files. These are declarations, not
benchmark results or proof of coverage.

GitHub plugin confirmed repository identity `rootxnex/cresnex-intentlock`.
No remote branch, commit, issue, or pull request was changed.

Measured scenarios: 0. Benchmark executions: 0.

MISSING: frozen experiment implementation commit; source property audit; corpus; baseline experiments; per-transaction gas; latency; security metrics; paired statistics; atomic containment measurements; publication tables and figures; testnet validation.

Existing Forge test gas is test-function gas, not publication transaction gas. No expected outcomes have been substituted for observations. See logs/check-results.json and complete logs for the correctness gate. Environment captures include uncommitted infrastructure.
