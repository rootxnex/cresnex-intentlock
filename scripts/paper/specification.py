"""Human-reviewed V2 research specification; no execution outcomes live here."""

ACCOUNT = "contracts/src/CresnexIntentLockAccountV2.sol"
VALIDATOR = "contracts/src/policies/Phase4PolicyValidator.sol"
UNIT = "contracts/test/unit/CresnexIntentLockAccountV2.t.sol"
INVARIANT = "contracts/test/invariant/IntentLockV2Invariant.t.sol"
PHASE4 = "contracts/test/unit/IntentLockV2Phase4.t.sol"
BASELINES = "contracts/test/AcademicBaselines.t.sol"


def reference(path, function):
    return {"file": path, "function": function}


def property_record(number, description, threat, invariant, functions, tests, limitations):
    return {
        "property_id": f"P{number}", "description": description,
        "threat_addressed": threat,
        "precondition": "V2 account, uncompromised owner, standard EVM; supplied constraints and truthful asset reads. Outer transaction has sufficient resources to finish.",
        "expected_invariant": invariant,
        "relevant_contract_functions": [reference(*value) for value in functions],
        "tests": [reference(*value) for value in tests],
        "known_limitations": limitations,
        "status": "SOURCE_SPECIFICATION_NOT_BENCHMARK_RESULT",
    }


PROPERTIES = [
    property_record(1, "Signature authorization integrity", "Unapproved authorization",
                    "Recovered ECDSA signer equals current owner before consuming a nonce.",
                    [(ACCOUNT, "_authenticate"), (ACCOUNT, "hashIntent")], [],
                    "No dedicated V2 wrong-signature regression identified. V1 tests are not V2 evidence. ERC-1271 absent; compromised owner excluded."),
    property_record(2, "Agent binding", "Submission by another actor",
                    "msg.sender equals manifest.agent, is registered, and is not quarantined.",
                    [(ACCOUNT, "_authenticate")], [],
                    "No dedicated V2 wrong-submitter test identified. No separate relayer identity."),
    property_record(3, "Account binding", "Authorization reused across accounts",
                    "manifest.account equals this account; EIP-712 domain also binds verifyingContract.",
                    [(ACCOUNT, "_authenticate"), (ACCOUNT, "hashIntent")], [],
                    "No dedicated V2 cross-account execution regression identified."),
    property_record(4, "Chain/domain separation", "Authorization reused on another chain/domain",
                    "manifest.chainId equals block.chainid; EIP-712 domain uses chain ID, account, name and version.",
                    [(ACCOUNT, "_authenticate"), (ACCOUNT, "hashIntent")],
                    [(UNIT, "testAuthenticationAndMalformedPolicyFailuresDoNotStrikeOrConsumeNonce")],
                    "Existing test checks explicit chain mismatch, not every EIP-712 domain field. Chain IDs need not uniquely identify forks."),
    property_record(5, "Nonce replay resistance", "Reuse of consumed authorization",
                    "Account-global usedNonces rejects reused or owner-cancelled nonce. Authenticated inner failure consumes nonce if outer call finishes.",
                    [(ACCOUNT, "_authenticate"), (ACCOUNT, "executeIntent"), (ACCOUNT, "cancelNonce")],
                    [(UNIT, "testReplayExpiryQuarantineAndOwnerControls"), (INVARIANT, "invariant_ConsumedNonceCannotReplay")],
                    "Outer revert rolls back nonce; map is not per-agent or sequential."),
    property_record(6, "Deadline/freshness enforcement", "Submission outside signed window",
                    "validUntil > validAfter and validAfter <= block.timestamp <= validUntil.",
                    [(ACCOUNT, "_authenticate")], [(UNIT, "testReplayExpiryQuarantineAndOwnerControls")],
                    "V2 expiry covered; dedicated not-yet-valid and exact-endpoint tests not identified. Timestamp is chain time."),
    property_record(7, "Exact call/package integrity", "Package changed after signing",
                    "Computed ordered callsHash and policyHash equal signed manifest fields.",
                    [(ACCOUNT, "hashCalls"), (ACCOUNT, "hashPolicy"), (ACCOUNT, "_authenticate")],
                    [(UNIT, "testBatchBindsOrderAndAggregateOutcome")],
                    "Does not guarantee safe owner intent or unchanged external state; full field mutation matrix missing."),
    property_record(8, "Target/selector integrity", "Deviation from signed or module-authorized path",
                    "Every call target and calldata byte is committed; supported semantic modules additionally restrict paths.",
                    [(ACCOUNT, "hashExecutionCall"), (VALIDATOR, "validateCalls")],
                    [(UNIT, "testTransferBlocksExcessWrongRecipientDifferentTokenAndHiddenBatch")],
                    "Swap validates presence of router, not a universal router ABI allowlist; Batch enforces cardinality, not per-call semantic paths."),
    property_record(9, "Spending-bound enforcement", "Listed asset loss beyond owner bound",
                    "Positive account balance loss for each listed asset and native loss do not exceed supplied maxima.",
                    [(ACCOUNT, "_validateOutcomes"), (VALIDATOR, "_validateTransfer")],
                    [(UNIT, "testNativeTransferEnforcesSpendAndFinalBalance"), (UNIT, "testBatchBindsOrderAndAggregateOutcome")],
                    "Net deltas, not gross flows; only listed assets. Missing/untruthful token accounting is outside guarantee."),
    property_record(10, "Recipient-bound enforcement", "Delivery deviates from owner constraints",
                    "Transfer module checks recipient argument; listed recipient gain must meet minReceive.",
                    [(VALIDATOR, "_validateTransfer"), (ACCOUNT, "_validateOutcomes")],
                    [(UNIT, "testTransferBlocksExcessWrongRecipientDifferentTokenAndHiddenBatch"), (UNIT, "testSwapBlocksOverspendInsufficientOutputWrongRecipientAndUnlimitedApproval")],
                    "minReceive=0 is not a positive receipt guarantee; generic Batch/Swap arguments are not universally decoded."),
    property_record(11, "Allowance-bound enforcement", "Excess final allowance",
                    "Listed token/spender final allowance <= maxFinalAllowance; Approval module also bounds requested amount.",
                    [(VALIDATOR, "_validateApproval"), (ACCOUNT, "_validateOutcomes")],
                    [(UNIT, "testApprovalAllowsBoundedValueAndBlocksWrongSpenderOrExcess"), (UNIT, "testSwapBlocksOverspendInsufficientOutputWrongRecipientAndUnlimitedApproval")],
                    "Final-state bound does not universally cap transient approval; unlisted spenders are not measured."),
    property_record(12, "Minimum-output enforcement", "Listed recipient receives too little",
                    "max(recipientAfter-recipientBefore,0) >= minReceive for every asset constraint.",
                    [(ACCOUNT, "_validateOutcomes")],
                    [(UNIT, "testSwapBlocksOverspendInsufficientOutputWrongRecipientAndUnlimitedApproval")],
                    "Measures declared token units; no independent price or slippage oracle for core swaps."),
    property_record(13, "Ordered-batch integrity", "Signed call order changes",
                    "Hash includes array length and call hashes in order; multi-call also requires allowBatch.",
                    [(ACCOUNT, "hashCalls"), (ACCOUNT, "_authenticate")],
                    [(UNIT, "testBatchBindsOrderAndAggregateOutcome")],
                    "A newly owner-signed order is authorized; target-internal call graphs are not individually signed."),
    property_record(14, "Post-state acceptance enforcement", "Execution completes with unacceptable listed state",
                    "Isolated execution succeeds only after all configured outcome checks finish.",
                    [(ACCOUNT, "executeIsolated"), (ACCOUNT, "_validateOutcomes")],
                    [(UNIT, "testSwapUsesMeasuredDeltasAndAllowanceCap"), (UNIT, "testSwapBlocksOverspendInsufficientOutputWrongRecipientAndUnlimitedApproval")],
                    "ERC20 return value is not itself decoded by generic CALL. Success requires interpretation of intent event/result, not receipt status alone."),
    property_record(15, "Atomic rollback of rejected inner execution", "Nested effects survive rejection",
                    "Inner failure reverts all synchronous nested EVM state changes.",
                    [(ACCOUNT, "executeIntent"), (ACCOUNT, "executeIsolated")],
                    [(UNIT, "testBatchBindsOrderAndAggregateOutcome"), (INVARIANT, "invariant_UnsafeInnerEffectsNeverSurvive")],
                    "Current invariant uses pre-call transfer validation and checks account balance; its name alone does not prove harmful writes occurred then rolled back. No asynchronous guarantee."),
    property_record(16, "Persistence of authenticated violation evidence", "Loss of containment record after inner revert",
                    "Caught PolicyViolation stores violations[evidenceHash] and emits IntentViolation in outer call.",
                    [(ACCOUNT, "executeIntent"), (ACCOUNT, "_decodePolicyViolation")],
                    [(INVARIANT, "invariant_ViolationsStrikeExactlyOnceAndPersistEvidence")],
                    "Invariant checks nonzero returned hash, not full stored-record equivalence. Outer revert/resource exhaustion can discard all evidence."),
    property_record(17, "Strike accounting", "Unauthenticated or ordinary failures unfairly count",
                    "Caught PolicyViolation increments once; authentication failure and ordinary target failure do not increment.",
                    [(ACCOUNT, "executeIntent")],
                    [(UNIT, "testOrdinaryTargetFailureConsumesNonceWithoutStrike"), (INVARIANT, "invariant_InvalidAuthenticationNeverStrikes"), (INVARIANT, "invariant_ViolationsStrikeExactlyOnceAndPersistEvidence")],
                    "uint64 unchecked increment; no exhaustive arithmetic proof. Owner can reset strikes."),
    property_record(18, "Quarantine enforcement", "Agent continues after threshold",
                    "After a new strike, strikes >= current threshold sets quarantine; quarantine flag prevents authentication.",
                    [(ACCOUNT, "executeIntent"), (ACCOUNT, "_authenticate"), (ACCOUNT, "setQuarantineThreshold")],
                    [(UNIT, "testReplayExpiryQuarantineAndOwnerControls")],
                    "Changing threshold does not reconcile existing strike state; unquarantine can clear flag without clearing strikes. Named V2 unit test covers emergency revocation, not threshold progression. Core invariant raises threshold to uint64 max; helper resets containment. Dedicated V2 threshold study missing."),
    property_record(19, "Non-owner cannot clear containment", "Unauthorized recovery",
                    "onlyOwner guards unquarantineAgent, resetAgentStrikes and setQuarantineThreshold.",
                    [(ACCOUNT, "unquarantineAgent"), (ACCOUNT, "resetAgentStrikes"), (ACCOUNT, "setQuarantineThreshold")], [],
                    "Dedicated V2 non-owner recovery regression missing; inherited Ownable behavior is source evidence. Compromised owner excluded."),
    property_record(20, "Ordinary failure classification", "Target failure mistaken for policy violation",
                    "Failed target CALL is wrapped as TargetCallFailed; outer emits ExecutionFailed without policy strike.",
                    [(ACCOUNT, "_boundedCall"), (ACCOUNT, "executeIsolated"), (ACCOUNT, "executeIntent")],
                    [(UNIT, "testOrdinaryTargetFailureConsumesNonceWithoutStrike"), (PHASE4, "testNftLargeReturnDataIsBoundedAndLargeRevertDataIsNonPunitive")],
                    "ExecutionFailed event alone does not prove TARGET_REVERT: other non-policy inner failures share event. Requires trace/known failure provenance. Failure hash is not stored policy evidence."),
]

SCOPE = [
    ("agent authentication", "IMPLEMENTED_PARTIALLY", "_authenticate binds registered msg.sender; dedicated V2 actor-negative test missing."),
    ("relayer behavior", "NOT_APPLICABLE", "No independent relayer API; submitting caller must be the agent."),
    ("front-running/MEV", "NOT_TESTED", "Call/domain/nonce commitments do not establish MEV resistance or stable external prices."),
    ("reentrancy", "IMPLEMENTED_PARTIALLY", "nonReentrant on execution; Phase4 receiver tests show nested calls fail but do not decode guard selector. Receivers also lack agent authorization; guard causality not isolated."),
    ("delegatecall", "IMPLEMENTED_PARTIALLY", "Operation enum only contains Call; invalid ABI enum may fail decoder before UnsupportedOperation. No V2 dedicated operation-negative test identified."),
    ("malicious target", "IMPLEMENTED_AND_TESTED", "Selected router/vault/marketplace mocks only; rollback bounded by synchronous EVM and declared constraints."),
    ("malicious token behavior", "NOT_TESTED", "Core tests use conventional MockERC20; truthful balanceOf/allowance is assumed."),
    ("callback-heavy token", "IMPLEMENTED_PARTIALLY", "NFT receiver callbacks tested; no general ERC777/ERC20 callback corpus."),
    ("fee-on-transfer token", "NOT_TESTED", "No dedicated token fixture or compatibility measurement identified."),
    ("rebasing token", "NOT_TESTED", "No dedicated token fixture or compatibility measurement identified."),
    ("gas griefing", "IMPLEMENTED_PARTIALLY", "Bounded revert copy; no gas reserve guarantee for outer persistence and no comprehensive exhaustion study."),
    ("returndata griefing", "IMPLEMENTED_AND_TESTED", "_boundedCall copies at most 256 failed-target bytes, ignores successful return bytes; Phase4 large-data tests."),
    ("nested batches", "NOT_TESTED", "Top-level array bounded to 16; no recursive batch API or generic nested-target semantic guarantee."),
    ("self-calls", "IMPLEMENTED_PARTIALLY", "executeIsolated onlySelf tested; signed target=self rejection is source-only with no dedicated regression identified. External self-call implements isolation."),
    ("state drift between signing/execution", "IMPLEMENTED_PARTIALLY", "Execution-time observations and bounds; no binding of full pre-state."),
    ("ERC-1271 signatures", "EXPLICITLY_OUT_OF_SCOPE", "V2 directly calls ECDSA.recover; no isValidSignature integration."),
    ("ERC-4337 integration", "EXPLICITLY_OUT_OF_SCOPE", "No EntryPoint or validateUserOp integration established."),
    ("ERC-7579 integration", "EXPLICITLY_OUT_OF_SCOPE", "Immutable validator and module enum do not establish standard compatibility."),
    ("ERC-6900 integration", "EXPLICITLY_OUT_OF_SCOPE", "No modular-account standard integration established."),
    ("malicious modules/hooks", "NOT_APPLICABLE", "No user-installable validator/hook architecture; immutable internally deployed validator."),
    ("oracle manipulation", "NOT_TESTED", "Secondary YieldRebalance trusts supplied mock oracle; no manipulation robustness study."),
    ("cross-chain/asynchronous effects", "EXPLICITLY_OUT_OF_SCOPE", "EVM rollback is synchronous and local to the transaction."),
    ("evidence spoofing", "IMPLEMENTED_PARTIALLY", "Execution-target errors wrapped by _boundedCall/TargetCallFailed. Separate token balance/allowance reads rely on truthful-read assumption; no complete spoofing study."),
    ("strike farming", "IMPLEMENTED_PARTIALLY", "Authentication precedes inner policy enforcement; signed violating intents can legitimately strike. Dedicated campaign analysis absent."),
    ("quarantine evasion", "IMPLEMENTED_PARTIALLY", "State per agent; removal preserves strikes. Owner can register another identity. Dedicated evasion study absent."),
    ("unquarantine/recovery governance", "IMPLEMENTED_PARTIALLY", "Owner-only recovery and two-step ownership; no timelock/multisig requirement or dedicated V2 non-owner recovery test."),
    ("owner compromise", "EXPLICITLY_OUT_OF_SCOPE", "Owner signs policies and can recover tokens/change containment; owner is trusted."),
]

FAILURES = {
    "ALLOW_SUCCESS": ([], "IntentExecuted and checked final state; status=1 alone insufficient."),
    "SIGNATURE_FAILURE": (["InvalidOwnerSignature", "ECDSAInvalidSignature", "ECDSAInvalidSignatureLength", "ECDSAInvalidSignatureS", "WrongOwner"], "Outer authentication failure."),
    "AGENT_AUTH_FAILURE": (["UnauthorizedAgent"], "Caller binding or registration failure."),
    "ACCOUNT_BINDING_FAILURE": (["WrongAccount"], "Explicit account mismatch."),
    "CHAIN_BINDING_FAILURE": (["WrongChain"], "Explicit chain mismatch; domain-only signature mismatch may be SIGNATURE_FAILURE."),
    "NONCE_REPLAY": (["NonceAlreadyUsed"], "Previously consumed or owner-cancelled nonce."),
    "NOT_YET_VALID": (["IntentNotYetValid"], "Before signed window."),
    "EXPIRED_INTENT": (["IntentExpired"], "After signed window."),
    "CALL_HASH_MISMATCH": (["CallsHashMismatch"], "Call commitment mismatch."),
    "POLICY_HASH_MISMATCH": (["PolicyHashMismatch"], "Policy commitment mismatch."),
    "POLICY_VIOLATION": (["PolicyViolation"], "Authenticated inner policy rejection plus durable record; cannot infer validation stage from code alone."),
    "POSTCONDITION_VIOLATION": ([], "Subset of PolicyViolation only when trace independently locates _validateOutcomes/validateOutcome; avoid counting twice."),
    "TARGET_REVERT": (["TargetCallFailed"], "Inner target failure established by trace; ExecutionFailed alone is insufficient."),
    "REENTRANCY_REJECTED": (["ReentrancyGuardReentrantCall"], "Proven guard failure; nested target wrapping may require trace."),
    "OUT_OF_GAS_OR_RESOURCE": ([], "Observed resource failure; never infer intent enforcement from a failed receipt."),
    "QUARANTINE_REJECTION": (["AgentQuarantinedError"], "Registered submitting agent rejected by quarantine flag before signature verification."),
    "STRUCTURAL_REJECTION": (["WrongVersion", "InvalidPolicy", "InvalidValidityWindow", "InvalidCallCount", "BatchNotAllowed", "InvalidCallTarget", "UnsupportedOperation"], "Malformed package, not authenticated policy evidence."),
    "OWNER_AUTH_FAILURE": (["OwnableUnauthorizedAccount"], "Access-control failure on owner-only method."),
    "PAUSE_REJECTION": (["EnforcedPause"], "Administrative pause; does not prove scenario-specific security enforcement."),
    "INFRASTRUCTURE_FAILURE": ([], "RPC, fixture, decoder, tooling or setup failure."),
    "UNKNOWN_FAILURE": ([], "Insufficient evidence; do not count as a blocked violation."),
    "NOT_APPLICABLE": ([], "Unsupported interface/workload; no attempted execution and no gas observation."),
}

RAW_FIELDS = """run_id scenario_id seed git_commit timestamp baseline workload mutation_class legitimate_or_attack expected_security_property expected_verdict actual_verdict reason_code failure_class owner agent submitter account chain_id target token recipient spender selector amount max_spend msg_value allowance_requested allowance_limit min_out actual_out nonce valid_after valid_until calls_hash policy_hash batch_size pre_owner_balance post_owner_balance pre_recipient_balance post_recipient_balance pre_allowance post_allowance harmful_state_survived rollback_success evidence_created evidence_hash strike_before strike_after quarantined_before quarantined_after gas_used execution_time_ns execution_time_ms transaction_hash block_number error_selector revert_hash applicability authentication_passed validation_stage pre_account_balance post_account_balance outer_receipt_status nonce_used_before nonce_used_after failure_provenance dataset_role repetition observation_source""".split()

METRIC_PROTOCOL = """# Preregistered analysis rules (no measurements)

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
"""
