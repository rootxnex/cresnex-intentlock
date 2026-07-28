# Phase 4 validation and measurements

> These are local research measurements, not audit results or public-network guarantees.

## Architecture boundary

The v2 account authenticates the signed package, consumes the nonce, owns the isolated self-call, executes targets, measures generic balances and allowances, persists evidence, and manages strikes and quarantine. The immutable stateless validator decodes module data and checks module-specific shapes, calls, and specialized NFT/yield outcomes. Payment replay and budget state remains in the account.

No validator address is accepted in an execution package. The account deploys its validator in its constructor and stores the address as an immutable. Tests call the validator directly and confirm that validation neither transfers funds nor changes account owner, nonce, or discipline state. Module-data length and fixed module dispatch prevent module impersonation.

## Security cases

`IntentLockV2Phase4.t.sol` covers valid ERC-721/ERC-1155 and native purchases; wrong marketplace, collection, token ID, recipient, quantity, and price; payment without delivery; excessive debit; hidden/appended calls; residual allowance; replay and expiry; ERC-721/ERC-1155 receiver reentrancy; bounded large return/revert data; administration bounds, target, selector, arguments, role recipient, time window, replay, ownership transfer, and upgrade rejection.

Existing v2 unit, fuzz, and invariant suites continue to cover signed `callsHash`/`policyHash`, nonce isolation, ordinary versus authenticated failure classification, evidence persistence, strikes, quarantine, and the Phase 1–3 modules.

## Bytecode

Measured with Solidity 0.8.26, optimizer runs 200, and IR compilation:

| Contract | Before runtime | After runtime | EIP-170 headroom after |
| --- | ---: | ---: | ---: |
| `CresnexIntentLockAccountV2` | 24,403 bytes | 15,420 bytes | 9,156 bytes |
| `Phase4PolicyValidator` | 5,199 bytes | 14,378 bytes | 10,198 bytes |

The schema and signed package format did not change. A clean committed-baseline checkout and the Phase 4 tree produced:

| Local gas benchmark | Before | After | Difference |
| --- | ---: | ---: | ---: |
| Account deployment (includes validator creation) | 6,575,287 | 6,617,803 | +42,516 (+0.65%) |
| Valid v2 transfer | 177,962 | 185,597 | +7,635 (+4.29%) |
| Valid v2 swap | 252,136 | 261,742 | +9,606 (+3.81%) |
| v2 batch violation/evidence | 303,459 | 311,412 | +7,953 (+2.62%) |

The full suite increased from 281 to 296 passing tests: twelve Phase 4 unit/fuzz cases and three stateful invariants. Gas figures include the Forge harness and are useful only for relative local comparison. Regenerate them with the exact compiler and machine used for a release:

```sh
cd contracts
forge fmt --check
forge build --sizes
forge test
forge test --gas-report
forge lint
```

Frontend compatibility checks are:

```sh
cd web
npm run lint
npm run typecheck
npm run build
```
