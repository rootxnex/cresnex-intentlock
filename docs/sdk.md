# TypeScript SDK and v2 packages

> Cresnex IntentLock is an unaudited research prototype intended only for local development and public testnets. It is not production-ready and must not be used with real assets.

The initial TypeScript SDK is implemented in `web/lib/intentV2.ts`. It intentionally lives beside the research dashboard until its API and package schema stabilize.

It provides:

- typed v2 manifests, calls, policies, asset constraints, and allowance constraints;
- append-only module identifiers and human-readable names;
- Solidity-compatible length-bound `hashCallsV2` and `hashPolicyV2`;
- the EIP-712 v2 manifest type;
- bigint-safe JSON export; and
- strict v2 JSON import with address, hex, operation, array-bound, schema-version, calls-hash, and policy-hash validation.

## Package format

```text
{
  schemaVersion: 2,
  moduleName,
  manifest,
  calls,
  policy,
  ownerSignature
}
```

Amounts are exported as base-10 strings because JSON has no bigint type. Import never silently migrates v1 or an unknown schema. Signatures and packages are authorization data, not secrets, but they should still be handled carefully: anyone can submit a valid package as its bound agent, and public contents reveal intended activity.

## Simulation

The dashboard calls `eth_call` through viem using the signed agent as the simulated sender and the exact package arguments. Simulation catches common authentication, structural, target, and policy errors. It is advisory only: balances, allowances, time, nonce state, protocol state, and ordering can change between simulation and mining.

## Current API boundary

This is a research SDK, not a published npm package. Its exported names may change before a versioned SDK release. It does not manage keys, send secrets to a server, infer a schema from an address, or support ERC-4337/ERC-7579.
