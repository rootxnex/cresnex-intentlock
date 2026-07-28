# Cresnex IntentLock open-source beta roadmap

The roadmap is ordered by security dependency, not marketing priority. Dates are intentionally omitted until maintainers can support them. Every phase remains testnet-only and unaudited unless explicitly stated otherwise.

## Phase 0 — open-source foundation

- [x] MIT license
- [x] contribution, conduct, governance, and security policies
- [x] deterministic contract and frontend CI
- [x] dependency update automation
- [x] JavaScript/TypeScript CodeQL scanning
- [x] beta identity, changelog, templates, and release gates
- [x] enable GitHub private vulnerability reporting, secret scanning, and push protection
- [ ] enable branch protection after required checks stabilize
- [ ] obtain written contributor and institutional IP confirmation

## Phase 1 — standalone security hardening

- [x] cap copied target revert data before hashing
- [ ] add malicious/rebasing/fee-on-transfer token research fixtures
- [ ] expand callback and nested-call adversarial tests
- [ ] add explicit native-value accounting policy
- [ ] add fork tests against selected Base Sepolia protocol interfaces
- [ ] document compiler, bytecode, deployment, and verification provenance
- [ ] commission independent review before any real-asset discussion

## Phase 2 — multi-asset policy v2

- [x] publish the implemented Intent Manifest v2 Phase 1 schema
- [x] support bounded input deltas for multiple assets
- [x] support minimum recipient output deltas for multiple assets
- [x] support multiple token/spender final-allowance caps
- [x] define canonical array hashing and maximum bounds
- [x] add transfer, swap, approval, and ordered-batch modules
- [x] preserve v1 deployments with an explicit separate v2 contract
- [ ] complete adversarial-token characterization
- [ ] deploy and publish a versioned v2 testnet manifest
- [ ] complete the SDK and v2 dashboard migration

The v2 schema will be a new typed-data version and contract deployment. It will not silently reinterpret v1 signatures.

## Phase 3 — frontend reliability

- [ ] replace raw wallet errors with decoded, actionable messages
- [ ] validate configured chain and bytecode before enabling writes
- [ ] add transaction simulation and policy-diff confirmation
- [ ] add durable package import/export without private signing material
- [ ] add indexed evidence pagination and explorer links
- [ ] add accessibility, responsive, and end-to-end browser tests

## Completed implementation slice — controlled DeFi research

- [x] add an ERC-4626-shaped mock vault
- [x] enforce maximum deposit and minimum shares
- [x] enforce maximum shares burned and minimum withdrawal assets
- [x] enforce exact beneficiaries and residual allowance caps
- [x] add controlled rebalance across an ordered approved-vault set
- [x] enforce deterministic mock portfolio value and movement limits
- [x] add malicious-vault, fuzz, stateful invariant, and gas coverage
- [ ] evaluate selected public-testnet protocol interfaces in a later integration phase

## Completed implementation slice — bounded payments

- [x] unique treasury purpose/reference hashes
- [x] optional treasury epoch budgets
- [x] payroll execution windows and unique payment IDs
- [x] one payroll execution per token/employee/period
- [x] recurring subscription periods and payment-count caps
- [x] owner subscription cancellation
- [x] payment fuzz, stateful no-double-charge invariant, and gas coverage
- [ ] full DAO governance, employment, invoicing, and merchant integrations remain out of scope

## Completed implementation slice — NFT and bounded administration

- [x] bind mock ERC-721 and ERC-1155 purchases to an exact marketplace and collection
- [x] enforce token commitment, maximum payment, exact recipient, minimum quantity, and zero residual allowance
- [x] verify NFT delivery after execution and roll back payment when delivery is missing or wrong
- [x] allowlist bounded mock parameter, address, pause, role, and treasury-limit changes
- [x] reject hidden calls, ownership transfer, proxy upgrade selectors, and premature timelocked execution
- [ ] production marketplace adapters, governance integrations, and multi-owner approval remain out of scope

## Phase 4 — deployment and releases

- [x] reproducible local and Base Sepolia-ready full-stack deployment script
- [x] public versioned local deployment manifest
- [x] deployment smoke tests
- [x] documented verification and pause/replacement procedure
- [ ] perform and publish an actual Base Sepolia v2 deployment
- [ ] publish explorer verification links and signed release checksums
- [ ] `v0.2.0-beta` public testnet release

## Completed implementation slice — academic evaluation

- [x] minimal signature-only, spend-limit, and path-plus-spend research baselines
- [x] 30-run benign and wrong-recipient comparison
- [x] reproducible JSON and CSV results
- [x] measured frontend research section
- [ ] extend equal-trial A/B/C/D measurements to every attack scenario and public-testnet receipt latency

## Phase 5 — SDK and integrations

- [x] initial TypeScript SDK for call hashing, typed data, package validation, and submission
- [x] v2 browser integration lab for all policy modules
- [x] advisory simulation and decoded evidence timeline
- [x] bigint-safe, hash-verified JSON package import/export
- [ ] publish a framework-independent npm package and examples
- [ ] publish versioned deployment metadata
- [ ] generate stable API reference after the SDK boundary freezes

## Later milestone — account standards

Evaluate ERC-4337 and ERC-7579 only after the standalone policy model, SDK, test suite, and release process are stable. Any integration must preserve the existing isolation and persistent-containment guarantees and receive a separate threat model.

## Production gate

The project must not be described as mainnet-ready or production-safe until all of the following are complete:

- independent audit with remediated findings;
- broader adversarial-token and protocol testing;
- operational key, recovery, monitoring, and incident procedures;
- reproducible verified deployments;
- explicit governance approval; and
- documentation that accurately states residual risk.
