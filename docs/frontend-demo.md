# Frontend v2 demonstration

The dashboard preserves the deployed v1 controls and adds a separate v2 research lab. Never configure a v1 deployment address as the v2 account.

## Configuration

Set these browser-safe public deployment values:

```text
NEXT_PUBLIC_ACCOUNT_V2_ADDRESS=0x...
NEXT_PUBLIC_DEPLOYMENT_V2_BLOCK=...
```

The existing chain RPC and wallet configuration still applies. Never put private keys, seed phrases, wallet passwords, or privileged RPC credentials in `NEXT_PUBLIC_*`.

## Workflow

1. Connect the current v2 account owner.
2. Select one of the twelve policy modules.
3. Enter exact target, asset, recipient, bounds, complete calldata, and module-specific fields.
4. Review the locally computed calls and policy hashes.
5. Sign the version-2 EIP-712 manifest.
6. Export the package or switch to the bound agent wallet.
7. Run simulation.
8. Submit only if the simulation result and policy diff are expected.
9. Inspect the v2 evidence timeline for committed intents, authenticated policy violations, or non-punitive target failures.

Imported JSON is accepted only when its schema and canonical hashes validate. The builder permits expert-level raw calldata because production protocol adapters are not part of this milestone; malformed combinations are expected to fail simulation.
