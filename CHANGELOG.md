# Changelog

All notable project changes will be documented here.

The project follows semantic versioning while in beta. `0.x` releases may contain breaking changes to contracts, typed-data schemas, SDKs, or deployment configuration.

## [Unreleased]

### Added

- MIT open-source license and contributor governance.
- Security disclosure and code-of-conduct policies.
- Issue and pull-request templates.
- Dependabot and CodeQL configuration.
- Public beta roadmap and release gates.
- Repository secret scanning, push protection, and private vulnerability reporting.

### Security

- Bounded failed target returndata copying to 256 bytes while retaining size-bound evidence.
- Updated and pinned frontend dependencies to resolve the initial public-repository audit alerts.

## [0.1.0] - 2026-07-24

### Added

- Standalone IntentLock account with owner-signed EIP-712 intents.
- Exact ordered call hashing and isolated external self-call execution.
- Spend, output, recipient, and final-allowance postconditions.
- Persistent violation evidence, strikes, and agent quarantine.
- Foundry unit, fuzz, invariant, gas, and coverage workflows.
- Next.js dashboard for owner controls, intent signing, agent submission, and evidence events.
- Base Sepolia research deployment workflow and Vercel hosting support.

[Unreleased]: https://github.com/rootxnex/cresnex-intentlock/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rootxnex/cresnex-intentlock/releases/tag/v0.1.0
