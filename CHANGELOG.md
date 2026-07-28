# Changelog

All notable project changes will be documented here.

The project follows semantic versioning while in beta. `0.x` releases may contain breaking changes to contracts, typed-data schemas, SDKs, or deployment configuration.

## [Unreleased]

### Added

- Separate `CresnexIntentLockAccountV2` Phase 1 research contract and EIP-712 schema.
- Bounded multi-asset, allowance, and native-token outcome constraints.
- Transfer, swap, approval, and ordered-batch policy modules.
- Stable violation codes, compact v2 evidence, nonce cancellation, and emergency agent revocation.
- V2 unit, fuzz, stateful invariant, and gas benchmark coverage.
- Non-punitive ordinary execution-failure classification.
- ERC-4626-shaped deposit and withdrawal policy modules with measured asset/share outcomes.
- Controlled yield-rebalance policy with ordered approved vaults, aggregate movement caps, and deterministic mock pricing.
- Mock vault and price fixtures plus malicious DeFi, fuzz, invariant, and gas coverage.
- Bounded treasury, payroll, and recurring subscription policy modules.
- Persistent treasury references/epoch budgets, payroll IDs/periods, subscription periods/counts, and owner cancellation.
- Payment timing, duplicate-charge, budget, fuzz, stateful invariant, and gas coverage.
- Exact mock ERC-721/ERC-1155 purchase policies with measured payment, delivery, quantity, recipient, and residual-allowance checks.
- Selector-allowlisted bounded administration policies for numeric values, approved addresses, pause state, roles, and treasury limits.
- Immutable external Phase 4 validator module to keep policy logic isolated without upgradeability or `delegatecall`.
- Versioned TypeScript v2 SDK with Solidity-compatible call/policy hashing and strict signed-package validation.
- Twelve-module v2 browser builder, advisory execution simulation, bigint-safe JSON import/export, actionable errors, and decoded evidence timeline.
- Clearly labelled signature-only, spend-only, and path-plus-spend academic baseline accounts.
- Thirty-run benign/wrong-recipient comparison reports in JSON and CSV with explicit measurement limitations.
- Full-stack local/Base Sepolia deployment script, public manifest writer, local Anvil smoke test, and measured dashboard results.
- MIT open-source license and contributor governance.
- Security disclosure and code-of-conduct policies.
- Issue and pull-request templates.
- Dependabot and CodeQL configuration.
- Public beta roadmap and release gates.
- Repository secret scanning, push protection, and private vulnerability reporting.

### Security

- Bounded failed target returndata copying to 256 bytes while retaining size-bound evidence.
- Updated and pinned frontend dependencies to resolve the initial public-repository audit alerts.
- Classified internally inconsistent module/constraint packages as structural failures before nonce consumption.
- Restricted deposit and yield modules to their approved selectors, recipients, share owners, and allowance destinations.
- Rejected unsupported evidence modes and duplicate yield-vault entries to prevent ambiguous accounting.
- Rejected hidden NFT/admin calls, unsafe NFT approvals, missing NFT delivery, ownership transfer, proxy upgrades, and out-of-range administration values.

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
