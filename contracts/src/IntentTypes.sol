// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library IntentTypes {
    struct IntentManifest {
        address account;
        address agent;
        uint256 chainId;
        bytes32 callsHash;
        address inputToken;
        uint256 maxInputAmount;
        address outputToken;
        uint256 minOutputAmount;
        address recipient;
        address approvalToken;
        address approvalSpender;
        uint256 maxFinalAllowance;
        uint256 nonce;
        uint48 validAfter;
        uint48 validUntil;
        bool allowBatch;
    }

    struct ExecutionCall {
        address target;
        uint256 value;
        bytes data;
    }
}

