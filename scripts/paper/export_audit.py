"""Export source-grounded research records without manufacturing execution data."""

import argparse
import copy
import csv
import datetime
import hashlib
import io
import json
import pathlib
import re
import subprocess

from specification import ACCOUNT, VALIDATOR, PROPERTIES, SCOPE, FAILURES, RAW_FIELDS, METRIC_PROTOCOL

ROOT = pathlib.Path(__file__).resolve().parents[2]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def active_source(source):
    pattern = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*[\s\S]*?\*/'
    return re.sub(pattern, lambda match: re.sub(r'[^\n]', ' ', match[0])
                  if match[0].startswith(('//', '/*')) else match[0], source)


def locate(reference):
    path = ROOT / reference['file']
    source = active_source(path.read_text())
    matches = list(re.finditer(r'\bfunction\s+' + re.escape(reference['function']) + r'\s*\(', source))
    if len(matches) != 1:
        raise ValueError(f'Expected one active function: {reference}; found {len(matches)}')
    return {**reference, 'line': source.count('\n', 0, matches[0].start()) + 1, 'file_sha256': digest(path)}


def csv_text(rows, fields=None):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=fields or list(rows[0]), lineterminator='\n')
    writer.writeheader()
    writer.writerows({key: 'NA' if value is None else value for key, value in row.items()} for row in rows)
    return stream.getvalue()


def source_records():
    properties = copy.deepcopy(PROPERTIES)
    for entry in properties:
        for field in ('relevant_contract_functions', 'tests'):
            entry[field] = [locate(reference) for reference in entry[field]]
    return properties


def baselines():
    definitions = [
        ('A', 'SignatureOnlyAccount', 'execute', 'agent, nonce, validUntil; chain/account in personal-sign digest', 'Generic single CALL', 'No target, calldata, value or outcome commitment; target failure reverts nonce.'),
        ('B', 'SpendLimitGuardAccount', 'transfer', 'agent, token, maximum, nonce, validUntil; chain/account in personal-sign digest', 'ERC20 transfer only', 'Recipient not signed; raw transfer true checked; no post-state. Token false return shares SpendExceeded classification.'),
        ('C', 'PathAndSpendGuardAccount', 'execute', 'agent, target, selector, maximum, nonce, validUntil; chain/account in personal-sign digest', 'One 68-byte (address,uint256)-shaped call', 'First address argument not signed. No value parameter or batch; selector is signed, not hardcoded to transfer.'),
        ('D', 'CresnexIntentLockAccountV2', 'executeIntent', 'Complete EIP-712 manifest; ordered calls and policy', 'V2 fixed policy modules and ordered calls', 'Listed outcome constraints only; successful outer receipt may contain rejected inner execution.'),
    ]
    rows = []
    for identifier, name, entrypoint, signed, workload, limitations in definitions:
        path = ACCOUNT if identifier == 'D' else f'contracts/src/baselines/{name}.sol'
        rows.append({'baseline_id': identifier, 'name': name, 'status': 'EXISTING_RESEARCH_CODE',
                     'source': locate({'file': path, 'function': entrypoint}),
                     'signed_authorization': signed, 'workload_applicability': workload,
                     'limitations': limitations, 'benchmark_executions': 0})
    rows.append({'baseline_id': 'E', 'name': 'SemanticGuardAccount', 'status': 'MISSING',
                 'source': None, 'signed_authorization': None, 'workload_applicability': None,
                 'limitations': 'No implemented semantic baseline. A fair shared method specification and workload scope are unresolved; no substitute results.',
                 'benchmark_executions': 0})
    return rows


def execution_schema():
    booleans = set('harmful_state_survived rollback_success evidence_created quarantined_before quarantined_after authentication_passed nonce_used_before nonce_used_after'.split())
    integers = set('chain_id valid_after valid_until batch_size gas_used block_number outer_receipt_status repetition'.split())
    amounts = set('seed amount max_spend msg_value allowance_requested allowance_limit min_out actual_out nonce pre_owner_balance post_owner_balance pre_account_balance post_account_balance pre_recipient_balance post_recipient_balance pre_allowance post_allowance strike_before strike_after execution_time_ns'.split())
    properties = {}
    for field in RAW_FIELDS:
        kind = 'boolean' if field in booleans else 'integer' if field in integers else 'number' if field == 'execution_time_ms' else 'string'
        properties[field] = {'type': [kind, 'null']}
        if field in amounts:
            properties[field]['pattern'] = '^(0|[1-9][0-9]*)$'
        if field in integers or field == 'execution_time_ms':
            properties[field]['minimum'] = 0
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'title': 'IntentLock raw execution row, prospective schema',
            'type': 'object', 'additionalProperties': False, 'required': RAW_FIELDS, 'properties': properties,
            '$comment': 'All absent JSON fields are explicit null; CSV uses NA. Uint256/token amounts use decimal strings, never float. Owner balance and account balance are distinct. NOT_APPLICABLE denotes no execution. Schema existence is not a dataset.'}


def correctness(checks_root):
    rows = []
    path = checks_root / 'logs/check-results.json'
    if not path.exists():
        return rows
    for result in json.loads(path.read_text()):
        log = checks_root / 'logs' / (result['name'] + '.log')
        content = log.read_text() if log.exists() else ''
        counts = re.search(r'(\d+) tests passed, (\d+) failed, (\d+) skipped', content)
        tap = re.search(r'^# pass (\d+)\s*\n# fail (\d+)', content, re.M)
        rows.append({'check': result['name'], 'exit_code': result['exit_code'],
                     'passed': int(counts[1]) if counts else int(tap[1]) if tap else None,
                     'failed': int(counts[2]) if counts else int(tap[2]) if tap else None,
                     'skipped': int(counts[3]) if counts else None,
                     'count_unit': 'Forge test invocations' if counts else 'Node TAP reported units (may be test files)' if tap else 'command exit only',
                     'log': str(log.relative_to(ROOT)) if log.is_relative_to(ROOT) else str(log),
                     'log_sha256': digest(log) if log.exists() else None,
                     'independent_scenario_count': None})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'paper-artifacts')
    parser.add_argument('--checks-root', type=pathlib.Path)
    args = parser.parse_args()
    output = args.output.resolve()
    checks_root = (args.checks_root or output).resolve()
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    properties = source_records()
    definitions = baselines()
    scope = [{'topic': topic, 'classification': classification, 'evidence_and_limits': limits}
             for topic, classification, limits in SCOPE]
    taxonomy = [{'category': category, 'error_names': names, 'classification_rule': rule}
                for category, (names, rule) in FAILURES.items()]
    source_paths = sorted(set(list((ROOT / 'contracts/src').rglob('*.sol'))
                              + list((ROOT / 'contracts/test').rglob('*.sol'))
                              + [ROOT / 'contracts/foundry.toml', ROOT / 'web/lib/intentV2.ts', ROOT / 'web/package-lock.json']))
    source_hashes = {str(path.relative_to(ROOT)): digest(path) for path in source_paths}
    artifact_path = ROOT / 'contracts/out/CresnexIntentLockAccountV2.sol/CresnexIntentLockAccountV2.json'
    artifact = json.loads(artifact_path.read_text()) if artifact_path.exists() else None
    compiler = {'status': 'BUILD_ARTIFACT_METADATA' if artifact else 'MISSING',
                'artifact': str(artifact_path.relative_to(ROOT)),
                'sha256': digest(artifact_path) if artifact else None,
                'compiler': artifact['metadata']['compiler'] if artifact else None,
                'settings': artifact['metadata']['settings'] if artifact else None}
    semantics = {
        'status': 'SOURCE_OBSERVATIONS', 'git_commit': commit,
        'domain': {'name': 'Cresnex IntentLock', 'version': '2', 'chainId': 'block.chainid', 'verifyingContract': 'address(this)', 'source': ACCOUNT + ':constructor'},
        'calls_hash': {'source': locate({'file': ACCOUNT, 'function': 'hashCalls'}), 'construction': 'keccak256(abi.encode(calls.length, ordered array of hashExecutionCall(call))); each call commits typehash,target,value,keccak256(data),operation'},
        'policy_hash': {'source': locate({'file': ACCOUNT, 'function': 'hashPolicy'}), 'construction': 'keccak256(abi.encode(POLICY_TYPEHASH,module,keccak256(abi.encode(asset count,ordered asset hashes)),keccak256(abi.encode(allowance count,ordered allowance hashes)),native maxSpend,native minFinalBalance,keccak256(moduleData)))'},
        'limits': {'max_calls': 16, 'max_asset_constraints': 8, 'max_allowance_constraints': 8, 'max_target_revert_copy_bytes': 256, 'default_quarantine_threshold': 3, 'source': ACCOUNT},
        'nonce': 'Account-global unordered uint256 map. Consumed after authentication before isolation; success/policy violation/ordinary inner failure retain it only if outer execution finishes. Owner can cancel.',
        'validity': 'validUntil > validAfter; inclusive endpoints; enforced by _authenticate.',
        'operations': 'Only enum Call; target zero/self rejected; ordinary CALL via _boundedCall. No delegatecall interface.',
        'evidence': 'evidenceMode must be 1. Policy violations store ViolationRecord at outer evidenceHash; record.evidenceHash contains INNER evidence. ExecutionFailed hash is not a stored violation.',
        'state_reads': 'Account native balance; each listed token account and recipient balance before/after; final listed token/spender allowance. No general pre-allowance snapshot. Supplemental NFT/Yield checks in validator.',
        'rollback': 'executeIntent external-self-calls onlySelf executeIsolated; inner revert rolls back synchronous inner effects; outer records evidence/strike/quarantine. Outer revert discards everything.',
        'containment': 'Owner-only recovery. Unquarantine and strike reset are separate. Threshold evaluated on new strike; changing threshold does not retroactively quarantine.',
        'secondary_modules': 'DeFi/payment/NFT/administration source present but not a measured baseline experiment.',
    }
    implementation = ['# V2 implementation map', '', 'Source observations only. Commented legacy function bodies are excluded.', '']
    for entry in properties:
        refs = ', '.join(f"`{ref['file']}:{ref['line']}` (`{ref['function']}`)" for ref in entry['relevant_contract_functions'])
        implementation += [f"- {entry['property_id']} {entry['description']}: {refs}"]
    implementation += ['', 'Tests mapped in security-properties.json prove only their explicit assertions.', 'Missing dedicated V2 tests are not filled with similarly named V1 tests.', '']
    table_definitions = [{key: value for key, value in row.items() if key != 'source'} for row in definitions]
    config_rows = [{'parameter': 'source_commit', 'value': commit, 'provenance': 'git rev-parse HEAD'},
                   {'parameter': 'solidity', 'value': compiler['compiler']['version'] if artifact else None, 'provenance': compiler['artifact']},
                   {'parameter': 'benchmark_execution_count', 'value': 0, 'provenance': 'No benchmark dataset produced'},
                   {'parameter': 'measurement_status', 'value': 'MISSING', 'provenance': 'Coverage gate and final experiment protocol unresolved'}]
    if artifact:
        for key in ('optimizer', 'viaIR', 'evmVersion'):
            config_rows.append({'parameter': key, 'value': json.dumps(compiler['settings'].get(key)), 'provenance': compiler['artifact']})
    table_status = [{'table': number, 'status': 'SOURCE_OR_ENVIRONMENT_ONLY' if number in (1, 2, 11) else 'MISSING',
                     'reason': 'Source/configuration table; not measured effectiveness' if number in (1, 2, 11) else 'No validated per-execution dataset'} for number in range(1, 12)]
    files = {
        'system/security-properties.json': {'git_commit': commit, 'properties': properties},
        'system/security-scope-matrix.csv': csv_text(scope),
        'system/failure-taxonomy.json': {'status': 'PROSPECTIVE_CLASSIFICATION_RULES', 'categories': taxonomy, 'warning': 'Observed revert alone is never sufficient for security success; validation stage can require trace.'},
        'system/execution-row.schema.json': execution_schema(),
        'system/intent-semantics.json': semantics,
        'system/implementation-map.md': '\n'.join(implementation),
        'baselines/baseline-definitions.json': {'status': 'SOURCE_DEFINITIONS_NOT_BENCHMARK_RESULTS', 'baselines': definitions},
        'reproducibility/analysis-plan.md': METRIC_PROTOCOL,
        'reproducibility/source-freeze.json': {'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source_commit': commit, 'files_sha256': source_hashes, 'source_set_sha256': hashlib.sha256(json.dumps(source_hashes, sort_keys=True).encode()).hexdigest(), 'note': 'Content freeze only; does not claim experiment infrastructure is committed.'},
        'environment/compiler.json': compiler,
        'tables/table-1-system-configuration.csv': csv_text(config_rows),
        'tables/table-2-baseline-definitions.csv': csv_text(table_definitions),
        'tables/table-11-scope-and-limitations.csv': csv_text(scope),
        'tables/TABLE_STATUS.json': table_status,
        'figures/FIGURE_STATUS.json': [{'figure': number, 'status': 'MISSING', 'reason': 'No measured execution dataset; no numbers synthesized for a plot'} for number in range(1, 7)],
    }
    summary = correctness(checks_root)
    if summary:
        files['processed/correctness-summary.csv'] = csv_text(summary)
    conflicts = [name for name in files if (output / name).exists()]
    if conflicts:
        raise SystemExit('Refusing to overwrite evidence: ' + ', '.join(conflicts))
    for name, value in files.items():
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('x') as target:
            target.write(value if isinstance(value, str) else json.dumps(value, indent=2) + '\n')
    print(f'Exported {len(files)} audit artifacts; {len(properties)} properties; no execution measurements.')


if __name__ == '__main__':
    main()
