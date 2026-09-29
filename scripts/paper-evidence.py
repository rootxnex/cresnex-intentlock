"""Research evidence collection; test logs are not transaction measurements."""
import datetime
import argparse
import hashlib
import json
import pathlib
import platform
import subprocess
import sys
import os

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'paper-artifacts'


def capture(command, cwd=ROOT, env=None):
    try:
        result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, check=False, env=env)
        return {'command': command, 'exit_code': result.returncode, 'output': result.stdout}
    except FileNotFoundError as error:
        return {'command': command, 'exit_code': 127, 'output': str(error)}


def save(relative, value):
    path = OUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n' if not isinstance(value, str) else value)


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=OUT,
                        help='New output directory; existing evidence is never overwritten.')
    parser.add_argument('--hash-parity', action='store_true',
                        help='Start an ephemeral localhost Anvil for read-only hash comparisons after deployment.')
    args = parser.parse_args()
    OUT = args.output.resolve()
    if OUT.exists():
        raise SystemExit('Refusing to overwrite existing evidence. Select a new --output directory.')
    for directory in ['raw', 'processed', 'logs', 'environment', 'figures', 'tables',
                      'reproducibility', 'system', 'baselines', 'corpus', 'deployment']:
        (OUT / directory).mkdir(parents=True, exist_ok=True)
    state = {name: capture(command) for name, command in {
        'branch': ['git', 'branch', '--show-current'], 'commit': ['git', 'rev-parse', 'HEAD'],
        'status': ['git', 'status', '--porcelain'], 'log': ['git', 'log', '-1', '--format=fuller'],
    }.items()}
    save('environment/git-state.txt', json.dumps(state, indent=2) + '\n')
    versions = {tool: capture([tool, '--version']) for tool in ['forge', 'cast', 'anvil', 'node', 'npm', 'bun', 'solc']}
    save('environment/versions.txt', json.dumps(versions, indent=2) + '\n')
    config = capture(['forge', 'config', '--json'], ROOT / 'contracts')
    save('environment/foundry-effective.json', config)
    save('environment/foundry.toml', (ROOT / 'contracts/foundry.toml').read_text())
    dependencies = {name: capture(['git', '-C', str(ROOT / 'contracts/lib' / name), 'rev-parse', 'HEAD'])
                    for name in ['openzeppelin-contracts', 'forge-std']}
    dependencies['lockfiles_sha256'] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in ROOT.glob('*/package-lock.json')}
    save('environment/dependencies.json', dependencies)
    lock = json.loads((ROOT / 'scripts/paper/toolchain-lock.json').read_text())
    mismatches = []
    for tool, expected in lock['tools'].items():
        observed = versions[tool]['output'].splitlines()[0] if versions[tool]['output'] else ''
        if versions[tool]['exit_code'] or observed != expected:
            mismatches.append({'item': tool, 'expected': expected, 'actual': observed})
        if tool in ['forge', 'cast', 'anvil'] and lock['foundry_commit'] not in versions[tool]['output']:
            mismatches.append({'item': tool + ' commit', 'expected': lock['foundry_commit'], 'actual': versions[tool]['output']})
    for name, expected in lock['dependencies'].items():
        observed = dependencies[name]['output'].strip()
        if dependencies[name]['exit_code'] or observed != expected:
            mismatches.append({'item': name, 'expected': expected, 'actual': observed})
    observed = dependencies['lockfiles_sha256'].get('web/package-lock.json')
    if observed != lock['web_package_lock_sha256']:
        mismatches.append({'item': 'web/package-lock.json', 'expected': lock['web_package_lock_sha256'], 'actual': observed})
    save('environment/toolchain-verification.json', {'status': 'FAIL' if mismatches else 'PASS', 'mismatches': mismatches, 'lock': lock})
    save('environment/environment.json', {
        'timestamp_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'platform': platform.platform(), 'architecture': platform.machine(),
        'cpu': capture(['lscpu']), 'memory': pathlib.Path('/proc/meminfo').read_text(),
        'git': state, 'versions': versions, 'local_chain_id': None, 'anvil_startup_options': None,
        'measurement_status': 'CORRECTNESS_GATE_ONLY',
    })
    if mismatches:
        save('PAPER_DATA_MANIFEST.md', '# Collection blocked\n\nToolchain differs from frozen requirements. See environment/toolchain-verification.json. No experiments executed.\n')
        return 1
    environment = os.environ.copy()
    environment['FOUNDRY_FUZZ_SEED'] = '0x20260928'
    save('reproducibility/run-settings.json', {'fuzz_seed': '0x20260928', 'note': 'Existing regression suite; seed does not create a new scenario corpus. Invariant engine uses Foundry configuration; retain generated runner output.'})
    checks = [
        ('format', ['forge', 'fmt', '--check'], 'contracts'),
        ('compile', ['forge', 'build'], 'contracts'),
        ('tests', ['forge', 'test'], 'contracts'),
        ('fuzz', ['forge', 'test', '--match-path', 'test/fuzz/*'], 'contracts'),
        ('invariant', ['forge', 'test', '--match-path', 'test/invariant/*'], 'contracts'),
        ('gas-report', ['forge', 'test', '--gas-report'], 'contracts'),
        ('coverage', ['forge', 'coverage'], 'contracts'),
        ('snapshot', ['forge', 'snapshot', '--snap', str(OUT / 'raw/forge.snapshot')], 'contracts'),
        ('sdk', ['npm', 'run', 'test:sdk'], 'web'),
        ('lint', ['npm', 'run', 'lint'], 'web'),
        ('typecheck', ['npm', 'run', 'typecheck'], 'web'),
        ('frontend-build', ['npm', 'run', 'build'], 'web'),
    ]
    results = []
    for name, command, folder in checks:
        print('Running ' + name, flush=True)
        result = capture(command, ROOT / folder, environment)
        save('logs/' + name + '.log', result['output'])
        results.append({'name': name, 'command': command, 'exit_code': result['exit_code']})
        save('logs/check-results.json', results)
        print(name + ': exit ' + str(result['exit_code']), flush=True)
    if next(item for item in results if item['name'] == 'coverage')['exit_code']:
        result = capture(['forge', 'coverage', '--ir-minimum'], ROOT / 'contracts', environment)
        save('logs/coverage-ir-minimum.log', result['output'])
        save('logs/coverage-retry.json', {'command': result['command'], 'exit_code': result['exit_code'], 'note': 'Separate coverage workaround; never changes production settings or hides original failure.'})
    extras = [
        ('source-inventory', [sys.executable, '-B', 'scripts/paper-source-inventory.py', '--output', str(OUT / 'system')]),
        ('source-audit', [sys.executable, '-B', 'scripts/paper/export_audit.py', '--output', str(OUT)]),
    ]
    if args.hash_parity and not next(item for item in results if item['name'] == 'compile')['exit_code']:
        extras.append(('hash-parity', ['node', '--experimental-strip-types', 'web/scripts/paper-hash-check.mjs', str(OUT / 'reproducibility/hash-parity')]))
    for name, command in extras:
        print('Running ' + name, flush=True)
        result = capture(command)
        save('logs/' + name + '.log', result['output'])
        results.append({'name': name, 'command': command, 'exit_code': result['exit_code']})
        save('logs/check-results.json', results)
    artifact_path = ROOT / 'contracts/out/CresnexIntentLockAccountV2.sol/CresnexIntentLockAccountV2.json'
    compiler = json.loads(artifact_path.read_text())['metadata']['compiler']['version'] if artifact_path.exists() else None
    if compiler != lock['solc_metadata_version']:
        results.append({'name': 'solc-version', 'exit_code': 1, 'actual': compiler, 'expected': lock['solc_metadata_version']})
        save('logs/check-results.json', results)
    failures = [result['name'] for result in results if result['exit_code']]
    save('PAPER_DATA_MANIFEST.md', '# IntentLock evidence collection\n\n'
         + 'Source commit: ' + state['commit']['output'].strip() + '\n\n'
         + 'Branch: ' + state['branch']['output'].strip() + '\n\n'
         + 'Status: correctness gate collected; NOT a publication dataset.\n\n'
         + 'Failed checks: ' + (', '.join(failures) or 'none') + '\n\n'
         + 'Measured scenarios: 0. Benchmark executions: 0.\n\n'
         + 'MISSING: frozen final experiment commit; corpus; '
         + 'baseline experiments; per-transaction gas; latency; security metrics; paired statistics; '
         + 'atomic containment measurements; publication tables and figures; testnet validation.\n\n'
         + 'Existing Forge test gas is test-function gas, not publication transaction gas. '
         + 'No expected outcomes have been substituted for observations. See logs/check-results.json '
         + 'and complete logs for the correctness gate. Environment captures include the actual working-tree state.\n\n'
         + 'Source property definitions, scope, schemas and source/configuration tables are exported. '
         + 'Hash parity is optional and stored separately when --hash-parity is selected. '
         + 'This entrypoint is an evidence/correctness collector, not a complete benchmark runner.\n')
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())
