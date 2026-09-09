// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CresnexIntentLockAccountV2} from "./CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "./IntentTypesV2.sol";
import {CREIntentRiskConsumer} from "./cre/CREIntentRiskConsumer.sol";

/// @notice Unaudited ETHOnline research account requiring a CRE ALLOW verdict for autonomous execution.
/// @dev The inherited V2 manifest and EIP-712 domain remain version 2; this contract versions the execution boundary.
contract CresnexIntentLockAccountV3 is CresnexIntentLockAccountV2 {
    CREIntentRiskConsumer public immutable riskConsumer;

    error ZeroRiskConsumer();

    event RiskVerdictConsumed(
        bytes32 indexed verdictKey, address indexed agent, uint256 indexed nonce, bytes32 evidenceHash
    );

    constructor(address initialOwner, CREIntentRiskConsumer riskConsumer_) CresnexIntentLockAccountV2(initialOwner) {
        if (address(riskConsumer_) == address(0)) revert ZeroRiskConsumer();
        riskConsumer = riskConsumer_;
    }

    /// @dev This override is the only autonomous signed-intent execution entry point exposed by V3.
    function executeIntent(
        IntentTypesV2.IntentManifest calldata manifest,
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        bytes calldata ownerSignature
    ) public override returns (bool success, bytes32 evidenceHash) {
        _authenticate(manifest, calls, policy, ownerSignature);
        bytes32 actualCallsHash = hashCalls(calls);
        bytes32 actualPolicyHash = hashPolicy(policy);
        (bytes32 key, bytes32 riskEvidenceHash) = riskConsumer.consumeVerdict(
            address(this), block.chainid, manifest.agent, manifest.nonce, actualCallsHash, actualPolicyHash
        );
        emit RiskVerdictConsumed(key, manifest.agent, manifest.nonce, riskEvidenceHash);
        return super.executeIntent(manifest, calls, policy, ownerSignature);
    }
}
