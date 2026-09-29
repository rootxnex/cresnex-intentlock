"""Stage-aware entrypoint for the IntentLock paper evidence workflow."""

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]
LOCK = ROOT / "scripts/paper/toolchain-lock.json"
CANONICAL = ROOT / "paper-artifacts"


def run(command, cwd=ROOT):
    print("+ " + " ".join(str(part) for part in command), flush=True)
    return subprocess.run(command, cwd=cwd, check=False).returncode


def first_line(command):
    result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    lines = result.stdout.splitlines()
    return result.returncode, lines[0] if lines else "", result.stdout


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_versions():
    lock = json.loads(LOCK.read_text())
    mismatches = []
    full_outputs = {}
    for tool, expected in lock["tools"].items():
        code, observed, output = first_line([tool, "--version"])
        full_outputs[tool] = output
        if code or observed != expected:
            mismatches.append({"item": tool, "expected": expected, "actual": observed, "exit_code": code})
        if tool in {"forge", "cast", "anvil"} and lock["foundry_commit"] not in output:
            mismatches.append({"item": tool + " commit", "expected": lock["foundry_commit"], "actual": output})
    for dependency, expected in lock["dependencies"].items():
        code, observed, _ = first_line(["git", "-C", str(ROOT / "contracts/lib" / dependency), "rev-parse", "HEAD"])
        if code or observed != expected:
            mismatches.append({"item": dependency, "expected": expected, "actual": observed, "exit_code": code})
    package_lock = ROOT / "web/package-lock.json"
    observed_lock = sha256(package_lock)
    if observed_lock != lock["web_package_lock_sha256"]:
        mismatches.append({"item": "web/package-lock.json", "expected": lock["web_package_lock_sha256"], "actual": observed_lock})
    artifact = ROOT / "contracts/out/CresnexIntentLockAccountV2.sol/CresnexIntentLockAccountV2.json"
    if not artifact.exists():
        mismatches.append({"item": "V2 build artifact", "expected": "present", "actual": "missing; run correctness/build stage"})
    else:
        compiler = json.loads(artifact.read_text())["metadata"]["compiler"]["version"]
        if compiler != lock["solc_metadata_version"]:
            mismatches.append({"item": "solc metadata", "expected": lock["solc_metadata_version"], "actual": compiler})
    print(json.dumps({"status": "FAIL" if mismatches else "PASS", "mismatches": mismatches}, indent=2))
    return 1 if mismatches else 0


def require_new(path, label):
    if path is None:
        raise SystemExit(f"{label} requires --output NEW_PATH")
    resolved = path.resolve()
    if resolved.exists():
        raise SystemExit(f"Refusing to overwrite existing {label} output: {resolved}")
    return resolved


def validate_preparation(root):
    commands = [
        [sys.executable, "-B", "scripts/paper/generate_corpus.py", "--validate", str(root / "corpus")],
        ["node", "--experimental-strip-types", "web/scripts/paper-pilot.mjs", "--validate", str(root / "pilot")],
    ]
    if verify_versions():
        return 1
    return max(run(command) for command in commands)


def status():
    paths = {
        "toolchain_lock": LOCK,
        "correctness_results": CANONICAL / "logs/check-results.json",
        "corpus": CANONICAL / "corpus/scenario-manifest.json",
        "pilot": CANONICAL / "pilot",
        "final_executions": CANONICAL / "raw/executions.jsonl",
        "security_metrics": CANONICAL / "processed/security-metrics.json",
        "tables": CANONICAL / "tables",
        "figures": CANONICAL / "figures",
    }
    result = {key: {"path": str(path.relative_to(ROOT)), "exists": path.exists()} for key, path in paths.items()}
    result["final_benchmark_implemented"] = False
    result["analysis_implemented"] = False
    result["publication_generation_implemented"] = False
    print(json.dumps(result, indent=2))
    return 0


def unavailable(stage):
    print(json.dumps({
        "status": "MISSING",
        "stage": stage,
        "reason": "The final 1,000-scenario benchmark and downstream publication analysis are intentionally not implemented or run in the preparation session.",
        "next_gate": "Review and freeze the validated pilot, corpus, protocol, and experiment commit before implementing this stage.",
    }, indent=2))
    return 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", default="status", choices=[
        "status", "versions", "correctness", "corpus", "pilot", "validate-preparation",
        "final-benchmark", "analyze", "tables", "figures", "all",
    ])
    parser.add_argument("--output", type=pathlib.Path,
                        help="A new output path. Existing paths are never overwritten by execution stages.")
    parser.add_argument("--artifacts", type=pathlib.Path, default=CANONICAL,
                        help="Existing artifact root used by validation stages.")
    parser.add_argument("--hash-parity", action="store_true",
                        help="Include the localhost-only hash-parity check in a new correctness collection.")
    args = parser.parse_args()

    if args.stage == "status":
        return status()
    if args.stage == "versions":
        return verify_versions()
    if args.stage == "correctness":
        output = require_new(args.output, "correctness")
        command = [sys.executable, "scripts/paper-evidence.py", "--output", str(output)]
        if args.hash_parity:
            command.append("--hash-parity")
        return run(command)
    if args.stage == "corpus":
        output = require_new(args.output, "corpus")
        return run([sys.executable, "-B", "scripts/paper/generate_corpus.py", "--output", str(output)])
    if args.stage == "pilot":
        output = require_new(args.output, "pilot")
        return run(["node", "--experimental-strip-types", "web/scripts/paper-pilot.mjs", "--output", str(output)])
    if args.stage == "validate-preparation":
        return validate_preparation(args.artifacts.resolve())
    if args.stage in {"final-benchmark", "analyze", "tables", "figures"}:
        return unavailable(args.stage)
    if args.stage == "all":
        output = require_new(args.output, "pipeline")
        output.mkdir(parents=True)
        checks = [
            verify_versions(),
            run([sys.executable, "scripts/paper-evidence.py", "--output", str(output / "correctness")]),
            run([sys.executable, "-B", "scripts/paper/generate_corpus.py", "--output", str(output / "corpus")]),
            run(["node", "--experimental-strip-types", "web/scripts/paper-pilot.mjs", "--output", str(output / "pilot")]),
        ]
        if max(checks):
            return max(checks)
        return unavailable("final-benchmark")
    raise AssertionError(args.stage)


if __name__ == "__main__":
    raise SystemExit(main())
