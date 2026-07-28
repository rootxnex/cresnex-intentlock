# Threat model

## Version 2 Phase 1 delta

V2 expands measured state to at most eight ERC-20 asset constraints, eight allowance constraints, and one native-balance constraint. Calls remain exact, ordered, and limited to sixteen ordinary `CALL` operations. `delegatecall`, upgradeability, and recursive self-targeting remain unavailable.

Authenticated policy violations roll back, persist evidence, and strike. Ordinary external target reverts roll back and persist a non-punitive failure event without striking. Authentication and structural failures revert the outer transaction without consuming a nonce or changing agent discipline state.

The initial Phase 1 protections apply to transfer, swap, approval, and ordered-batch modules. See [known-limitations.md](known-limitations.md).

Phase 2 extends this boundary to the repository's ERC-4626-shaped mock vaults and deterministic price fixture. It tests excessive pulls, too few shares/assets, wrong recipients, excessive share burns, residual allowances, unapproved rebalance targets, movement limits, and portfolio-value loss. It does not establish safety for arbitrary production vaults or real price oracles.

The Phase 0–2 review additionally enforces structural module-to-constraint binding before nonce consumption, rejects unsupported evidence modes, rejects duplicate yield vaults, and selector-checks all approved deposit/rebalance targets. An approved address alone is not treated as approval for arbitrary calldata.

Phase 3 prevents duplicate successful treasury references, repeated payroll IDs or employee periods, repeated subscription billing periods, charges beyond subscription count caps, and charges after owner cancellation. It does not authenticate off-chain work, invoices, employment status, service delivery, or legal authority; the owner remains responsible for signing correct payment policies.

Phase 4 assumes the signed mock marketplace and collection addresses are intentional. It measures ERC-20 or native payment and final NFT delivery but does not validate production order books, royalties, provenance, metadata, or collection authenticity. Administration is selector-allowlisted and argument-bounded; ownership transfer, upgrades, and arbitrary `delegatecall` remain forbidden. The immutable validator is trusted stateless code deployed with each account, not a replaceable plugin. It cannot consume nonces, mutate account storage, execute the signed calls, or select a different module than the signed module ID. Authentication and authenticated-failure classification remain solely in the account.

## Assets and trust

The owner EOA and correctly configured signed policy are trusted. Registered agents and external targets may be compromised. Standard ERC-20 balance and allowance responses are assumed honest. This is a research prototype, not an audit or production custody system.

The Phase 6 baseline accounts intentionally omit protections and must not receive real assets. They exist only to measure the security and gas differences of signature-only, spend-only, and path-plus-spend designs. Their successful harmful transfers are expected experimental outcomes, not supported functionality.

## Prototype protections

- Agent overspending measured at the account
- Insufficient output measured at the exact signed recipient
- Wrong-recipient output
- Excessive residual token approvals
- Signature, nonce, cross-chain and expiry replay
- Exact-call and ordered-batch hash manipulation
- Hidden malicious batch calls when they violate the declared financial outcome
- Reentrancy into protected execution
- Repeated registered-agent compromise through strikes and quarantine

## Outside or incomplete

- Owner-key compromise, social engineering, and incorrectly configured policies
- Malicious, callback-heavy, fee-on-transfer, rebasing or nonconforming tokens
- Assets and side effects not named by the manifest
- Oracle manipulation, adverse prices outside the output floor, MEV and front-running
- Gas griefing and target denial of service
- Implementation, compiler or EVM vulnerabilities
- Full ERC-4337/7579 behavior, bundlers, production recovery governance

The owner recovery function can transfer tokens and owner controls can rehabilitate agents. That is intentional emergency authority and a central trust assumption.
