// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library IntentTypesV2 {
    enum Operation {
        Call
    }

    enum PolicyModule {
        Transfer,
        Swap,
        Approval,
        Batch,
        DeFiDeposit,
        DeFiWithdrawal,
        YieldRebalance,
        TreasuryPayment,
        Payroll,
        Subscription,
        NftPurchase,
        Administration
    }

    struct IntentManifest {
        uint16 version;
        address account;
        address owner;
        address agent;
        uint256 chainId;
        bytes32 callsHash;
        bytes32 policyHash;
        uint256 nonce;
        uint48 validAfter;
        uint48 validUntil;
        bool allowBatch;
        uint8 evidenceMode;
    }

    struct ExecutionCall {
        address target;
        uint256 value;
        bytes data;
        Operation operation;
    }

    /// @dev Measures the account's maximum loss and a recipient's minimum gain.
    struct AssetConstraint {
        address token;
        uint256 maxSpend;
        address recipient;
        uint256 minReceive;
        uint256 minFinalBalance;
    }

    struct AllowanceConstraint {
        address token;
        address spender;
        uint256 maxFinalAllowance;
    }

    struct NativeConstraint {
        uint256 maxSpend;
        uint256 minFinalBalance;
    }

    struct Policy {
        PolicyModule module;
        AssetConstraint[] assets;
        AllowanceConstraint[] allowances;
        NativeConstraint nativeConstraint;
        bytes moduleData;
    }
}
