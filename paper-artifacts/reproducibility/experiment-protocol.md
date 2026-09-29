# Collection protocol

Run `bash scripts/reproduce-paper.sh` from a clean checkout with Python 3,
Foundry, Node/npm and installed web dependencies. The entrypoint refuses to
overwrite any existing paper-artifacts directory. Preserve prior outputs and
use `bash scripts/reproduce-paper.sh --output /tmp/intentlock-evidence-new`
to collect into a new directory.
Dependency installation and version enforcement are not implemented; actual
versions and dependency commit/lockfile hashes are captured for inspection.

This entrypoint currently collects the correctness gate only. It does not
implement a final benchmark. Forge uses repository fixture/fuzz/invariant
configuration, captured verbatim and through forge config. Do not infer a
frozen corpus, fixed fuzz seed, equivalent paired initial state, or local
transaction latency from this collection. Complete stdout and stderr are
retained together per check; exit codes are recorded separately.

Ordinary target failures must be separate from policy violations. An outer
transaction receipt with status success can contain failed isolated execution;
future measurement must decode results/events and read final state. Forge
test-function gas includes fixture/test operations and is preliminary only.

No live network transaction is made. Base Sepolia manifest existence is not
read-only chain verification. No new exploit generator or automated adversarial
execution pipeline is included. No final corpus, effect sizes, security
proportions or confidence intervals are reported without raw measurements.

Coverage continuation: both the default instrumentation and `--ir-minimum`
failed during compilation. See `logs/coverage.log`,
`logs/coverage-ir-minimum.log`, and `logs/coverage-retry.json`. The minimum-IR
retry is a distinct coverage configuration, not a production compiler change.
Publication measurement remains blocked by the requested correctness gate.
