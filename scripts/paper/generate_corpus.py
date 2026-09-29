#!/usr/bin/env python3
"""Generate or validate the preregistered IntentLock paper scenario corpus."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR_PATH = Path(__file__).resolve()
PROPERTY_PATH = REPO_ROOT / "paper-artifacts/system/security-properties.json"
BASELINE_PATH = REPO_ROOT / "paper-artifacts/baselines/baseline-definitions.json"
TAXONOMY_PATH = REPO_ROOT / "paper-artifacts/system/failure-taxonomy.json"

MASTER_SEED = "cresnex-intentlock-paper-2026-v1"
REFERENCE_TIMESTAMP = 1_700_000_000
SCHEMA_VERSION = "1.0.0"
JSON_NAME = "scenario-manifest.json"
CSV_NAME = "scenario-manifest.csv"
METADATA_NAME = "corpus-metadata.json"

BASELINE_IDS = ("A", "B", "C", "D", "E")
IMPLEMENTED_BASELINE_IDS = ("A", "B", "C", "D")
INTENTLOCK_BASELINE_ID = "D"

REQUIRED_FIELDS = (
    "scenario_id",
    "seed",
    "workload",
    "mutation_class",
    "legitimate_or_attack",
    "expected_security_property",
    "expected_verdict",
    "expected_reason_class",
    "applicable_baselines",
)

CSV_FIELDS = REQUIRED_FIELDS + (
    "security_metric_role",
    "counts_toward_ivbr",
    "scenario_parameters",
)

LEGITIMATE_ALLOCATION = (
    ("erc20_transfer", "P9", 60),
    ("erc20_approval", "P11", 30),
    ("token_swap", "P12", 30),
    ("ordered_batch", "P13", 20),
    ("replay_freshness", "P6", 20),
    ("outcome_post_state", "P14", 20),
    ("quarantine_containment", "P18", 20),
)

ATTACK_SPECS: tuple[dict[str, Any], ...] = (
    {"mutation_class": "wrong_recipient", "workload": "erc20_transfer", "property": "P10", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "B": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "overspend", "workload": "erc20_transfer", "property": "P9", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "B": "GUARD", "C": "GUARD", "D": "REJECT"}},
    {"mutation_class": "wrong_token", "workload": "erc20_transfer", "property": "P8", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "B": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "wrong_target", "workload": "erc20_transfer", "property": "P8", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "wrong_selector", "workload": "erc20_transfer", "property": "P8", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "calldata_mutation", "workload": "erc20_transfer", "property": "P7", "reason": "CALL_HASH_MISMATCH", "applicable": {"A": "ALLOW", "B": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "unauthorized_spender", "workload": "erc20_approval", "property": "P11", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "excessive_allowance", "workload": "erc20_approval", "property": "P11", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "C": "GUARD", "D": "REJECT"}},
    {"mutation_class": "unlimited_approval", "workload": "erc20_approval", "property": "P11", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "C": "GUARD", "D": "REJECT"}},
    {"mutation_class": "allowance_escalation", "workload": "erc20_approval", "property": "P11", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "C": "GUARD", "D": "REJECT"}},
    {"mutation_class": "reduced_min_out", "workload": "token_swap", "property": "P12", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "insufficient_received_output", "workload": "token_swap", "property": "P12", "reason": "POSTCONDITION_VIOLATION", "applicable": {"A": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "wrong_router", "workload": "token_swap", "property": "P8", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "unexpected_eth_value", "workload": "erc20_transfer", "property": "P9", "reason": "POLICY_VIOLATION", "applicable": {"A": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "batch_insertion", "workload": "ordered_batch", "property": "P13", "reason": "CALL_HASH_MISMATCH", "applicable": {"D": "REJECT"}},
    {"mutation_class": "batch_deletion", "workload": "ordered_batch", "property": "P13", "reason": "CALL_HASH_MISMATCH", "applicable": {"D": "REJECT"}},
    {"mutation_class": "batch_reordering", "workload": "ordered_batch", "property": "P13", "reason": "CALL_HASH_MISMATCH", "applicable": {"D": "REJECT"}},
    {"mutation_class": "batch_argument_mutation", "workload": "ordered_batch", "property": "P13", "reason": "CALL_HASH_MISMATCH", "applicable": {"D": "REJECT"}},
    {"mutation_class": "nonce_replay", "workload": "replay_freshness", "property": "P5", "reason": "NONCE_REPLAY", "applicable": {"A": "REPLAY", "B": "REPLAY", "C": "REPLAY", "D": "REJECT"}},
    {"mutation_class": "expired_intent", "workload": "replay_freshness", "property": "P6", "reason": "EXPIRED_INTENT", "applicable": {"A": "EXPIRED", "B": "EXPIRED", "C": "EXPIRED", "D": "REJECT"}},
    {"mutation_class": "not_yet_valid_intent", "workload": "replay_freshness", "property": "P6", "reason": "NOT_YET_VALID", "applicable": {"A": "ALLOW", "B": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "wrong_chain", "workload": "replay_freshness", "property": "P4", "reason": "CHAIN_BINDING_FAILURE", "applicable": {"A": "SIGNATURE", "B": "SIGNATURE", "C": "SIGNATURE", "D": "REJECT"}},
    {"mutation_class": "wrong_account", "workload": "replay_freshness", "property": "P3", "reason": "ACCOUNT_BINDING_FAILURE", "applicable": {"A": "SIGNATURE", "B": "SIGNATURE", "C": "SIGNATURE", "D": "REJECT"}},
    {"mutation_class": "wrong_agent", "workload": "replay_freshness", "property": "P2", "reason": "AGENT_AUTH_FAILURE", "applicable": {"A": "SIGNATURE", "B": "SIGNATURE", "C": "SIGNATURE", "D": "REJECT"}},
    {"mutation_class": "calls_hash_mismatch", "workload": "replay_freshness", "property": "P7", "reason": "CALL_HASH_MISMATCH", "applicable": {"D": "REJECT"}},
    {"mutation_class": "policy_hash_mismatch", "workload": "replay_freshness", "property": "P7", "reason": "POLICY_HASH_MISMATCH", "applicable": {"D": "REJECT"}},
    {"mutation_class": "post_state_mismatch", "workload": "outcome_post_state", "property": "P14", "reason": "POSTCONDITION_VIOLATION", "applicable": {"A": "ALLOW", "B": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "unexpected_residual_allowance", "workload": "outcome_post_state", "property": "P11", "reason": "POSTCONDITION_VIOLATION", "applicable": {"A": "ALLOW", "C": "ALLOW", "D": "REJECT"}},
    {"mutation_class": "target_revert", "workload": "outcome_post_state", "property": "P20", "reason": "TARGET_REVERT", "metric_role": "RELIABILITY_CONTROL", "applicable": {"A": "TARGET", "B": "TARGET", "C": "TARGET", "D": "REJECT"}},
    {"mutation_class": "reentrancy", "workload": "outcome_post_state", "property": "P15", "reason": "REENTRANCY_REJECTED", "applicable": {"A": "REENTRANCY", "B": "REENTRANCY", "C": "REENTRANCY", "D": "REJECT"}},
    {"mutation_class": "repeated_authenticated_violations", "workload": "quarantine_containment", "property": "P17", "reason": "POLICY_VIOLATION", "applicable": {"D": "REJECT"}},
    {"mutation_class": "execution_after_quarantine", "workload": "quarantine_containment", "property": "P18", "reason": "QUARANTINE_REJECTION", "applicable": {"D": "REJECT"}},
    {"mutation_class": "non_owner_quarantine_recovery", "workload": "quarantine_containment", "property": "P19", "reason": "OWNER_AUTH_FAILURE", "applicable": {"D": "REJECT"}},
)


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def git_head() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True, stderr=subprocess.DEVNULL
    ).strip()


def deterministic_seed(scenario_id: str, workload: str, mutation_class: str) -> int:
    material = f"{MASTER_SEED}:{scenario_id}:{workload}:{mutation_class}".encode()
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "big", signed=False)


def allowed(code: str | None = None, note: str | None = None) -> dict[str, Any]:
    return {
        "applicable": True,
        "expected_verdict": "ALLOW",
        "expected_reason_class": "ALLOW_SUCCESS",
        "expected_reason_code": code,
        "note": note,
    }


def rejected(reason: str, code: str | None = None, note: str | None = None) -> dict[str, Any]:
    return {
        "applicable": True,
        "expected_verdict": "REJECT",
        "expected_reason_class": reason,
        "expected_reason_code": code,
        "note": note,
    }


def not_applicable(note: str) -> dict[str, Any]:
    return {
        "applicable": False,
        "expected_verdict": "NOT_APPLICABLE",
        "expected_reason_class": "NOT_APPLICABLE",
        "expected_reason_code": None,
        "note": note,
    }


def baseline_gap_rejection(code: str) -> dict[str, Any]:
    return rejected(
        "UNKNOWN_FAILURE",
        code,
        "The frozen taxonomy has no baseline-guard rejection category; preserve the exact error and do not treat it as V2 durable policy evidence.",
    )


def default_na_reason(baseline_id: str, workload: str, mutation_class: str) -> str:
    if baseline_id == "A":
        return f"SignatureOnlyAccount has no interface/state for {mutation_class} in the {workload} workload."
    if baseline_id == "B":
        return f"SpendLimitGuardAccount is ERC20-transfer-only and cannot represent {mutation_class} in {workload}."
    if baseline_id == "C":
        return f"PathAndSpendGuardAccount accepts one 68-byte address/uint256-shaped call and cannot represent {mutation_class} in {workload}."
    if baseline_id == "D":
        return f"IntentLock V2 cannot represent {mutation_class} in {workload}."
    return "SemanticGuardAccount is not implemented in the frozen baseline definitions."


def attack_expectation(token: str, baseline_id: str, reason: str) -> dict[str, Any]:
    if token == "ALLOW":
        return allowed(note="The baseline lacks the constraint needed to reject this preregistered mutation.")
    if token == "REJECT":
        reason_codes = {
            "POLICY_VIOLATION": "PolicyViolation",
            "POSTCONDITION_VIOLATION": "PolicyViolation",
            "CALL_HASH_MISMATCH": "CallsHashMismatch",
            "POLICY_HASH_MISMATCH": "PolicyHashMismatch",
            "NONCE_REPLAY": "NonceAlreadyUsed",
            "EXPIRED_INTENT": "IntentExpired",
            "NOT_YET_VALID": "IntentNotYetValid",
            "CHAIN_BINDING_FAILURE": "WrongChain",
            "ACCOUNT_BINDING_FAILURE": "WrongAccount",
            "AGENT_AUTH_FAILURE": "UnauthorizedAgent",
            "TARGET_REVERT": "TargetCallFailed",
            "REENTRANCY_REJECTED": "ReentrancyGuardReentrantCall",
            "QUARANTINE_REJECTION": "AgentQuarantinedError",
            "OWNER_AUTH_FAILURE": "OwnableUnauthorizedAccount",
        }
        return rejected(reason, reason_codes.get(reason))
    if token == "GUARD":
        return baseline_gap_rejection("SpendExceeded" if baseline_id == "B" else "PathRejected")
    if token == "REPLAY":
        return rejected("NONCE_REPLAY", "InvalidAuthorization", "Classification requires known used-nonce pre-state because the baseline error is generic.")
    if token == "EXPIRED":
        return rejected("EXPIRED_INTENT", "InvalidAuthorization", "Classification requires the recorded timestamp because the baseline error is generic.")
    if token == "SIGNATURE":
        return rejected("SIGNATURE_FAILURE", "InvalidAuthorization", "The baseline binds this value only through its signature digest and exposes a generic authorization error.")
    if token == "TARGET":
        code = "SpendExceeded" if baseline_id == "B" else "ExecutionFailed"
        return rejected("TARGET_REVERT", code, "Trace or controlled target provenance is required; a revert alone is not a security success.")
    if token == "REENTRANCY":
        code = "SpendExceeded" if baseline_id == "B" else "ExecutionFailed"
        return rejected("REENTRANCY_REJECTED", code, "The nested ReentrancyGuard selector must be proven in the trace; the outer wrapper is insufficient by itself.")
    raise ValueError(f"unknown baseline expectation token: {token}")


def baseline_matrix(
    workload: str,
    mutation_class: str,
    entries: dict[str, str],
    intentlock_reason: str,
) -> dict[str, dict[str, Any]]:
    matrix: dict[str, dict[str, Any]] = {}
    for baseline_id in IMPLEMENTED_BASELINE_IDS:
        token = entries.get(baseline_id)
        if token is None:
            matrix[baseline_id] = not_applicable(default_na_reason(baseline_id, workload, mutation_class))
        else:
            matrix[baseline_id] = attack_expectation(token, baseline_id, intentlock_reason)
    matrix["E"] = not_applicable(default_na_reason("E", workload, mutation_class))
    return matrix


def legitimate_matrix(workload: str) -> dict[str, dict[str, Any]]:
    applicability = {
        "erc20_transfer": {"A", "B", "C", "D"},
        "erc20_approval": {"A", "C", "D"},
        "token_swap": {"A", "D"},
        "ordered_batch": {"D"},
        "replay_freshness": {"A", "B", "C", "D"},
        "outcome_post_state": {"A", "B", "C", "D"},
        "quarantine_containment": {"D"},
    }[workload]
    matrix = {
        baseline_id: allowed(note="Canonical legitimate execution for this supported interface.")
        if baseline_id in applicability
        else not_applicable(default_na_reason(baseline_id, workload, "legitimate_boundary"))
        for baseline_id in IMPLEMENTED_BASELINE_IDS
    }
    matrix["E"] = not_applicable(default_na_reason("E", workload, "legitimate_boundary"))
    return matrix


def common_parameters(sequence: int, local_index: int, fixture_profile: str) -> dict[str, Any]:
    amount = 1_000 + local_index * 17
    return {
        "fixture_profile": fixture_profile,
        "variant_index": local_index,
        "reference_timestamp": REFERENCE_TIMESTAMP,
        "chain_id": 31_337,
        "nonce": sequence + 100_000,
        "amount": amount,
        "max_spend": amount + 100,
        "allowance_limit": amount + 200,
        "min_out": amount * 2,
        "identities": {
            "account": "ACCOUNT_PRIMARY",
            "agent": "AGENT_REGISTERED",
            "owner": "OWNER_PRIMARY",
            "recipient": "RECIPIENT_ALLOWED",
            "router": "ROUTER_ALLOWED",
            "spender": "SPENDER_ALLOWED",
            "token": "TOKEN_PRIMARY",
        },
    }


def legitimate_parameters(workload: str, sequence: int, local_index: int) -> dict[str, Any]:
    parameters = common_parameters(sequence, local_index, workload)
    parameters["authorization_strategy"] = "CANONICAL_VALID_PACKAGE"
    cases = {
        "erc20_transfer": ("zero_at_limit", "one_below_limit", "exact_max_spend", "recipient_min_receive_exact", "min_final_balance_exact"),
        "erc20_approval": ("zero_allowance", "one_below_allowance_limit", "exact_allowance_limit"),
        "token_swap": ("one_below_max_spend", "exact_max_spend", "exact_min_out"),
        "ordered_batch": ("two_calls", "three_calls", "maximum_sixteen_calls", "ordered_distinct_arguments"),
        "replay_freshness": ("fresh_unused_nonce", "valid_after_exact_now", "valid_until_exact_now", "interior_window"),
        "outcome_post_state": ("exact_recipient_minimum", "exact_final_balance_minimum", "exact_final_allowance_cap", "well_behaved_token"),
        "quarantine_containment": ("registered_zero_strikes", "registered_threshold_minus_one", "owner_unquarantined", "owner_reset_strikes"),
    }
    boundary_case = cases[workload][local_index % len(cases[workload])]
    parameters["boundary_case"] = boundary_case
    parameters["valid_after"] = REFERENCE_TIMESTAMP - 60
    parameters["valid_until"] = REFERENCE_TIMESTAMP + 3_600
    if boundary_case == "zero_at_limit":
        parameters["amount"] = 0
        parameters["max_spend"] = 0
    elif boundary_case == "one_below_limit":
        parameters["max_spend"] = parameters["amount"] + 1
    elif boundary_case == "exact_max_spend":
        parameters["max_spend"] = parameters["amount"]
    elif boundary_case == "zero_allowance":
        parameters["allowance_requested"] = 0
        parameters["allowance_limit"] = 0
    elif boundary_case == "one_below_allowance_limit":
        parameters["allowance_requested"] = parameters["allowance_limit"] - 1
    elif boundary_case in {"exact_allowance_limit", "exact_final_allowance_cap"}:
        parameters["allowance_requested"] = parameters["allowance_limit"]
    elif boundary_case == "exact_min_out":
        parameters["actual_out"] = parameters["min_out"]
    elif boundary_case == "valid_after_exact_now":
        parameters["valid_after"] = REFERENCE_TIMESTAMP
    elif boundary_case == "valid_until_exact_now":
        parameters["valid_until"] = REFERENCE_TIMESTAMP
    elif boundary_case == "maximum_sixteen_calls":
        parameters["batch_size"] = 16
    elif workload == "ordered_batch":
        parameters["batch_size"] = 2 + local_index % 2
    if workload == "quarantine_containment":
        parameters["quarantine_threshold"] = 3
        parameters["strikes_before"] = 2 if boundary_case == "registered_threshold_minus_one" else 0
        parameters["quarantined_before"] = False
    return parameters


def attack_parameters(spec: dict[str, Any], sequence: int, local_index: int) -> dict[str, Any]:
    mutation = spec["mutation_class"]
    workload = spec["workload"]
    parameters = common_parameters(sequence + 500_000, local_index, workload)
    parameters.update({"valid_after": REFERENCE_TIMESTAMP - 60, "valid_until": REFERENCE_TIMESTAMP + 3_600})
    parameters["authorization_strategy"] = "AUTHENTICATED_POLICY_CONFLICT"
    amount = parameters["amount"]

    if mutation == "wrong_recipient":
        parameters.update({"signed_recipient": "RECIPIENT_ALLOWED", "executed_recipient": f"RECIPIENT_UNAUTHORIZED_{local_index:02d}"})
    elif mutation == "overspend":
        parameters.update({"max_spend": amount, "executed_amount": amount + 1 + local_index})
    elif mutation == "wrong_token":
        parameters.update({"policy_token": "TOKEN_PRIMARY", "executed_token": f"TOKEN_ALTERNATE_{local_index % 4}"})
    elif mutation == "wrong_target":
        parameters.update({"policy_target": "TOKEN_PRIMARY", "executed_target": f"TARGET_UNAUTHORIZED_{local_index % 5}"})
    elif mutation == "wrong_selector":
        parameters.update({"policy_selector": "ERC20_TRANSFER", "executed_selector": f"SELECTOR_PERMISSIVE_{local_index % 4}"})
    elif mutation == "calldata_mutation":
        parameters.update({"authorization_strategy": "POST_SIGNATURE_MUTATION", "mutated_word_index": 1 + local_index % 2, "original_word": amount, "mutated_word": amount + local_index + 1})
    elif mutation == "unauthorized_spender":
        parameters.update({"policy_spender": "SPENDER_ALLOWED", "executed_spender": f"SPENDER_UNAUTHORIZED_{local_index % 5}", "allowance_requested": amount})
    elif mutation == "excessive_allowance":
        parameters.update({"allowance_limit": amount, "allowance_requested": amount + 1 + local_index})
    elif mutation == "unlimited_approval":
        parameters.update({"allowance_limit": amount, "allowance_requested": str(2**256 - 1)})
    elif mutation == "allowance_escalation":
        parameters.update({"pre_allowance": amount // 2, "allowance_limit": amount, "allowance_requested": amount + 1 + local_index})
    elif mutation == "reduced_min_out":
        parameters.update({"policy_min_out": amount * 2, "calldata_min_out": amount * 2 - 1 - local_index})
    elif mutation == "insufficient_received_output":
        parameters.update({"min_out": amount * 2, "actual_out": amount * 2 - 1 - local_index, "target_call_succeeds": True})
    elif mutation == "wrong_router":
        parameters.update({"policy_router": "ROUTER_ALLOWED", "executed_router": f"ROUTER_UNAUTHORIZED_{local_index % 5}"})
    elif mutation == "unexpected_eth_value":
        parameters.update({"max_native_spend": 0, "msg_value": 1 + local_index})
    elif mutation in {"batch_insertion", "batch_deletion", "batch_reordering", "batch_argument_mutation"}:
        base_size = 2 + local_index % 4
        parameters.update({"authorization_strategy": "POST_SIGNATURE_MUTATION", "signed_batch_size": base_size, "mutation_position": local_index % base_size})
        if mutation == "batch_insertion":
            parameters["executed_batch_size"] = base_size + 1
        elif mutation == "batch_deletion":
            parameters["executed_batch_size"] = base_size - 1
        else:
            parameters["executed_batch_size"] = base_size
    elif mutation == "nonce_replay":
        parameters.update({"prior_execution_succeeded": True, "nonce_used_before": True})
    elif mutation == "expired_intent":
        parameters.update({"valid_after": REFERENCE_TIMESTAMP - 3_600, "valid_until": REFERENCE_TIMESTAMP - 1})
    elif mutation == "not_yet_valid_intent":
        parameters.update({"valid_after": REFERENCE_TIMESTAMP + 1 + local_index, "valid_until": REFERENCE_TIMESTAMP + 3_600})
    elif mutation == "wrong_chain":
        parameters.update({"execution_chain_id": 31_337, "signed_chain_id": 31_338 + local_index})
    elif mutation == "wrong_account":
        parameters.update({"execution_account": "ACCOUNT_PRIMARY", "signed_account": f"ACCOUNT_ALTERNATE_{local_index % 4}"})
    elif mutation == "wrong_agent":
        parameters.update({"signed_agent": "AGENT_REGISTERED", "submitter": f"AGENT_UNAUTHORIZED_{local_index % 5}"})
    elif mutation == "calls_hash_mismatch":
        parameters.update({"authorization_strategy": "SIGNED_MISMATCHED_MANIFEST_FIELD", "manifest_calls_hash": f"HASH_ALTERNATE_{local_index:02d}", "computed_calls_hash": "HASH_CANONICAL"})
    elif mutation == "policy_hash_mismatch":
        parameters.update({"authorization_strategy": "SIGNED_MISMATCHED_MANIFEST_FIELD", "manifest_policy_hash": f"HASH_ALTERNATE_{local_index:02d}", "computed_policy_hash": "HASH_CANONICAL"})
    elif mutation == "post_state_mismatch":
        behaviors = ("returns_true_without_transfer", "fee_on_transfer_below_minimum", "recipient_balance_drift", "account_balance_drift")
        parameters.update({"target_call_succeeds": True, "adversarial_token_behavior": behaviors[local_index % len(behaviors)], "expected_recipient_delta": amount, "actual_recipient_delta": max(0, amount - 1 - local_index)})
    elif mutation == "unexpected_residual_allowance":
        parameters.update({"allowance_limit": amount, "post_allowance": amount + 1 + local_index, "target_call_succeeds": True})
    elif mutation == "target_revert":
        parameters.update({"target_call_succeeds": False, "revert_data_length": (0, 32, 256, 1024)[local_index % 4], "security_metric_role": "RELIABILITY_CONTROL"})
    elif mutation == "reentrancy":
        callbacks = ("token_transfer_callback", "router_callback", "native_receiver_callback")
        parameters.update({"callback_profile": callbacks[local_index % len(callbacks)], "nested_entrypoint": "executeIntent", "nested_revert_must_be_trace_proven": True})
    elif mutation == "repeated_authenticated_violations":
        parameters.update({"quarantine_threshold": 3, "sequence_length": 3 + local_index % 3, "fresh_nonce_per_attempt": True, "expected_strike_delta_per_violation": 1})
    elif mutation == "execution_after_quarantine":
        parameters.update({"quarantine_threshold": 3, "strikes_before": 3 + local_index % 3, "quarantined_before": True})
    elif mutation == "non_owner_quarantine_recovery":
        methods = ("unquarantineAgent", "resetAgentStrikes", "setQuarantineThreshold")
        parameters.update({"caller": f"NON_OWNER_{local_index % 5}", "owner_only_method": methods[local_index % len(methods)], "quarantined_before": True})
    else:
        raise ValueError(f"missing parameter builder for {mutation}")
    return parameters


def make_scenario(
    scenario_id: str,
    workload: str,
    mutation_class: str,
    label: str,
    property_id: str,
    verdict: str,
    reason: str,
    baselines: dict[str, dict[str, Any]],
    parameters: dict[str, Any],
    metric_role: str,
) -> dict[str, Any]:
    return {
        "scenario_id": scenario_id,
        "seed": deterministic_seed(scenario_id, workload, mutation_class),
        "workload": workload,
        "mutation_class": mutation_class,
        "legitimate_or_attack": label,
        "expected_security_property": property_id,
        "expected_verdict": verdict,
        "expected_reason_class": reason,
        "applicable_baselines": baselines,
        "security_metric_role": metric_role,
        "counts_toward_ivbr": label == "ATTACK" and metric_role == "SECURITY_VIOLATION",
        "scenario_parameters": parameters,
    }


def build_scenarios() -> tuple[list[dict[str, Any]], dict[str, int]]:
    scenarios: list[dict[str, Any]] = []
    legitimate_sequence = 0
    for workload, property_id, count in LEGITIMATE_ALLOCATION:
        for local_index in range(count):
            legitimate_sequence += 1
            scenario_id = f"IL26-L-{legitimate_sequence:04d}"
            scenarios.append(
                make_scenario(
                    scenario_id,
                    workload,
                    "none",
                    "LEGITIMATE",
                    property_id,
                    "ALLOW",
                    "ALLOW_SUCCESS",
                    legitimate_matrix(workload),
                    legitimate_parameters(workload, legitimate_sequence, local_index),
                    "LEGITIMATE_CONTROL",
                )
            )

    base_count, remainder = divmod(800, len(ATTACK_SPECS))
    remainder_classes = {
        spec["mutation_class"]
        for spec in sorted(
            ATTACK_SPECS,
            key=lambda item: hashlib.sha256(f"{MASTER_SEED}:allocation:{item['mutation_class']}".encode()).hexdigest(),
        )[:remainder]
    }
    attack_counts = {
        spec["mutation_class"]: base_count + (spec["mutation_class"] in remainder_classes)
        for spec in ATTACK_SPECS
    }

    attack_sequence = 0
    for spec in ATTACK_SPECS:
        mutation_class = spec["mutation_class"]
        for local_index in range(attack_counts[mutation_class]):
            attack_sequence += 1
            scenario_id = f"IL26-A-{attack_sequence:04d}"
            reason = spec["reason"]
            metric_role = spec.get("metric_role", "SECURITY_VIOLATION")
            matrix = baseline_matrix(spec["workload"], mutation_class, spec["applicable"], reason)
            scenarios.append(
                make_scenario(
                    scenario_id,
                    spec["workload"],
                    mutation_class,
                    "ATTACK",
                    spec["property"],
                    "REJECT",
                    reason,
                    matrix,
                    attack_parameters(spec, attack_sequence, local_index),
                    metric_role,
                )
            )
    return scenarios, attack_counts


def source_context(source_parent_commit: str) -> dict[str, Any]:
    properties = load_json(PROPERTY_PATH)
    baselines = load_json(BASELINE_PATH)
    taxonomy = load_json(TAXONOMY_PATH)
    return {
        "source_parent_commit": source_parent_commit,
        "source_definition_sha256": {
            str(PROPERTY_PATH.relative_to(REPO_ROOT)): sha256_file(PROPERTY_PATH),
            str(BASELINE_PATH.relative_to(REPO_ROOT)): sha256_file(BASELINE_PATH),
            str(TAXONOMY_PATH.relative_to(REPO_ROOT)): sha256_file(TAXONOMY_PATH),
        },
        "property_ids": [item["property_id"] for item in properties["properties"]],
        "baseline_records": {
            item["baseline_id"]: {"name": item["name"], "status": item["status"]}
            for item in baselines["baselines"]
        },
        "failure_classes": [item["category"] for item in taxonomy["categories"]],
    }


def validate_source_context(context: dict[str, Any]) -> None:
    if set(context["property_ids"]) != {f"P{number}" for number in range(1, 21)}:
        raise ValueError("security property definitions must contain exactly P1-P20")
    records = context["baseline_records"]
    if tuple(sorted(records)) != BASELINE_IDS:
        raise ValueError("baseline definitions must contain exactly A-E")
    for baseline_id in IMPLEMENTED_BASELINE_IDS:
        if records[baseline_id]["status"] != "EXISTING_RESEARCH_CODE":
            raise ValueError(f"baseline {baseline_id} is not frozen as implemented research code")
    if records["E"]["status"] != "MISSING":
        raise ValueError("generator expects the frozen SemanticGuardAccount baseline E to remain MISSING")


def build_manifest(source_parent_commit: str) -> tuple[dict[str, Any], dict[str, Any]]:
    context = source_context(source_parent_commit)
    validate_source_context(context)
    scenarios, attack_counts = build_scenarios()
    label_counts = Counter(item["legitimate_or_attack"] for item in scenarios)
    workload_counts = Counter(item["workload"] for item in scenarios)
    legitimate_workloads = Counter(item["workload"] for item in scenarios if item["legitimate_or_attack"] == "LEGITIMATE")
    attack_workloads = Counter(item["workload"] for item in scenarios if item["legitimate_or_attack"] == "ATTACK")
    applicability = {
        baseline_id: {
            "applicable": sum(item["applicable_baselines"][baseline_id]["applicable"] for item in scenarios),
            "not_applicable": sum(not item["applicable_baselines"][baseline_id]["applicable"] for item in scenarios),
        }
        for baseline_id in BASELINE_IDS
    }
    corpus_hash = sha256_bytes(canonical_json_bytes(scenarios))
    metadata = {
        "artifact_status": "PREREGISTERED_UNEXECUTED_SCENARIO_DEFINITIONS",
        "schema_version": SCHEMA_VERSION,
        "generator": str(GENERATOR_PATH.relative_to(REPO_ROOT)),
        "generator_sha256": sha256_file(GENERATOR_PATH),
        "source_parent_commit": context["source_parent_commit"],
        "source_definition_sha256": context["source_definition_sha256"],
        "master_seed": MASTER_SEED,
        "seed_derivation": "unsigned big-endian first 8 bytes of SHA-256(master_seed:scenario_id:workload:mutation_class)",
        "scenario_id_strategy": "IL26-L-0001..IL26-L-0200 and IL26-A-0001..IL26-A-0800",
        "scenario_count": len(scenarios),
        "legitimate_count": label_counts["LEGITIMATE"],
        "adversarial_count": label_counts["ATTACK"],
        "legitimate_workload_counts": dict(sorted(legitimate_workloads.items())),
        "adversarial_workload_counts": dict(sorted(attack_workloads.items())),
        "workload_counts": dict(sorted(workload_counts.items())),
        "attack_class_counts": dict(sorted(attack_counts.items())),
        "attack_allocation_rule": "33 classes receive 24 cases each; the eight classes with smallest SHA-256(master_seed:allocation:mutation_class) receive one additional case.",
        "baseline_definitions": context["baseline_records"],
        "baseline_applicability_counts": applicability,
        "corpus_sha256": corpus_hash,
        "label_freeze": "All expected labels and per-baseline applicability are generated before any final-corpus execution. This artifact contains no observations or results.",
        "metric_caveats": [
            "target_revert is an adversarial reliability control and counts_toward_ivbr=false; a revert alone is never a security success",
            "UNKNOWN_FAILURE on baseline B/C guard rejection records a frozen-taxonomy gap while preserving SpendExceeded/PathRejected; it is not V2 durable policy evidence",
            "NOT_APPLICABLE means no execution, gas, or latency observation may be synthesized",
            "SemanticGuardAccount (baseline E) is MISSING and is NOT_APPLICABLE for every scenario",
        ],
    }
    manifest = {"metadata": metadata, "scenarios": scenarios}
    validate_manifest(manifest, context["failure_classes"])
    return manifest, context


def validate_manifest(manifest: dict[str, Any], failure_classes: list[str]) -> None:
    metadata = manifest["metadata"]
    scenarios = manifest["scenarios"]
    if len(scenarios) != 1_000:
        raise ValueError(f"expected 1000 scenarios, found {len(scenarios)}")
    labels = Counter(item["legitimate_or_attack"] for item in scenarios)
    if labels != {"LEGITIMATE": 200, "ATTACK": 800}:
        raise ValueError(f"incorrect label counts: {dict(labels)}")
    expected_legitimate = {workload: count for workload, _property, count in LEGITIMATE_ALLOCATION}
    actual_legitimate = Counter(item["workload"] for item in scenarios if item["legitimate_or_attack"] == "LEGITIMATE")
    if dict(actual_legitimate) != expected_legitimate:
        raise ValueError(f"incorrect legitimate allocation: {dict(actual_legitimate)}")
    expected_attack_classes = {spec["mutation_class"] for spec in ATTACK_SPECS}
    actual_attack_classes = {item["mutation_class"] for item in scenarios if item["legitimate_or_attack"] == "ATTACK"}
    if actual_attack_classes != expected_attack_classes:
        raise ValueError("attack-class coverage differs from the frozen 33-class specification")
    if set(metadata["attack_class_counts"]) != expected_attack_classes:
        raise ValueError("metadata attack-class coverage mismatch")
    if any(count not in {24, 25} for count in metadata["attack_class_counts"].values()):
        raise ValueError("attack-class counts must be 24 or 25")
    if sum(metadata["attack_class_counts"].values()) != 800:
        raise ValueError("attack-class counts must sum to 800")

    scenario_ids = [item["scenario_id"] for item in scenarios]
    expected_ids = [f"IL26-L-{number:04d}" for number in range(1, 201)] + [
        f"IL26-A-{number:04d}" for number in range(1, 801)
    ]
    if scenario_ids != expected_ids:
        raise ValueError("scenario IDs or ordering differ from the frozen sequence")
    if len(set(scenario_ids)) != len(scenario_ids):
        raise ValueError("duplicate scenario_id")
    seeds = [item["seed"] for item in scenarios]
    if len(set(seeds)) != len(seeds):
        raise ValueError("deterministic seed collision")

    failure_set = set(failure_classes)
    canonical_definitions: set[bytes] = set()
    for item in scenarios:
        missing = set(REQUIRED_FIELDS) - set(item)
        if missing:
            raise ValueError(f"{item.get('scenario_id')} missing fields: {sorted(missing)}")
        expected_seed = deterministic_seed(item["scenario_id"], item["workload"], item["mutation_class"])
        if item["seed"] != expected_seed:
            raise ValueError(f"seed mismatch for {item['scenario_id']}")
        if item["expected_security_property"] not in {f"P{number}" for number in range(1, 21)}:
            raise ValueError(f"unknown property for {item['scenario_id']}")
        if item["expected_reason_class"] not in failure_set:
            raise ValueError(f"unknown reason class for {item['scenario_id']}")
        if set(item["applicable_baselines"]) != set(BASELINE_IDS):
            raise ValueError(f"baseline mapping mismatch for {item['scenario_id']}")
        if item["applicable_baselines"]["E"]["applicable"]:
            raise ValueError(f"missing baseline E cannot be applicable: {item['scenario_id']}")
        if not item["applicable_baselines"]["D"]["applicable"]:
            raise ValueError(f"IntentLock D must be applicable: {item['scenario_id']}")
        intentlock = item["applicable_baselines"]["D"]
        if intentlock["expected_verdict"] != item["expected_verdict"] or intentlock["expected_reason_class"] != item["expected_reason_class"]:
            raise ValueError(f"top-level labels must match baseline D for {item['scenario_id']}")
        for baseline_id, expectation in item["applicable_baselines"].items():
            if expectation["expected_reason_class"] not in failure_set:
                raise ValueError(f"unknown {baseline_id} reason class for {item['scenario_id']}")
            if expectation["applicable"] != (expectation["expected_verdict"] != "NOT_APPLICABLE"):
                raise ValueError(f"inconsistent applicability for {item['scenario_id']} baseline {baseline_id}")
        if item["mutation_class"] == "target_revert" and item["counts_toward_ivbr"]:
            raise ValueError("target_revert must be excluded from IVBR")
        if item["legitimate_or_attack"] == "LEGITIMATE" and item["counts_toward_ivbr"]:
            raise ValueError("legitimate controls cannot count toward IVBR")
        definition_without_id = {key: value for key, value in item.items() if key != "scenario_id"}
        encoded = canonical_json_bytes(definition_without_id)
        if encoded in canonical_definitions:
            raise ValueError(f"duplicate scenario definition at {item['scenario_id']}")
        canonical_definitions.add(encoded)

    actual_hash = sha256_bytes(canonical_json_bytes(scenarios))
    if metadata["corpus_sha256"] != actual_hash:
        raise ValueError("corpus_sha256 mismatch")
    if metadata["scenario_count"] != 1_000 or metadata["legitimate_count"] != 200 or metadata["adversarial_count"] != 800:
        raise ValueError("metadata counts mismatch")


def csv_bytes(scenarios: list[dict[str, Any]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    for scenario in scenarios:
        row = {key: scenario[key] for key in CSV_FIELDS}
        row["applicable_baselines"] = json.dumps(row["applicable_baselines"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        row["scenario_parameters"] = json.dumps(row["scenario_parameters"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        row["counts_toward_ivbr"] = "true" if row["counts_toward_ivbr"] else "false"
        writer.writerow(row)
    return output.getvalue().encode()


def artifact_payloads(source_parent_commit: str) -> dict[str, bytes]:
    manifest, _context = build_manifest(source_parent_commit)
    manifest_json = canonical_json_bytes(manifest)
    manifest_csv = csv_bytes(manifest["scenarios"])
    metadata = {
        **manifest["metadata"],
        "artifacts": {
            JSON_NAME: {"sha256": sha256_bytes(manifest_json), "bytes": len(manifest_json)},
            CSV_NAME: {"sha256": sha256_bytes(manifest_csv), "bytes": len(manifest_csv)},
        },
    }
    return {
        JSON_NAME: manifest_json,
        CSV_NAME: manifest_csv,
        METADATA_NAME: canonical_json_bytes(metadata),
    }


def validate_csv(content: bytes, scenarios: list[dict[str, Any]]) -> None:
    reader = csv.DictReader(io.StringIO(content.decode()))
    if tuple(reader.fieldnames or ()) != CSV_FIELDS:
        raise ValueError("CSV header differs from frozen schema")
    rows = list(reader)
    if len(rows) != len(scenarios):
        raise ValueError("CSV row count mismatch")
    for row, scenario in zip(rows, scenarios):
        reconstructed: dict[str, Any] = dict(row)
        reconstructed["seed"] = int(reconstructed["seed"])
        reconstructed["counts_toward_ivbr"] = reconstructed["counts_toward_ivbr"] == "true"
        reconstructed["applicable_baselines"] = json.loads(reconstructed["applicable_baselines"])
        reconstructed["scenario_parameters"] = json.loads(reconstructed["scenario_parameters"])
        if reconstructed != {key: scenario[key] for key in CSV_FIELDS}:
            raise ValueError(f"CSV/JSON mismatch for {scenario['scenario_id']}")


def generate(output: Path) -> None:
    if output.exists():
        raise FileExistsError(f"refusing to overwrite existing path: {output}")
    payloads = artifact_payloads(git_head())
    output.mkdir(parents=True, exist_ok=False)
    for name, content in payloads.items():
        (output / name).write_bytes(content)
    print(f"generated 1000 preregistered scenarios in {output}")
    print("legitimate=200 adversarial=800 executions=0")


def validate_existing(directory: Path) -> None:
    if not directory.is_dir():
        raise FileNotFoundError(f"corpus directory does not exist: {directory}")
    for name in (JSON_NAME, CSV_NAME, METADATA_NAME):
        if not (directory / name).is_file():
            raise FileNotFoundError(f"missing corpus artifact: {directory / name}")
    manifest = load_json(directory / JSON_NAME)
    source_parent_commit = manifest.get("metadata", {}).get("source_parent_commit")
    if not isinstance(source_parent_commit, str) or len(source_parent_commit) != 40:
        raise ValueError("manifest source_parent_commit is missing or malformed")
    expected = artifact_payloads(source_parent_commit)
    actual = {name: (directory / name).read_bytes() for name in expected}
    for name in expected:
        if actual[name] != expected[name]:
            raise ValueError(f"{name} differs from deterministic generator output")
    validate_csv(actual[CSV_NAME], manifest["scenarios"])
    print(f"validated {directory}: 1000 scenarios, 200 legitimate, 800 adversarial, executions=0")
    print(f"corpus_sha256={manifest['metadata']['corpus_sha256']}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--output", type=Path, help="new directory to create; existing paths are refused")
    mode.add_argument("--validate", type=Path, help="existing corpus directory to validate without writing")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.output is not None:
            generate(args.output.resolve())
        else:
            validate_existing(args.validate.resolve())
    except (FileExistsError, FileNotFoundError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"corpus error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
