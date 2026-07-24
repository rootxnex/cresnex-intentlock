# Contributing to Cresnex IntentLock

Thank you for helping improve Cresnex IntentLock. This repository is an open-source, testnet-only security research beta. Contributions must not describe the code as audited, production-ready, or safe for real assets.

## Before contributing

- Read the [architecture](docs/architecture.md), [threat model](docs/threat-model.md), and [security policy](SECURITY.md).
- Use an issue or draft pull request before making a large public-API or security-model change.
- Do not report vulnerabilities in public issues. Follow `SECURITY.md`.
- Confirm that you have the right to submit the work under the repository's MIT License.

## Development setup

Requirements:

- Foundry 1.7 or newer
- Node.js 20 or newer
- npm 10 or newer

Clone submodules and install the frontend:

```bash
git clone --recurse-submodules https://github.com/rootxnex/cresnex-intentlock.git
cd cresnex-intentlock
cd web
npm ci
```

If the repository was cloned without submodules:

```bash
git submodule update --init --recursive
```

## Required validation

Run all checks before requesting review:

```bash
cd contracts
forge fmt --check src test script
forge build
forge test
forge coverage

cd ../web
npm ci
npm run lint
npm run typecheck
npm run build
```

Never weaken or delete a security test merely to make CI pass.

## Pull requests

Keep each pull request focused. Include:

- the problem and intended behavior;
- security and compatibility impact;
- public API or EIP-712 schema impact;
- tests added or updated;
- commands used for validation; and
- documentation changes.

Contract changes should explain trust-boundary effects. Changes to `IntentManifest`, call hashing, events, or public functions must update Solidity, frontend types/ABI, generated ABI artifacts, tests, and documentation together.

## Commit and review expectations

- Never commit secrets, `.env` files, private RPC credentials, private keys, seed phrases, or keystore passwords.
- Preserve external-self-call isolation and persistent containment.
- Do not introduce `tx.origin`, arbitrary `delegatecall`, or upgradeability.
- Keep mocks and testnet-only code clearly labelled.
- Require review for contract, workflow, deployment, and dependency changes.

## Developer Certificate of Origin

By contributing, you certify that you wrote the contribution or otherwise have the right to submit it under the project's MIT License. Add a sign-off with:

```bash
git commit --signoff
```

The sign-off uses the Developer Certificate of Origin convention:

```text
Signed-off-by: Your Name <your.email@example.com>
```
