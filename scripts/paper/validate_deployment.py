#!/usr/bin/env python3
"""Read-only public-testnet sanity evidence; never submits a transaction."""

import argparse
import datetime
import hashlib
import json
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "shared/deployments/base-sepolia.json"
PUBLIC_RPC = "https://sepolia.base.org"
ALLOWED_METHODS = {
    "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode",
    "eth_call", "eth_getTransactionReceipt",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    with path.open("x") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")


def command(arguments):
    result = subprocess.run(arguments, cwd=ROOT, text=True, capture_output=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def collect_broadcast(output):
    paths = sorted((ROOT / "contracts/broadcast/DeployResearchStack.s.sol/84532").glob("run-*.json"))
    evidence = []
    seen = set()
    for path in paths:
        checksum = digest(path)
        if checksum in seen:
            continue
        seen.add(checksum)
        content = json.loads(path.read_text())
        if content.get("chain") != 84532:
            continue
        transactions = [
            {field: entry.get(field) for field in ("hash", "transactionType", "contractName", "contractAddress")}
            for entry in content.get("transactions", [])
        ]
        receipts = [
            {field: entry.get(field) for field in ("transactionHash", "contractAddress", "blockNumber", "status")}
            for entry in content.get("receipts", [])
        ]
        mismatches = []
        receipt_by_hash = {entry["transactionHash"]: entry for entry in receipts}
        for transaction in transactions:
            receipt = receipt_by_hash.get(transaction["hash"])
            if transaction["transactionType"] == "CREATE" and receipt:
                if (transaction["contractAddress"] or "").lower() != (receipt["contractAddress"] or "").lower():
                    mismatches.append({"hash": transaction["hash"], "transaction_address": transaction["contractAddress"],
                                       "receipt_address": receipt["contractAddress"]})
        evidence.append({"path": str(path.relative_to(ROOT)), "sha256": checksum,
                         "git_tracked": bool(command(["git", "ls-files", "--", str(path.relative_to(ROOT))])),
                         "chain": content["chain"], "timestamp": content.get("timestamp"),
                         "transactions": transactions, "receipts": receipts,
                         "creation_mapping_mismatches": mismatches})
    write_json(output / "local-broadcast-public-extract.json", evidence)
    return evidence


class Rpc:
    def __init__(self, output):
        self.output = output
        self.counter = 0
        self.errors = []

    def call(self, method, params):
        if method not in ALLOWED_METHODS:
            raise ValueError("Non-read-only RPC method refused")
        self.counter += 1
        request = {"jsonrpc": "2.0", "id": self.counter, "method": method, "params": params}
        record = {"endpoint": PUBLIC_RPC, "request": request,
                  "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        response = None
        try:
            payload = json.dumps(request).encode()
            operation = urllib.request.Request(PUBLIC_RPC, data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(operation, timeout=25) as result:
                record["http_status"] = result.status
                record["response_text"] = result.read().decode()
            response = json.loads(record["response_text"])
            if response.get("error"):
                record["error"] = response["error"]
            elif response.get("id") != self.counter:
                record["error"] = "JSON-RPC response ID mismatch"
            else:
                record["response"] = response
        except (OSError, ValueError, urllib.error.URLError) as error:
            record["error"] = str(error)
        if "error" in record:
            self.errors.append({"request_number": self.counter, "method": method, "error": record["error"]})
        write_json(self.output / f"rpc-{self.counter:03d}-{method}.json", record)
        return response.get("result") if response and "error" not in record else None


def collect(output, block_number):
    output.mkdir(parents=True, exist_ok=False)
    manifest = json.loads(MANIFEST.read_text())
    write_json(output / "committed-deployment-manifest.json", manifest)
    local_evidence = collect_broadcast(output)
    report = {
        "classification": "PUBLIC TESTNET SANITY VALIDATION",
        "measurement_use": "Deployment/prototype only; excluded from local gas, latency, and security benchmark metrics.",
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "collector_git_commit": command(["git", "rev-parse", "HEAD"]),
        "collector_sha256": digest(Path(__file__)),
        "manifest": {"path": str(MANIFEST.relative_to(ROOT)), "sha256": digest(MANIFEST),
                     "git_blob": command(["git", "rev-parse", "HEAD:shared/deployments/base-sepolia.json"])},
        "manifest_chain_id": manifest["chainId"],
        "manifest_deployment_block": manifest["deploymentBlock"],
        "manifest_deployment_block_limitation": "DeployResearchStack estimates block.number + 1 before broadcasting; independently check each actual creation receipt.",
        "manifest_owner": manifest["owner"],
        "rpc_endpoint": PUBLIC_RPC,
        "rpc_endpoint_provenance": "web/lib/wagmi.ts public default",
        "raw_evidence_directory": str(output.relative_to(ROOT)) if output.is_relative_to(ROOT) else str(output),
        "transactions_submitted": 0,
        "source_verification_status": None,
        "source_verification_missing_reason": "No authenticated explorer verification evidence collected; explorer links alone do not prove verification.",
        "local_broadcast_extract": "local-broadcast-public-extract.json",
        "local_broadcast_mapping_mismatch_count": sum(len(entry["creation_mapping_mismatches"]) for entry in local_evidence),
        "limitations": ["Local optional broadcast files are not committed; sanitized public extracts and original file hashes preserve provenance.",
                        "Observed deployed bytecode hashes do not prove equality to this checkout's compiler output or source verification.",
                        "A single public RPC endpoint supplies live evidence; no independent-provider consensus check."],
        "contracts": [],
    }
    roles = [(role, address) for role, address in manifest.items()
             if role != "owner" and isinstance(address, str) and re.fullmatch(r"0x[0-9a-fA-F]{40}", address)]
    rpc = Rpc(output)
    observed_chain = rpc.call("eth_chainId", [])
    report["observed_chain_id"] = int(observed_chain, 16) if observed_chain else None
    report["chain_id_matches"] = report["observed_chain_id"] == manifest["chainId"] if observed_chain else None
    pinned = None
    if report["chain_id_matches"]:
        pinned = hex(block_number) if block_number is not None else rpc.call("eth_blockNumber", [])
    report["pinned_block_number"] = int(pinned, 16) if pinned else None
    pinned_block = rpc.call("eth_getBlockByNumber", [pinned, False]) if pinned else None
    report["pinned_block_hash"] = pinned_block.get("hash") if pinned_block else None
    live_receipts = {}
    if pinned_block:
        hashes = sorted({entry["transactionHash"] for evidence in local_evidence for entry in evidence["receipts"]
                         if entry.get("transactionHash")})
        for transaction_hash in hashes:
            receipt = rpc.call("eth_getTransactionReceipt", [transaction_hash])
            if receipt and receipt.get("contractAddress") and receipt.get("status") == "0x1":
                if int(receipt["blockNumber"], 16) <= int(pinned, 16):
                    live_receipts[receipt["contractAddress"].lower()] = receipt
    for role, address in roles:
        code = rpc.call("eth_getCode", [address, pinned]) if pinned_block else None
        code_hash = command(["cast", "keccak", code]) if code is not None else None
        receipt = live_receipts.get(address.lower())
        owner_word = rpc.call("eth_call", [{"to": address, "data": "0x8da5cb5b"}, pinned]) if pinned_block and role in ("accountV1", "accountV2") else None
        observed_owner = "0x" + owner_word[-40:] if owner_word and re.fullmatch(r"0x[0-9a-fA-F]{64}", owner_word) else None
        report["contracts"].append({
            "role": role, "address": address, "has_runtime_code": code != "0x" if code is not None else None,
            "runtime_bytecode_keccak256": code_hash,
            "runtime_bytecode_bytes": (len(code) - 2) // 2 if code is not None else None,
            "owner_observed": observed_owner,
            "owner_matches_manifest": observed_owner.lower() == manifest["owner"].lower() if observed_owner else None,
            "deployment_transaction_hash": receipt["transactionHash"] if receipt else None,
            "deployment_block": int(receipt["blockNumber"], 16) if receipt else None,
            "deployment_block_hash": receipt["blockHash"] if receipt else None,
            "deployment_receipt_source": "eth_getTransactionReceipt at or before pinned block" if receipt else None,
            "verified_source_status": None,
            "explorer_link": f"https://sepolia.basescan.org/address/{address}#code",
            "explorer_link_status": "Generated link; verification status not checked",
        })
    block_after = rpc.call("eth_getBlockByNumber", [pinned, False]) if pinned_block else None
    report["pinned_block_hash_stable"] = block_after.get("hash") == pinned_block.get("hash") if block_after and pinned_block else None
    report["rpc_errors"] = rpc.errors
    report["status"] = "COLLECTED" if pinned_block and not rpc.errors and report["pinned_block_hash_stable"] else "MISSING_OR_PARTIAL"
    report["all_manifest_contracts_have_code"] = all(entry["has_runtime_code"] is True for entry in report["contracts"]) if pinned_block else None
    report["account_owners_match"] = all(entry["owner_matches_manifest"] is True for entry in report["contracts"] if entry["role"].startswith("account")) if pinned_block else None
    report["actual_deployment_blocks"] = sorted({entry["deployment_block"] for entry in report["contracts"] if entry["deployment_block"] is not None})
    report["deployment_transactions_verified"] = sum(entry["deployment_transaction_hash"] is not None for entry in report["contracts"])
    write_json(output / "validation.json", report)
    canonical = output.parent / "base-sepolia-validation.json"
    if not canonical.exists() and report["status"] == "COLLECTED":
        write_json(canonical, report)
    print(json.dumps({"status": report["status"], "output": str(output), "contracts": len(report["contracts"]),
                      "pinned_block": report["pinned_block_number"], "rpc_errors": len(rpc.errors)}))
    return 0 if report["status"] == "COLLECTED" else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New evidence directory; existing evidence is never overwritten")
    parser.add_argument("--block", type=int, help="Optional public chain block number to pin")
    arguments = parser.parse_args()
    return collect(arguments.output.resolve(), arguments.block)


if __name__ == "__main__":
    raise SystemExit(main())
