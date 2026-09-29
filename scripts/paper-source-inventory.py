"""Export source declarations, not measured security or compatibility claims."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'paper-artifacts/system'


def write_new(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / name).open('x') as output:
        json.dump(value, output, indent=2)
        output.write('\n')


def main():
    global OUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=OUT)
    OUT = parser.parse_args().output.resolve()
    names = ['intent-schema.json', 'policy-modules.json', 'test-source-inventory.json']
    if any((OUT / name).exists() for name in names):
        raise SystemExit('Refusing to overwrite source inventory; select a new --output directory.')
    source_path = ROOT / 'contracts/src/IntentTypesV2.sol'
    source = source_path.read_text()
    provenance = {
        'source': str(source_path.relative_to(ROOT)),
        'sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'git_commit': subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'status': 'SOURCE_DECLARATIONS_ONLY',
    }
    structs = {}
    for name, body in re.findall(r'struct\s+(\w+)\s*\{([^}]+)\}', source):
        structs[name] = [
            {'type': field_type, 'name': field_name}
            for field_type, field_name in re.findall(r'(\w+(?:\[\])?)\s+(\w+)\s*;', body)
        ]
    write_new('intent-schema.json', {**provenance, 'structs': structs})
    module_body = re.search(r'enum PolicyModule\s*\{([^}]+)\}', source).group(1)
    write_new('policy-modules.json', {
        **provenance,
        'modules': [{'id': index, 'name': name.strip()}
                    for index, name in enumerate(module_body.split(','))],
        'limitation': 'Enum membership alone does not establish tested module functionality.',
    })
    inventory = []
    for path in sorted((ROOT / 'contracts/test').rglob('*.sol')):
        content = path.read_text()
        inventory.append({
            'file': str(path.relative_to(ROOT)),
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'test_functions': re.findall(r'function\s+((?:test|invariant)\w*)\s*\(', content),
        })
    write_new('test-source-inventory.json', {
        'status': 'DECLARATIONS_NOT_EXECUTION_RESULTS', 'files': inventory,
    })


if __name__ == '__main__':
    main()
