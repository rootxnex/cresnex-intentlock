# Project governance

Cresnex IntentLock is currently maintainer-led. The project's priority is a small, reviewable security boundary rather than rapid feature growth.

## Roles

- **Maintainers** manage releases, repository settings, disclosures, and final merge decisions.
- **Reviewers** provide domain-specific review but do not gain release authority automatically.
- **Contributors** propose issues, code, tests, research, and documentation.

The current maintainer list is represented by users with GitHub write or maintain access.

## Decision process

Routine documentation, frontend, and test changes use normal pull-request review. The following require an issue or design document before implementation:

- EIP-712 schema or canonical hashing changes;
- contract storage or public API changes;
- new owner or agent authority;
- changes to isolation, nonce, evidence, strike, or quarantine semantics;
- deployment to a new chain;
- dependency major-version changes; and
- ERC-4337 or ERC-7579 integration.

Security takes priority over API stability during the `v0.x` beta. Breaking changes must include a migration note and version increment.

## Merge and release policy

- CI must pass before merge.
- Contract changes require at least one independent reviewer when the contributor base permits.
- Security-critical changes should include unit and adversarial/stateful tests.
- Tagged releases are immutable snapshots; corrections use a new version.
- Releases remain testnet-only until an independent audit and explicit governance decision change that status.

## Licensing and contributions

The repository is MIT licensed. Contributors retain copyright in their work and license contributions under MIT. Contributors are expected to use a Developer Certificate of Origin sign-off.

Organizations and contributors are responsible for confirming that their employment, academic, or funding agreements permit contribution.
