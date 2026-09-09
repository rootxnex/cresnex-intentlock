# ETHOnline 2026 deployment runbook

This runbook applies only after Chainlink CRE Deploy Access is enabled. It uses Base Sepolia, the official KeystoneForwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`, and the existing encrypted Foundry keystore. Never place signing material in source control.

## Preconditions

1. Confirm the branch and clean working tree.
2. Run `cre whoami` and require **Deploy Access: Enabled**. Do not resubmit an access request while one is pending.
3. Re-run Foundry, CRE, and web validation.
4. Confirm chain ID `84532`, owner, broadcaster, balance, official Forwarder, and production configuration.

## Ordered live sequence

1. Dry-run `DeployCREIntentLockV3` against Base Sepolia without `--broadcast`.
2. With explicit approval, broadcast it once using the encrypted keystore. This deploys `CREIntentRiskConsumer` and V3 and sets V3 as the one-time authorized gate.
3. Verify bytecode, constructors, owner, Forwarder, consumer/V3 wiring, receipts, and deployment blocks.
4. Record the public deployment evidence in a copy of `shared/deployments/base-sepolia-ethonline-2026.template.json`.
5. Put the verified consumer address in CRE production `receiverAddress`; never use a simulated address.
6. Build the exact final workflow and record its build/config hashes.
7. Determine the final workflow ID and workflow owner from official CRE deployment output.
8. Configure the consumer's expected workflow ID and owner exactly once. Verify the transaction before continuing.
9. Deploy the exact reviewed CRE workflow and inspect its identity/configuration. Do not claim Confidential Workflows unless separately enabled and proven.
10. Trigger one safe, owner-signed `ALLOW` evaluation bound to the intended V3 execution package.
11. Verify KeystoneForwarder delivery, the consumer's stored verdict, metadata identity, evidence hash, validity, and replay state.
12. Submit the matching V3 intent and verify that both verdict and intent nonce are consumed and all inherited policy checks pass.
13. Capture workflow identifiers, Graph response metadata, reports, transaction hashes, blocks, receipts, and final state.
14. Only after the `ALLOW` path works, optionally approve one controlled V2 violation to demonstrate a fresh `ESCALATE` result. Do not create multiple violations merely for presentation.

## Stop conditions

Stop on any identity mismatch, stale/malformed Graph evidence, failed receipt, unexpected address, workflow-hash change, nonofficial Forwarder, or partial broadcast. Do not rerun blindly or use `--resume` until deployed state is reconciled.
