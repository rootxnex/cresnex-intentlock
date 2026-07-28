# Reproducible deployment

The deployment script supports local Anvil and Base Sepolia. It deploys v1, v2, mock USDC/WETH, router, two vaults, deterministic oracle, ERC-721, ERC-1155, NFT marketplace, and administration target.

## Safety

- Testnet only; never deploy this research stack with real assets.
- Use a Foundry encrypted keystore or hardware-backed signer.
- Never put keys, seed phrases, passwords, or private RPC URLs in repository files or `NEXT_PUBLIC_*`.
- Review the broadcaster, owner, chain ID, bytecode, and output path before broadcasting.

## Local Anvil

Terminal one:

```bash
anvil
```

Terminal two:

```bash
cd contracts
export OWNER_ADDRESS=<anvil-owner-address>
export DEPLOYMENT_OUTPUT=../shared/deployments/local-31337.json
forge script script/DeployResearchStack.s.sol:DeployResearchStack \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast --unlocked --sender "$OWNER_ADDRESS"
```

Run the smoke test:

```bash
RPC_URL=http://127.0.0.1:8545 scripts/smoke-deployment.sh \
  shared/deployments/local-31337.json
```

## Base Sepolia

```bash
cd contracts
cp .env.example .env
# Fill only OWNER_ADDRESS and select a non-secret public RPC URL.
source .env
forge script script/DeployResearchStack.s.sol:DeployResearchStack \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --broadcast --account <foundry-keystore-name> --sender "$OWNER_ADDRESS"
```

Set `DEPLOYMENT_OUTPUT=../shared/deployments/base-sepolia.json`. Commit that file only after an actual successful deployment and smoke check. Do not invent or pre-populate addresses.

For explorer verification, rerun the exact compiled sources with `--resume --verify` and the appropriate Base Sepolia verifier configuration. Record the compiler, optimizer, commit, transaction hashes, deployment block, and verification URLs. A failed verification must not be represented as verified.

## Replacement procedure

The contracts are not upgradeable. If replacement is necessary:

1. pause and revoke agents on the old test account;
2. cancel exposed unused nonces and subscriptions;
3. deploy a new immutable account;
4. verify code and smoke-test public state;
5. publish new versioned metadata;
6. update the frontend only after confirming chain ID and bytecode; and
7. retain the old manifest and incident notes.
