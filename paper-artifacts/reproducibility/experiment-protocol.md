# IntentLock experiment protocol — preparation freeze v1

## Status and checkpoints

- Protocol identifier: `cresnex-intentlock-paper-2026-v1`.
- Research branch: `paper-experiments-2026`.
- Implementation/evidence parent checkpoint: `6c2ca5e31911625b36efdbfe15c029ecf446e7ba`.
- Earlier contract source checkpoint: `361743f6d7d595caa4cf20ecc1c4d916856a353f`.
- Final experiment commit: **MISSING until this preparation work is reviewed and committed**.
- This freezes preparation, pilot, baselines and scenario definitions. It does not authorize or report final corpus execution.
- Coverage is **FAILED-BUT-DOCUMENTED**: default coverage compilation fails with stack depth and `--ir-minimum` fails with a Yul stack-depth exception. Production compiler settings and contract semantics are unchanged.

## Frozen systems

The evaluated implementation is `CresnexIntentLockAccountV2`. Baselines are:

| ID | Contract | Frozen scope |
|---|---|---|
| A | `SignatureOnlyAccount` | Owner authorizes agent, account/chain, nonce and expiry; generic single call. |
| B | `SpendLimitGuardAccount` | Fixed ERC20 transfer with signed token and maximum. |
| C | `PathAndSpendGuardAccount` | One 68-byte call with signed target, selector and maximum. |
| D | `CresnexIntentLockAccountV2` | Complete signed calls/policy package, supported policy modules, post-state checks and containment. |

`SemanticGuardAccount` is **MISSING** and excluded. There is no implementation or neutral common semantic-method specification spanning transfer, approval, swap, batch, freshness and containment. Adding one now would introduce new method and applicability choices after inspecting the comparison. No rows or inferred results are assigned to it.

## Frozen corpus

- Master seed string: `cresnex-intentlock-paper-2026-v1`.
- Exactly 1,000 unique definitions: 200 legitimate and 800 adversarial.
- IDs: `IL26-L-0001` through `IL26-L-0200`; `IL26-A-0001` through `IL26-A-0800`.
- Per-scenario seed: unsigned big-endian integer from the first eight bytes of SHA-256 over `master_seed:scenario_id:workload:mutation_class`.
- Legitimate allocation: transfer 60, approval 30, swap 30, ordered batch 20, replay/freshness 20, outcome/post-state 20, quarantine/containment 20.
- Adversarial allocation is deterministic and near-uniform across all frozen attack classes; generator metadata records exact counts.
- Expected verdict, reason class, property and per-baseline applicability are generated before execution and are immutable benchmark inputs.
- JSON and CSV must pass `scripts/paper/generate_corpus.py --validate` before any final execution.

## Pilot and final separation

The preregistered pilot has 10 scenario concepts × A/B/C/D × one repetition = 40 rows: 27 attempted executions and 13 `NOT_APPLICABLE` rows if infrastructure completes. Pilot data lives only under `paper-artifacts/pilot/` and carries `dataset_role=PILOT_ONLY`. Pilot rows, summaries, gas and latency are excluded from final denominators and publication aggregates. Any harness change requires a new pilot and documented protocol revision.

Final rows will live only under `paper-artifacts/raw/`. No final executions are run in this preparation session. A final runner must refuse to start unless tool versions, correctness checks, corpus validation, pilot validation, clean/frozen experiment commit and output nonexistence all pass.

## Deterministic local chain

- Local Anvil only: chain ID 31337, Cancun hardfork, genesis timestamp `1700000000`.
- Test accounts use the standard Anvil development mnemonic: owner index 0, agent/submitter index 1, recipient index 2 and alternate recipient/thief index 3. No `.env`, public network or real asset is used.
- Measured transactions use timestamp `1700001000`, except preregistered timing progression. Replay prerequisite is mined at `1700000999`; quarantine threshold/violation prerequisites at `1700000998`/`1700000999`.
- Default V2 quarantine threshold is 3. Only the labelled quarantine case sets it to 1 as a preregistered precondition.
- Mock USDC has 6 decimals; mock WETH has 18. Every A/B/C/D account starts with `1,000,000e6` USDC. Account, recipient and thief WETH plus recipient/thief USDC start at 0. Account-to-router allowances start at 0. The mock router holds no reserve: it pulls USDC and mints mock WETH output.

## State reset and equivalence

The harness uses deterministic snapshot/revert plus redeployment:

1. Start fresh Anvil and take a blank-chain snapshot.
2. Before every scenario, revert to that snapshot, immediately create its replacement, and redeploy the complete A/B/C/D plus mock token/router fixture in fixed order.
3. V2 starts with relevant nonces unused, agent strikes 0 and quarantine false.
4. Take a fixture snapshot. Before each paired baseline row, revert to it, immediately take a replacement snapshot, and apply only the preregistered baseline-specific prerequisite.
5. Re-read balances, allowances, nonce state, strikes, quarantine, timestamp/block state and token/router addresses before the measured transaction. Any mismatch is retained as `INFRASTRUCTURE_FAILURE` and excluded from evaluable denominators.

Scenario progression such as replay, repeated violations and post-quarantine rejection occurs within one row from the common fixture. Prerequisite transactions are preserved separately and are not the measured row's gas or latency. Unsupported pairs submit no transaction and use `NOT_APPLICABLE` with null measurements.

## Gas measurement

`gas_used` is Anvil receipt `gasUsed` for the one preregistered measured transaction sent to the baseline entrypoint. It includes intrinsic/calldata and entrypoint execution for that transaction. It excludes deployment, funding, registration, threshold setting, prerequisites, reads and reset. A V2 status-success receipt can contain rejected isolated execution, so classification also requires decoded events/return simulation and final state.

Forge test-function gas, `eth_estimateGas`, deployment gas and prerequisite gas are never publication measurements. Success, authentication revert, policy rollback, target revert and quarantine rejection stay separately classified.

## Local latency measurement

`execution_time_ns` uses Node `process.hrtime.bigint()`. The interval begins immediately before sending the already-signed raw measured transaction to local JSON-RPC and ends when its receipt returns. `execution_time_ms` is nanoseconds divided by 1,000,000.

Deployment, fixture construction, signing, prerequisites, snapshots, post-state reads, classification and file output are excluded. The interval still includes local RPC serialization, Anvil execution/mining and receipt polling; it is not pure EVM time, consensus latency or public-testnet confirmation latency. Repetitions are clustered observations and do not increase unique scenario count.

## Verdict, failure and applicability rules

- Expected labels are frozen before execution; observations never rewrite expectations.
- Receipt status alone is insufficient. Classification uses receipt, decoded events/revert data, relevant simulated return where available and post-state.
- A target revert is `TARGET_REVERT`, not a successful security block unless explicitly preregistered and path provenance proves it.
- Authenticated policy violations, structural/authentication failures, postconditions, target failures, reentrancy, resources and quarantine remain distinct.
- Durable V2 evidence requires a stored `ViolationRecord`; a generic nonzero failure hash is insufficient.
- Absent JSON fields are `null`; CSV uses `NA`.
- `NOT_APPLICABLE` submits no measured transaction and is outside all applicable denominators.

## Invalid runs, exclusions and retries

- Infrastructure, reset, signing, RPC, decoder, schema, resource and unknown failures are retained with raw logs and excluded from evaluable security denominators. Enrolled and evaluable counts are both reported.
- A measured run is never silently retried. For an infrastructure cause, preserve the failed row, correct the harness, increment attempt/run identifiers and rerun the complete affected paired scenario.
- Expected rejection is not a retry reason. Unexpected acceptance/rejection remains the observation.
- No observation is deleted. Any run-level exclusion requires a rule in this protocol or a versioned deviation recorded before analysis.
- Duplicate scenario/baseline/repetition keys, missing receipts, state mismatch, corpus hash mismatch, dirty/unfrozen experiment source or mixed pilot/final paths stop the final run.
- Frozen datasets are immutable. Reruns require a new directory and dataset ID; there is no overwrite flag.

## Analysis gate

The final benchmark, security metrics, statistics, publication tables and figures remain **MISSING** until this package is reviewed and assigned a final experiment commit. `analysis-plan.md` applies only after valid raw observations exist. Preliminary Phase 6 Forge gas, UI examples, hash vectors, pilot rows and Base Sepolia validation are excluded from final results.

## Pilot scenario concept freeze — pre-execution amendment 1

The pilot scenario selection was frozen before creation of the pilot runner and
before any pilot observations existed.

The frozen pilot definition was committed as:

`13deb340fcf2ff393092552fe0c16c585b2c7acb`

Frozen pilot specification:

`paper-artifacts/reproducibility/pilot-scenarios.json`

Frozen pilot specification SHA-256:

`5d48f229feb25712091bc83f857c9a3fe5624fb186bfedf8e4511692f38dc734`

Its definition parent is:

`69f6d10a71270f4d186b598ea3493c89f727e72f`

The preregistered pilot contains exactly 10 scenario concepts evaluated across
implemented baselines A/B/C/D with one repetition, producing 40 enrolled rows:
27 attempted executions and 13 `NOT_APPLICABLE` rows if infrastructure
completes.

The applicability matrix, expected verdicts, reason classes, reason codes and
security properties were validated against the frozen corpus-generation rules
before any pilot execution.

Pilot observations must carry `dataset_role=PILOT_ONLY` and remain excluded
from final security, gas, latency, statistical and publication denominators.

Expected labels and applicability must not be changed after pilot observations
exist. A harness defect requires preservation of the failed run and a complete
new pilot run under the protocol retry rules.

## Deterministic pilot fixture topology — pre-execution amendment 2

Before any pilot scenario observations were created, the deterministic local
fixture topology was fixed as follows.

The owner/deployer uses standard Anvil mnemonic account index 0. The registered
IntentLock agent and measured transaction submitter use index 1. The allowed
recipient uses index 2, the unauthorized recipient/thief uses index 3, the
allowed spender uses index 4, and the unauthorized spender uses index 5.

The complete fixture deployment order is fixed as:

`A -> B -> C -> D -> Mock USDC -> Mock WETH -> Mock Router`

where:

- A is `SignatureOnlyAccount`;
- B is `SpendLimitGuardAccount`;
- C is `PathAndSpendGuardAccount`;
- D is `CresnexIntentLockAccountV2`;
- Mock USDC is `MockERC20("Mock USDC", "mUSDC", 6)`;
- Mock WETH is `MockERC20("Mock WETH", "mWETH", 18)`;
- Mock Router is `MockDexRouter`.

After deployment, the index-1 agent is registered with D. No quarantine
threshold override is applied during the base fixture, so D begins with its
default threshold of 3, zero strikes and `quarantined=false`.

Each A/B/C/D account receives exactly `1,000,000e6` mock USDC. Their mock WETH
balances and USDC allowances to the mock router begin at zero. The allowed
recipient and unauthorized recipient/thief begin with zero USDC and WETH. The
mock router begins with zero USDC and WETH reserves.

Pilot nonces `700001` through `700010` begin unused for every implemented
baseline.

The harness starts from a fresh Cancun Anvil chain with chain ID 31337 and
genesis timestamp 1700000000, takes a blank-chain snapshot, and restores and
replaces snapshots according to the existing experiment reset protocol.

A fixture-only preflight verified deterministic redeployment and generated no
pilot scenario observations. Fixture deployment, funding, registration,
snapshots and verification reads remain excluded from measured gas and latency.

## Pilot prerequisite topology — pre-execution amendment 3

Before any pilot scenario observations were created, prerequisite transaction
topology was fixed to remove ambiguity between fixture setup and measured
execution.

PILOT-05 / baseline A requires one excluded setup transaction before the
measured swap. At timestamp 1700000999, the frozen index-1 agent/submitter uses baseline A
with setup nonce 790005 to execute mock USDC `approve(Mock Router, 1000000)`.
This prerequisite is not a measured observation and its gas and latency are
excluded. The measured PILOT-05/A transaction remains nonce 700005 at timestamp
1700001000 and calls only the mock router swap. The mock router therefore pulls
1000000 USDC successfully and, under `InsufficientOutput`, produces 1999999
mock WETH for the allowed recipient.

PILOT-05 / baseline D requires no excluded allowance setup. Its measured
IntentLock call bundle contains the approval followed by the router swap, so
the approval is part of the measured D execution.

PILOT-07 uses the same signed nonce-700007 transaction for its successful
prerequisite execution and measured replay, as already preregistered.

PILOT-09 / baseline D uses prerequisite nonces 790091 and 790092 for the two
authenticated policy violations at timestamps 1700000998 and 1700000999,
respectively. The measured third violation remains nonce 700009 at timestamp
1700001000.

PILOT-10 / baseline D first sets the quarantine threshold to 1 as an excluded
owner prerequisite, then uses prerequisite nonce 790101 for one authenticated
policy violation at timestamp 1700000999. The measured post-quarantine attempt
remains nonce 700010 at timestamp 1700001000.

All prerequisite transactions are retained separately as setup provenance and
are excluded from measured gas, latency and pilot row denominators. No silent
retry is permitted.
