# Existing research baselines

Source directory: `contracts/src/baselines`. No baseline was modified.

| Baseline | Source functions | Actual scope |
|---|---|---|
| SignatureOnlyAccount | authorizationHash, execute | Signature binds chain, account, submitting agent, nonce and expiry. Generic call target/value/data are not signed. |
| SpendLimitGuardAccount | authorizationHash, transfer | Also signs token and maximum; fixed ERC20 transfer API limits amount. Recipient is not signed; no measured post-state. |
| PathAndSpendGuardAccount | authorizationHash, execute | Signs target, selector and maximum; requires 68-byte arguments and bounds decoded amount. Recipient is not signed; no measured post-state. |
| CresnexIntentLockAccountV2 | hashIntent, executeIntent | Signed complete call/policy package, measured outcomes, isolated execution and durable policy-violation containment. |

These interfaces have different workload applicability. A--D are frozen for
the pilot and final scenario corpus at parent checkpoint
`6c2ca5e31911625b36efdbfe15c029ecf446e7ba`. Applicability is declared per
scenario; an unsupported interface is `NOT_APPLICABLE`, never an observed pass
or failure.

`SemanticGuardAccount` is **MISSING**. The repository has no implementation and
no neutral shared semantic-method specification across transfer, approval,
swap, batch, freshness, and containment workloads. Adding one after inspecting
the existing comparison requires new method and applicability choices that
would materially change the study design. It is excluded rather than filled
with inferred or selectively weak behavior. A future study may add it only
under a separate preregistration.

The existing AcademicBaselines regression suite was run as part of Forge test.
Those test invocations are not pilot or benchmark execution rows. No
unsupported baseline results are inferred.
