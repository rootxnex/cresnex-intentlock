# Threat model

## Assets and trust

The owner EOA and correctly configured signed policy are trusted. Registered agents and external targets may be compromised. Standard ERC-20 balance and allowance responses are assumed honest. This is a research prototype, not an audit or production custody system.

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

