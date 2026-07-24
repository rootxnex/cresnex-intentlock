// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IntentTypes} from "../IntentTypes.sol";

interface ICresnexIntentLock {
    struct AgentState {
        bool registered;
        bool quarantined;
        uint256 strikes;
    }

    struct ViolationRecord {
        address agent;
        bytes32 intentHash;
        bytes32 callsHash;
        uint48 timestamp;
        bytes32 revertDataHash;
        bytes4 reasonSelector;
        uint256 strikeCount;
        bool quarantined;
    }

    event IntentExecuted(bytes32 indexed intentHash, address indexed agent);
    event IntentViolation(
        bytes32 indexed intentHash,
        address indexed agent,
        bytes32 evidenceHash,
        bytes4 reasonSelector,
        uint256 strikeCount
    );
    event AgentQuarantined(address indexed agent, uint256 strikeCount);
    event AgentRecovered(address indexed agent);

    function executeIntent(
        IntentTypes.IntentManifest calldata manifest,
        IntentTypes.ExecutionCall[] calldata calls,
        bytes calldata ownerSignature
    ) external returns (bool success, bytes32 evidenceHash);
}

