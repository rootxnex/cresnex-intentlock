# Known limitations

Cresnex IntentLock is an unaudited research prototype intended only for local development and public testnets. It is not production-ready and must not be used with real assets.

Phase 1 does not guarantee:

- protection for calls that bypass the IntentLock account;
- reversal after an external transaction has finalized;
- correct behavior for every non-standard, rebasing, fee-on-transfer, callback, or malicious token;
- correct oracle prices or market-risk handling;
- complete MEV protection;
- cross-chain safety;
- ERC-4337 or ERC-7579 compatibility;
- production monitoring or incident response;
- legal or regulatory compliance;
- formal verification; or
- mainnet readiness.

Transfer, swap, approval, ordered batch, mock ERC-4626 deposit/withdrawal, controlled mock yield rebalance, bounded treasury payments, payroll, subscriptions, mock NFT purchases, and bounded mock administration are implemented.

The payment policies do not provide full DAO governance, employment administration, invoicing, fiat conversion, tax handling, legal compliance, payment dispute resolution, or off-chain service cancellation. Epoch and billing calculations use EVM timestamps.

NFT support is limited to the repository's fixed mock ERC-721/ERC-1155 marketplace interfaces. It does not support arbitrary production order protocols, safe ERC-1155 batch receipt, royalties, criteria orders, or every callback pattern. Administration supports only five explicit mock selectors; it is not a general governance executor and deliberately rejects ownership transfer and upgrades.

The DeFi modules are tested against repository mocks rather than live protocols. The deterministic pricing fixture is ownerless test infrastructure and must never be treated as a production oracle. The beta does not model share-price manipulation, donations, inflation attacks, asynchronous vaults, withdrawal queues, protocol fees, or oracle freshness.

The owner key and the owner's policy choices are trusted. Timestamp boundaries inherit normal validator timestamp tolerance. Exact signed calls reduce ambiguity but do not make an external target trustworthy. Only assets and allowances named in the signed policy are measured.

Phase 1 fully targets conventional ERC-20 behavior. Safe no-return token support and adversarial-token characterization remain dedicated later test work. Fee-on-transfer and rebasing assets must be treated as unsupported unless a future module explicitly defines deterministic semantics.

Phase 6 gas values are local Forge harness measurements, not public-testnet transaction receipts or latency results. The equal-trial baseline comparison currently covers benign and wrong-recipient ERC-20 transfers; it does not establish universal effectiveness across every policy, token, protocol, or attack.

The committed local deployment manifest refers to an ephemeral Anvil run. It is reproducible demonstration metadata, not a persistent service. No Base Sepolia deployment or explorer verification is claimed until a real manifest and verification links are published.
