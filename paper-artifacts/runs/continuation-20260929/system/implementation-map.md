# V2 implementation map

Source observations only. Commented legacy function bodies are excluded.

- P1 Signature authorization integrity: `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`), `contracts/src/CresnexIntentLockAccountV2.sol:212` (`hashIntent`)
- P2 Agent binding: `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`)
- P3 Account binding: `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`), `contracts/src/CresnexIntentLockAccountV2.sol:212` (`hashIntent`)
- P4 Chain/domain separation: `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`), `contracts/src/CresnexIntentLockAccountV2.sol:212` (`hashIntent`)
- P5 Nonce replay resistance: `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`), `contracts/src/CresnexIntentLockAccountV2.sol:234` (`executeIntent`), `contracts/src/CresnexIntentLockAccountV2.sol:143` (`cancelNonce`)
- P6 Deadline/freshness enforcement: `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`)
- P7 Exact call/package integrity: `contracts/src/CresnexIntentLockAccountV2.sol:177` (`hashCalls`), `contracts/src/CresnexIntentLockAccountV2.sol:185` (`hashPolicy`), `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`)
- P8 Target/selector integrity: `contracts/src/CresnexIntentLockAccountV2.sol:169` (`hashExecutionCall`), `contracts/src/policies/Phase4PolicyValidator.sol:225` (`validateCalls`)
- P9 Spending-bound enforcement: `contracts/src/CresnexIntentLockAccountV2.sol:791` (`_validateOutcomes`), `contracts/src/policies/Phase4PolicyValidator.sol:303` (`_validateTransfer`)
- P10 Recipient-bound enforcement: `contracts/src/policies/Phase4PolicyValidator.sol:303` (`_validateTransfer`), `contracts/src/CresnexIntentLockAccountV2.sol:791` (`_validateOutcomes`)
- P11 Allowance-bound enforcement: `contracts/src/policies/Phase4PolicyValidator.sol:337` (`_validateApproval`), `contracts/src/CresnexIntentLockAccountV2.sol:791` (`_validateOutcomes`)
- P12 Minimum-output enforcement: `contracts/src/CresnexIntentLockAccountV2.sol:791` (`_validateOutcomes`)
- P13 Ordered-batch integrity: `contracts/src/CresnexIntentLockAccountV2.sol:177` (`hashCalls`), `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`)
- P14 Post-state acceptance enforcement: `contracts/src/CresnexIntentLockAccountV2.sol:298` (`executeIsolated`), `contracts/src/CresnexIntentLockAccountV2.sol:791` (`_validateOutcomes`)
- P15 Atomic rollback of rejected inner execution: `contracts/src/CresnexIntentLockAccountV2.sol:234` (`executeIntent`), `contracts/src/CresnexIntentLockAccountV2.sol:298` (`executeIsolated`)
- P16 Persistence of authenticated violation evidence: `contracts/src/CresnexIntentLockAccountV2.sol:234` (`executeIntent`), `contracts/src/CresnexIntentLockAccountV2.sol:990` (`_decodePolicyViolation`)
- P17 Strike accounting: `contracts/src/CresnexIntentLockAccountV2.sol:234` (`executeIntent`)
- P18 Quarantine enforcement: `contracts/src/CresnexIntentLockAccountV2.sol:234` (`executeIntent`), `contracts/src/CresnexIntentLockAccountV2.sol:320` (`_authenticate`), `contracts/src/CresnexIntentLockAccountV2.sol:127` (`setQuarantineThreshold`)
- P19 Non-owner cannot clear containment: `contracts/src/CresnexIntentLockAccountV2.sol:138` (`unquarantineAgent`), `contracts/src/CresnexIntentLockAccountV2.sol:133` (`resetAgentStrikes`), `contracts/src/CresnexIntentLockAccountV2.sol:127` (`setQuarantineThreshold`)
- P20 Ordinary failure classification: `contracts/src/CresnexIntentLockAccountV2.sol:967` (`_boundedCall`), `contracts/src/CresnexIntentLockAccountV2.sol:298` (`executeIsolated`), `contracts/src/CresnexIntentLockAccountV2.sol:234` (`executeIntent`)

Tests mapped in security-properties.json prove only their explicit assertions.
Missing dedicated V2 tests are not filled with similarly named V1 tests.
