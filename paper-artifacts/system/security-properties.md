# Source-grounded V2 observations

Reviewed source: `contracts/src/CresnexIntentLockAccountV2.sol` at
`361743f6d7d595caa4cf20ecc1c4d916856a353f`. These are implementation
observations, not measured security effectiveness or formal proofs.

| Property | Responsible function | Observation |
|---|---|---|
| Owner signature | `_authenticate`, `hashIntent` | ECDSA recovered signer must equal owner; ERC-1271 validation is not used here. |
| Agent | `_authenticate` | Caller must equal manifest agent and be registered and not quarantined. |
| Account and chain | `_authenticate` | Explicit account, owner, chain ID and version equality checks precede signature verification. |
| Domain | constructor | EIP-712 name `Cresnex IntentLock`, version `2`; inherited EIP-712 domain construction. |
| Freshness | `_authenticate` | Validity requires validUntil > validAfter; endpoints are inclusive. |
| Replay | `_authenticate`, `executeIntent` | Global account nonce map; nonce consumed after authentication even if isolated execution fails. Outer transaction reversion rolls back all changes. |
| Package | `hashExecutionCall`, `hashCalls`, `hashPolicy`, `hashIntent` | Ordered call hashes include target, value, hash of data, operation. Policy hash includes ordered asset and allowance hashes, native constraints, module and moduleData hash. |
| Calls | `_authenticate` | 1–16 calls; multi-call requires allowBatch; zero and account-self targets rejected; Call is the only operation. |
| Constraint bounds | `_authenticate` | Maximum eight asset and eight allowance constraints. |
| Policy | `executeIsolated`, `Phase4PolicyValidator.validateCalls` | Module validation precedes target execution. Stateful payment validation also runs before execution. |
| Outcomes | `_validateOutcomes` | Measures account losses, recipient gains, final balance and final allowance against supplied constraints. Only listed assets/allowances are measured. |
| Isolation | `executeIntent`, `executeIsolated`, `onlySelf` | External self-call isolates nested effects; inner revert rolls back nested token/target state. |
| Evidence and strikes | `executeIntent` | Caught PolicyViolation stores violation record and increments agent strikes; threshold comparison can quarantine. |
| Target failure | `_boundedCall`, `executeIntent` | Non-policy failure emits ExecutionFailed and returns false without strike increment. A successful outer receipt alone does not mean successful intent execution. |
| Recovery | `unquarantineAgent`, `resetAgentStrikes`, `setQuarantineThreshold` | Owner-only operations. Unquarantine and strike reset are distinct operations. |

Existing regression coverage is recorded in `../logs/tests.log`. Passing that
suite is not a 1,000-scenario benchmark and must not be converted into IVBR.
Cross-language SDK tests passing alone do not establish canonical Solidity/TS
equivalence without shared vectors checked by both implementations.
