# Intent Manifest v2

> Cresnex IntentLock is an unaudited research prototype intended only for local development and public testnets. It is not production-ready and must not be used with real assets.

Version 2 is a new EIP-712 schema and a separate contract deployment. A v1 signature is never valid for v2.

The Phase 4 policy-validator extraction does not change this schema, the ABI package shape, `callsHash`, `policyHash`, or any module ID. The validator address is account-created and immutable; it is not an unsigned execution input.

## Domain

- Name: `Cresnex IntentLock`
- Version: `2`
- Chain ID: the execution chain
- Verifying contract: the deployed v2 account

## Manifest

```text
IntentManifest(
  uint16 version,
  address account,
  address owner,
  address agent,
  uint256 chainId,
  bytes32 callsHash,
  bytes32 policyHash,
  uint256 nonce,
  uint48 validAfter,
  uint48 validUntil,
  bool allowBatch,
  uint8 evidenceMode
)
```

`version` must equal `2`. The signed owner is also included in the message so an ownership change invalidates packages signed for the previous owner.

`evidenceMode` must equal `1`, the compact hash-and-event mode implemented by this beta. Unknown or reserved modes are structural failures and do not consume a nonce.

## Calls commitment

Each call is hashed as:

```text
ExecutionCall(address target,uint256 value,bytes data,uint8 operation)
```

The complete calldata is represented by `keccak256(data)`. The final hash is `keccak256(abi.encode(callCount, orderedCallHashes))`. Array length and order are therefore explicit. Version 2 supports only ordinary `CALL` operations; it has no `delegatecall` mode.

## Policy commitment

`policyHash` commits to:

- policy module;
- an explicitly length-bound ordered asset-constraint hash;
- an explicitly length-bound ordered allowance-constraint hash;
- native maximum spend and minimum final balance;
- complete module data through `keccak256(moduleData)`.

The implementation uses `abi.encode`, not ambiguous packed encoding. Maximums are 16 calls, 8 asset constraints, and 8 allowance constraints.

Current module identifiers are append-only:

| ID | Module |
|---:|---|
| 0 | Transfer |
| 1 | Swap |
| 2 | Approval |
| 3 | Ordered batch |
| 4 | DeFi deposit |
| 5 | DeFi withdrawal |
| 6 | Controlled yield rebalance |
| 7 | DAO treasury payment |
| 8 | Payroll |
| 9 | Subscription |
| 10 | NFT purchase |
| 11 | Administration |

## Package compatibility

Signed packages should include a top-level `schemaVersion: 2`. Clients must reject unknown versions rather than guessing or silently migrating signed data.

The Phase 5 browser SDK also recomputes `callsHash` and `policyHash` when importing JSON. A package whose content does not match either signed commitment is rejected locally before simulation or submission.
