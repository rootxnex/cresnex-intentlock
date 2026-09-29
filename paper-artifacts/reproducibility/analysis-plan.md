# Preregistered analysis rules (no measurements)

This package contains no execution dataset and calculates no security proportions.
Future analyses must freeze applicability and expected labels before execution.
Unit-test pass counts, repeated fuzz invocations and hash vectors are not scenario counts.

Use one unique (run_id, scenario_id, baseline, repetition) execution key. Exclude
NOT_APPLICABLE rows from applicable denominators. Keep infrastructure/unknown/resource
failures visible as invalid/unresolved; never silently remove them or count them as blocks.
Report both enrolled and evaluable denominators and invalidate an aggregate if unresolved
rows prevent interpreting it. Target-revert cases are reliability controls unless a
separate, justified violating-intent label was preregistered; a revert alone is not a block.

IVBR = correct scenario-specific security rejections / applicable violating transactions.
LCR = observed successful legitimate completions / applicable legitimate transactions.
FPR = legitimate intents rejected by security checks / applicable legitimate transactions.
FNR = violating intents accepted / applicable violating transactions. Because target,
resource and unknown failures exist, FNR is not automatically 1-IVBR; LCR+FPR need not be 1.
EPR = durable stored evidence for blocked authenticated policy violations / applicable
blocked authenticated policy violations. Authentication failures and target reverts are
outside this denominator. A nonzero failure hash is insufficient evidence persistence.
QE = correctly rejected post-quarantine attempts / applicable post-quarantine attempts.
PALR = N/A unless unauthorized value has a defensible common unit and full state accounting.
Report numerator, denominator, exclusions, unresolved count and Wilson 95% interval.
Wilson intervals characterize the chosen corpus, not a population of real-world attacks.

Preserve paired scenario IDs and compare only shared applicable workload/meaningful paths.
McNemar may use exact binomial discordant-pair counts with an effect size (paired difference),
but deterministic variants from the same template are not independent threat observations.
Repeated latency samples are clustered within scenario; do not inflate categorical N.
Gas is receipt gas for the measured transaction, excluding deployment/fixture transactions;
report intrinsic/calldata cost and EVM settings. Inner failure can occur in a status=1 receipt.
Never substitute Forge test-function gas or eth_estimateGas for receipt gas.
Gas summaries: N, mean, sample SD (N>1), median, Q1/Q3 (linear interpolation), IQR,
P95 (linear interpolation), min, max. Compare matched successful execution paths separately
from authentication rejection, policy rollback and target failure.
Overhead is paired absolute and relative gas difference; failed/successful paths are not
interchangeable. Do not compare V2 batch with multiple baseline transactions as one path.
Time with a host monotonic clock around the declared local RPC/receipt interval, separating
setup and readback; record warmups, repetitions, ordering, machine load and clock resolution.
This is local runtime/RPC latency, not consensus latency or Base Sepolia confirmation time.
Paired nonparametric inference needs independent scenario pairs and a prespecified statistic;
when template dependence invalidates that assumption use descriptive paired effects only.

No p-values, intervals, overheads or charts are generated without validated raw observations.
The same immutable dataset hash must appear in every generated table and figure provenance.
