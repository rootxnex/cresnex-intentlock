# IntentLock evidence tools

These tools collect source and correctness evidence for the unaudited V2 research
implementation. They do not implement the proposed final comparative experiment.
No execution CSV or security metric is synthesized from test names, expected
outcomes, UI data, or preliminary Phase 6 test-function gas.

From a checkout with submodules initialized, install the exact Foundry build in
`toolchain-lock.json`, Node 22.22.2 and npm 10.9.7. Run `npm ci` in `web` using the
committed lockfile. Python 3.10 or later uses only the standard library. Solidity
0.8.26 must be available to Foundry; its actual build metadata is checked. Bun is
recorded if installed but is not required. Installing dependencies is separate
from evidence collection and can require network access.

```bash
bash scripts/reproduce-paper.sh --output /tmp/intentlock-new-collection --hash-parity
```

The output directory must not exist. There is deliberately no overwrite flag;
select a new directory to preserve a frozen collection. The command verifies
tool/dependency versions, captures the environment, runs the requested existing
correctness checks, retries coverage with minimum IR if needed, exports source
declarations and property mappings, and optionally deploys V2 to a temporary
localhost-only Anvil to compare hash functions. It returns nonzero if any required
check fails. Source/configuration tables are generated; performance and security
tables/figures remain explicitly missing without an execution dataset.

The hash check starts Anvil with chain 31337, Cancun and a fixed initial timestamp,
deploys one local account, and reads `hashCalls`, `hashPolicy` and `hashIntent`.
It uses 16 deterministic inputs, including empty arrays and maximum-sized arrays,
for 48 comparisons. These are hash vectors, not executable-policy scenarios;
some deliberately have no valid module shape. No intent is executed. A host
sandbox must allow binding localhost for this optional check. No key or `.env`
file is read. Its outputs are in `reproducibility/hash-parity/`.

Source-only exports can also be added to an existing collection if their target
files do not exist:

```bash
python3 -B scripts/paper/export_audit.py --output paper-artifacts
```

The exporter refuses any overwrite. It checks that cited functions exist in
active source, excluding commented legacy validators. A mapped test is evidence
only for its actual assertions; the scope and property records identify narrow
assertions and missing V2 tests. It does not automatically infer test coverage.

Optional public-testnet validation is separate and strictly read-only:

```bash
python3 -B scripts/paper/validate_deployment.py --output /tmp/base-sepolia-check
```

This pins a public block and records chain ID, bytecode and owner reads where the
RPC is reachable. Optional local broadcast files contribute only sanitized public
metadata; their CREATE mappings can disagree with receipts and are not accepted
as live proof. Explorer links alone are not verification evidence. A clean
checkout may lack the ignored local broadcast files; then receipt provenance is
missing, while address/code/owner checks remain possible. No testnet transaction
is submitted.

Known blocker: `forge coverage` and `forge coverage --ir-minimum` fail to compile
this source with the installed compiler. Original logs are retained. Contracts,
compiler configuration and tests have not been weakened to bypass it. A final
corpus, pilot, transaction-level benchmark, state-reset protocol, semantic
baseline, atomic-containment state table and analysis of raw executions remain
missing. The prospective schema and analysis plan are not results.
