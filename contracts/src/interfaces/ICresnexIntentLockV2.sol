// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IntentTypesV2} from "../IntentTypesV2.sol";

interface ICresnexIntentLockV2 {
    enum ViolationCode {
        None,
        MaxSpendExceeded,
        MinOutputNotMet,
        WrongRecipient,
        AllowanceExceeded,
        UnauthorizedCall,
        CallOrderMismatch,
        ProtectedAssetLoss,
        NftNotReceived,
        PaymentPeriodViolation,
        AdminParameterOutOfRange,
        PolicyModuleFailure,
        NativeSpendExceeded
    }

    struct AgentState {
        bool registered;
        bool quarantined;
        uint64 strikes;
    }

    struct ViolationRecord {
        bytes32 intentDigest;
        address agent;
        ViolationCode code;
        IntentTypesV2.PolicyModule module;
        bytes32 callsHash;
        bytes32 evidenceHash;
        uint64 strikeCount;
        bool quarantined;
        uint64 blockNumber;
        uint48 timestamp;
    }

    event IntentExecuted(bytes32 indexed intentDigest, address indexed agent, bytes32 indexed callsHash);
    event IntentViolation(
        bytes32 indexed intentDigest,
        address indexed agent,
        ViolationCode code,
        IntentTypesV2.PolicyModule module,
        bytes32 evidenceHash,
        uint256 strikeCount,
        bool quarantined
    );
    event ExecutionFailed(
        bytes32 indexed intentDigest, address indexed agent, bytes32 indexed callsHash, bytes32 failureHash
    );
}
