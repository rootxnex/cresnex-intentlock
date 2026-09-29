# Continuation provenance

The original source commit is `361743f6d7d595caa4cf20ecc1c4d916856a353f` on
`paper-experiments-2026`. The GitHub plugin read confirmed that commit in
`rootxnex/cresnex-intentlock`; no remote resource was changed.

The original logs, environment capture and snapshot remain in their original
locations. The rerun in `../runs/continuation-20260929/` uses an explicitly recorded
Foundry fuzz seed. Repeated test invocations overlap and must not be added into
an independent scenario count. Original Node output reports two test-file units,
not a count of all internal assertions or test cases.

The first hash-parity attempt failed when the sandbox prohibited a localhost
listener. A permitted retry used a temporary localhost Anvil, passed 48 comparisons
over 16 shared vectors, and stopped the node. Its environment, inputs and all
comparison rows are retained in `hash-parity-local/`. These observations establish
finite cross-language hash agreement only; they are excluded from benchmark N,
security proportions, gas and latency. Execution fields cannot be reconstructed
from this hash-only run.

An independent source review checked P1–P20 references and corrected quarantine
threshold semantics, pre-signature quarantine classification, and narrow
reentrancy/self-call test claims. Tests were inspected for assertions; their names
were not accepted as proof. No contract, baseline, test assertion or access-control
rule was changed.

Public-testnet read attempts and their errors are under `../deployment/`.
The initial DNS restriction and the retry's HTTP 403 are network failures, not
evidence of a contract or testnet failure. No public-chain transaction was sent.
