# Cresnex IntentLock open-source beta roadmap

The roadmap is ordered by security dependency, not marketing priority. Dates are intentionally omitted until maintainers can support them. Every phase remains testnet-only and unaudited unless explicitly stated otherwise.

## Phase 0 — open-source foundation

- [x] MIT license
- [x] contribution, conduct, governance, and security policies
- [x] deterministic contract and frontend CI
- [x] dependency update automation
- [x] JavaScript/TypeScript CodeQL scanning
- [x] beta identity, changelog, templates, and release gates
- [ ] enable GitHub private vulnerability reporting and branch protection
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

- [ ] publish an Intent Manifest v2 design proposal
- [ ] support bounded input deltas for multiple assets
- [ ] support minimum recipient output deltas for multiple assets
- [ ] support multiple token/spender final-allowance caps
- [ ] define canonical array hashing and maximum bounds
- [ ] benchmark gas and denial-of-service limits
- [ ] preserve v1 deployments and provide explicit migration tooling

The v2 schema will be a new typed-data version and contract deployment. It will not silently reinterpret v1 signatures.

## Phase 3 — frontend reliability

- [ ] replace raw wallet errors with decoded, actionable messages
- [ ] validate configured chain and bytecode before enabling writes
- [ ] add transaction simulation and policy-diff confirmation
- [ ] add durable package import/export without private signing material
- [ ] add indexed evidence pagination and explorer links
- [ ] add accessibility, responsive, and end-to-end browser tests

## Phase 4 — deployment and releases

- [ ] reproducible Base Sepolia deployment manifest
- [ ] explorer verification in CI-assisted release procedure
- [ ] signed release checksums and ABI artifacts
- [ ] deployment smoke tests
- [ ] documented pause/replacement incident procedure
- [ ] `v0.2.0-beta` public testnet release

## Phase 5 — SDK and integrations

- [ ] TypeScript SDK for call hashing, typed data, package validation, and submission
- [ ] framework-independent examples
- [ ] versioned ABI and deployment packages
- [ ] generated API reference
- [ ] integration test application

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
