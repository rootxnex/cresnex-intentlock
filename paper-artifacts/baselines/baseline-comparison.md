# Existing research baselines

Source directory: `contracts/src/baselines`. No baseline was modified.

| Baseline | Source functions | Actual scope |
|---|---|---|
| SignatureOnlyAccount | authorizationHash, execute | Signature binds chain, account, submitting agent, nonce and expiry. Generic call target/value/data are not signed. |
| SpendLimitGuardAccount | authorizationHash, transfer | Also signs token and maximum; fixed ERC20 transfer API limits amount. Recipient is not signed; no measured post-state. |
| PathAndSpendGuardAccount | authorizationHash, execute | Signs target, selector and maximum; requires 68-byte arguments and bounds decoded amount. Recipient is not signed; no measured post-state. |
| CresnexIntentLockAccountV2 | hashIntent, executeIntent | Signed complete call/policy package, measured outcomes, isolated execution and durable policy-violation containment. |

These interfaces have different workload applicability. No paired benchmark
was executed. The existing AcademicBaselines regression suite was run as part
of forge test. SemanticGuardAccount is MISSING; a fair semantic baseline needs
an explicit supported-method specification and independent validation before
any comparison. No unsupported baseline results are inferred.
