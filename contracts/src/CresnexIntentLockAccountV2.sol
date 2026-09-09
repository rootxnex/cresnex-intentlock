// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IntentTypesV2} from "./IntentTypesV2.sol";
import {ICresnexIntentLockV2} from "./interfaces/ICresnexIntentLockV2.sol";
import {Phase4PolicyValidator} from "./policies/Phase4PolicyValidator.sol";

/// @notice Unaudited research account for local development and public testnets only.
contract CresnexIntentLockAccountV2 is ICresnexIntentLockV2, EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MANIFEST_VERSION = 2;
    uint256 public constant MAX_CALLS = 16;
    uint256 public constant MAX_ASSET_CONSTRAINTS = 8;
    uint256 public constant MAX_ALLOWANCE_CONSTRAINTS = 8;
    uint256 public constant MAX_REVERT_DATA_COPY = 256;

    bytes32 public constant EXECUTION_CALL_TYPEHASH =
        keccak256("ExecutionCall(address target,uint256 value,bytes data,uint8 operation)");
    bytes32 public constant ASSET_CONSTRAINT_TYPEHASH = keccak256(
        "AssetConstraint(address token,uint256 maxSpend,address recipient,uint256 minReceive,uint256 minFinalBalance)"
    );
    bytes32 public constant ALLOWANCE_CONSTRAINT_TYPEHASH =
        keccak256("AllowanceConstraint(address token,address spender,uint256 maxFinalAllowance)");
    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "Policy(uint8 module,bytes32 assetsHash,bytes32 allowancesHash,uint256 maxNativeSpend,uint256 minFinalNativeBalance,bytes32 moduleDataHash)"
    );
    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "IntentManifest(uint16 version,address account,address owner,address agent,uint256 chainId,bytes32 callsHash,bytes32 policyHash,uint256 nonce,uint48 validAfter,uint48 validUntil,bool allowBatch,uint8 evidenceMode)"
    );

    error OnlySelf();
    error UnauthorizedAgent();
    error AgentQuarantinedError();
    error WrongVersion();
    error WrongAccount();
    error WrongOwner();
    error WrongChain();
    error InvalidValidityWindow();
    error IntentNotYetValid();
    error IntentExpired();
    error NonceAlreadyUsed();
    error InvalidCallCount();
    error BatchNotAllowed();
    error InvalidCallTarget();
    error UnsupportedOperation();
    error CallsHashMismatch();
    error PolicyHashMismatch();
    error InvalidOwnerSignature();
    error InvalidPolicy();
    error InvalidThreshold();
    error PolicyViolation(ViolationCode code, bytes32 evidence);
    error TargetCallFailed(uint256 index, bytes32 revertDataHash);

    mapping(address => AgentState) public agents;
    mapping(uint256 => bool) public usedNonces;
    mapping(bytes32 => ViolationRecord) public violations;
    mapping(bytes32 => bool) public usedTreasuryReferences;
    mapping(bytes32 => mapping(uint256 epoch => uint256 spent)) public treasuryEpochSpend;
    mapping(bytes32 => bool) public usedPayrollPayments;
    mapping(bytes32 => bool) public usedPayrollPeriods;
    mapping(bytes32 => bool) public cancelledSubscriptions;
    mapping(bytes32 => uint32) public subscriptionPaymentCount;
    mapping(bytes32 => bool) public usedSubscriptionPeriods;
    uint256 public quarantineThreshold = 3;
    Phase4PolicyValidator public immutable phase4Validator;

    event AgentRegistered(address indexed agent);
    event AgentRemoved(address indexed agent);
    event AgentEmergencyRevoked(address indexed agent);
    event AgentQuarantined(address indexed agent, uint256 strikeCount);
    event AgentUnquarantined(address indexed agent);
    event AgentStrikesReset(address indexed agent);
    event QuarantineThresholdUpdated(uint256 threshold);
    event NonceCancelled(uint256 indexed nonce);
    event SubscriptionCancelled(bytes32 indexed subscriptionId);
    event TreasuryPaymentRecorded(bytes32 indexed referenceHash, bytes32 indexed budgetId, uint256 amount);
    event PayrollPaymentRecorded(bytes32 indexed paymentId, uint256 indexed period, uint256 amount);
    event SubscriptionPaymentRecorded(bytes32 indexed subscriptionId, uint256 indexed period, uint256 amount);
    event UnsupportedTokenRecovered(address indexed token, address indexed recipient, uint256 amount);

    constructor(address initialOwner) EIP712("Cresnex IntentLock", "2") Ownable(initialOwner) {
        phase4Validator = new Phase4PolicyValidator();
    }

    receive() external payable {}

    fallback() external {
        if (msg.sig != 0x150b7a02 && msg.sig != 0xf23a6e61) revert InvalidPolicy();
        assembly ("memory-safe") {
            mstore(0, shl(224, shr(224, calldataload(0))))
            return(0, 32)
        }
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    function registerAgent(address agent) external onlyOwner {
        if (agent == address(0)) revert InvalidPolicy();
        agents[agent].registered = true;
        emit AgentRegistered(agent);
    }

    function removeAgent(address agent) external onlyOwner {
        agents[agent].registered = false;
        emit AgentRemoved(agent);
    }

    function emergencyRevokeAgent(address agent) external onlyOwner {
        AgentState storage state = agents[agent];
        state.registered = false;
        state.quarantined = true;
        emit AgentEmergencyRevoked(agent);
    }

    function setQuarantineThreshold(uint256 threshold) external onlyOwner {
        if (threshold == 0 || threshold > type(uint64).max) revert InvalidThreshold();
        quarantineThreshold = threshold;
        emit QuarantineThresholdUpdated(threshold);
    }

    function resetAgentStrikes(address agent) external onlyOwner {
        agents[agent].strikes = 0;
        emit AgentStrikesReset(agent);
    }

    function unquarantineAgent(address agent) external onlyOwner {
        agents[agent].quarantined = false;
        emit AgentUnquarantined(agent);
    }

    function cancelNonce(uint256 nonce) external onlyOwner {
        if (usedNonces[nonce]) revert NonceAlreadyUsed();
        usedNonces[nonce] = true;
        emit NonceCancelled(nonce);
    }

    function cancelSubscription(bytes32 subscriptionId) external onlyOwner {
        if (subscriptionId == bytes32(0)) revert InvalidPolicy();
        cancelledSubscriptions[subscriptionId] = true;
        emit SubscriptionCancelled(subscriptionId);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function recoverUnsupportedToken(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || recipient == address(0)) revert InvalidPolicy();
        IERC20(token).safeTransfer(recipient, amount);
        emit UnsupportedTokenRecovered(token, recipient, amount);
    }

    function hashExecutionCall(IntentTypesV2.ExecutionCall calldata call_) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EXECUTION_CALL_TYPEHASH, call_.target, call_.value, keccak256(call_.data), uint8(call_.operation)
            )
        );
    }

    function hashCalls(IntentTypesV2.ExecutionCall[] calldata calls) public pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            hashes[i] = hashExecutionCall(calls[i]);
        }
        return keccak256(abi.encode(calls.length, hashes));
    }

    function hashPolicy(IntentTypesV2.Policy calldata policy) public pure returns (bytes32) {
        bytes32[] memory assetHashes = new bytes32[](policy.assets.length);
        for (uint256 i; i < policy.assets.length; ++i) {
            IntentTypesV2.AssetConstraint calldata a = policy.assets[i];
            assetHashes[i] = keccak256(
                abi.encode(ASSET_CONSTRAINT_TYPEHASH, a.token, a.maxSpend, a.recipient, a.minReceive, a.minFinalBalance)
            );
        }
        bytes32[] memory allowanceHashes = new bytes32[](policy.allowances.length);
        for (uint256 i; i < policy.allowances.length; ++i) {
            IntentTypesV2.AllowanceConstraint calldata a = policy.allowances[i];
            allowanceHashes[i] =
                keccak256(abi.encode(ALLOWANCE_CONSTRAINT_TYPEHASH, a.token, a.spender, a.maxFinalAllowance));
        }
        return keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                uint8(policy.module),
                keccak256(abi.encode(policy.assets.length, assetHashes)),
                keccak256(abi.encode(policy.allowances.length, allowanceHashes)),
                policy.nativeConstraint.maxSpend,
                policy.nativeConstraint.minFinalBalance,
                keccak256(policy.moduleData)
            )
        );
    }

    function hashIntent(IntentTypesV2.IntentManifest calldata m) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INTENT_TYPEHASH,
                    m.version,
                    m.account,
                    m.owner,
                    m.agent,
                    m.chainId,
                    m.callsHash,
                    m.policyHash,
                    m.nonce,
                    m.validAfter,
                    m.validUntil,
                    m.allowBatch,
                    m.evidenceMode
                )
            )
        );
    }

    function executeIntent(
        IntentTypesV2.IntentManifest calldata manifest,
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        bytes calldata ownerSignature
    ) public virtual nonReentrant whenNotPaused returns (bool success, bytes32 evidenceHash) {
        bytes32 digest = _authenticate(manifest, calls, policy, ownerSignature);
        usedNonces[manifest.nonce] = true;

        bytes memory payload = abi.encodeCall(this.executeIsolated, (calls, policy));
        bytes memory result;
        (success, result) = address(this).call(payload);
        if (success) {
            _recordSuccessfulPolicy(policy, calls);
            emit IntentExecuted(digest, manifest.agent, manifest.callsHash);
            return (true, bytes32(0));
        }

        if (_selector(result) != PolicyViolation.selector) {
            evidenceHash = keccak256(abi.encode(digest, manifest.callsHash, _boundedBytesHash(result)));
            emit ExecutionFailed(digest, manifest.agent, manifest.callsHash, evidenceHash);
            return (false, evidenceHash);
        }

        (ViolationCode code, bytes32 innerEvidence) = _decodePolicyViolation(result);
        AgentState storage state = agents[manifest.agent];
        unchecked {
            ++state.strikes;
        }
        if (state.strikes >= quarantineThreshold) {
            state.quarantined = true;
            emit AgentQuarantined(manifest.agent, state.strikes);
        }
        evidenceHash = keccak256(
            abi.encode(
                digest,
                manifest.agent,
                code,
                policy.module,
                manifest.callsHash,
                innerEvidence,
                state.strikes,
                state.quarantined,
                block.number,
                block.timestamp
            )
        );
        violations[evidenceHash] = ViolationRecord({
            intentDigest: digest,
            agent: manifest.agent,
            code: code,
            module: policy.module,
            callsHash: manifest.callsHash,
            evidenceHash: innerEvidence,
            strikeCount: state.strikes,
            quarantined: state.quarantined,
            blockNumber: uint64(block.number),
            timestamp: uint48(block.timestamp)
        });
        emit IntentViolation(
            digest, manifest.agent, code, policy.module, evidenceHash, state.strikes, state.quarantined
        );
    }

    function executeIsolated(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        external
        onlySelf
    {
        phase4Validator.validateCalls(calls, policy, address(this));
        _validateStatefulPolicy(calls, policy);
        uint256 nativeBefore = address(this).balance;
        uint256[] memory accountBefore = new uint256[](policy.assets.length);
        uint256[] memory recipientBefore = new uint256[](policy.assets.length);
        for (uint256 i; i < policy.assets.length; ++i) {
            accountBefore[i] = IERC20(policy.assets[i].token).balanceOf(address(this));
            recipientBefore[i] = IERC20(policy.assets[i].token).balanceOf(policy.assets[i].recipient);
        }

        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes32 failureHash) = _boundedCall(calls[i]);
            if (!ok) revert TargetCallFailed(i, failureHash);
        }

        _validateOutcomes(policy, nativeBefore, accountBefore, recipientBefore);
    }

    function _authenticate(
        IntentTypesV2.IntentManifest calldata m,
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        bytes calldata signature
    ) internal view returns (bytes32 digest) {
        AgentState memory state = agents[msg.sender];
        if (msg.sender != m.agent || !state.registered) revert UnauthorizedAgent();
        if (state.quarantined) revert AgentQuarantinedError();
        if (m.version != MANIFEST_VERSION) revert WrongVersion();
        if (m.evidenceMode != 1) revert InvalidPolicy();
        if (m.account != address(this)) revert WrongAccount();
        if (m.owner != owner()) revert WrongOwner();
        if (m.chainId != block.chainid) revert WrongChain();
        if (m.validUntil <= m.validAfter) revert InvalidValidityWindow();
        if (block.timestamp < m.validAfter) revert IntentNotYetValid();
        if (block.timestamp > m.validUntil) revert IntentExpired();
        if (usedNonces[m.nonce]) revert NonceAlreadyUsed();
        if (calls.length == 0 || calls.length > MAX_CALLS) revert InvalidCallCount();
        if (calls.length > 1 && !m.allowBatch) revert BatchNotAllowed();
        if (policy.assets.length > MAX_ASSET_CONSTRAINTS || policy.allowances.length > MAX_ALLOWANCE_CONSTRAINTS) {
            revert InvalidPolicy();
        }
        phase4Validator.validateShape(policy, address(this));
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == address(0) || calls[i].target == address(this)) revert InvalidCallTarget();
            if (calls[i].operation != IntentTypesV2.Operation.Call) revert UnsupportedOperation();
        }
        if (hashCalls(calls) != m.callsHash) revert CallsHashMismatch();
        if (hashPolicy(policy) != m.policyHash) revert PolicyHashMismatch();
        digest = hashIntent(m);
        if (ECDSA.recover(digest, signature) != owner()) revert InvalidOwnerSignature();
    }

    /* Module-specific shape and call validation moved to the immutable Phase4PolicyValidator.
    function _validatePolicyShape(IntentTypesV2.Policy calldata policy) private view {
        uint256 expectedModuleDataLength;
        if (policy.module == IntentTypesV2.PolicyModule.Transfer) expectedModuleDataLength = 192;
        else if (policy.module == IntentTypesV2.PolicyModule.Swap) expectedModuleDataLength = 128;
        else if (policy.module == IntentTypesV2.PolicyModule.Approval) expectedModuleDataLength = 128;
        else if (policy.module == IntentTypesV2.PolicyModule.DeFiDeposit) expectedModuleDataLength = 192;
        else if (policy.module == IntentTypesV2.PolicyModule.DeFiWithdrawal) expectedModuleDataLength = 160;
        else if (policy.module == IntentTypesV2.PolicyModule.YieldRebalance) expectedModuleDataLength = 160;
        else if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) expectedModuleDataLength = 224;
        else if (policy.module == IntentTypesV2.PolicyModule.Payroll) expectedModuleDataLength = 224;
        else if (policy.module == IntentTypesV2.PolicyModule.Subscription) expectedModuleDataLength = 256;
        else if (policy.module == IntentTypesV2.PolicyModule.NftPurchase) expectedModuleDataLength = 384;
        else if (policy.module == IntentTypesV2.PolicyModule.Administration) expectedModuleDataLength = 224;
        if (policy.moduleData.length != expectedModuleDataLength) revert InvalidPolicy();

        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token == address(0) || policy.assets[i].recipient == address(0)) {
                revert InvalidPolicy();
            }
        }
        for (uint256 i; i < policy.allowances.length; ++i) {
            if (policy.allowances[i].token == address(0) || policy.allowances[i].spender == address(0)) {
                revert InvalidPolicy();
            }
        }

        if (policy.module == IntentTypesV2.PolicyModule.Transfer) {
            (address token, address recipient, uint256 maximum, bool nativeTransfer, address target, bytes4 selector) =
                abi.decode(policy.moduleData, (address, address, uint256, bool, address, bytes4));
            if (recipient == address(0) || target == address(0)) revert InvalidPolicy();
            if (nativeTransfer) {
                if (token != address(0) || target != recipient || selector != bytes4(0)) revert InvalidPolicy();
            } else if (
                token == address(0) || target != token || selector != TRANSFER_SELECTOR
                    || !_hasAssetConstraint(policy, token, maximum, recipient, 0)
            ) {
                revert InvalidPolicy();
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.Swap) {
            (address router, address input, address output, address recipient) =
                abi.decode(policy.moduleData, (address, address, address, address));
            if (
                router == address(0) || input == address(0) || output == address(0) || input == output
                    || recipient == address(0) || !_hasTokenConstraint(policy, input)
                    || !_hasAssetConstraint(policy, output, type(uint256).max, recipient, 0)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.Approval) {
            (address token, address spender, uint256 maximum, bool requireZero) =
                abi.decode(policy.moduleData, (address, address, uint256, bool));
            if (
                token == address(0) || spender == address(0)
                    || !_hasAllowanceConstraint(policy, token, spender, requireZero ? 0 : maximum)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiDeposit) {
            (
                address vault,
                address asset,
                address beneficiary,
                uint256 maxAssets,
                uint256 minShares,
                uint256 allowanceCap
            ) = abi.decode(policy.moduleData, (address, address, address, uint256, uint256, uint256));
            if (
                vault == address(0) || asset == address(0) || vault == asset || beneficiary == address(0)
                    || !_hasAssetConstraint(policy, asset, maxAssets, address(this), 0)
                    || !_hasAssetConstraint(policy, vault, 0, beneficiary, minShares)
                    || !_hasAllowanceConstraint(policy, asset, vault, allowanceCap)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiWithdrawal) {
            (address vault, address asset, address recipient, uint256 maxShares, uint256 minAssets) =
                abi.decode(policy.moduleData, (address, address, address, uint256, uint256));
            if (
                vault == address(0) || asset == address(0) || vault == asset || recipient == address(0)
                    || !_hasAssetConstraint(policy, vault, maxShares, address(this), 0)
                    || !_hasAssetConstraint(policy, asset, 0, recipient, minAssets)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.YieldRebalance) {
            (address asset, address oracle, bytes32 approvedVaultsHash,,) =
                abi.decode(policy.moduleData, (address, address, bytes32, uint256, uint256));
            address[] memory vaults = _yieldVaults(policy, asset);
            if (
                asset == address(0) || oracle == address(0) || !_hasTokenConstraint(policy, asset) || vaults.length < 2
                    || _hasDuplicate(vaults) || keccak256(abi.encode(vaults.length, vaults)) != approvedVaultsHash
            ) revert InvalidPolicy();
            for (uint256 i; i < vaults.length; ++i) {
                if (!_hasAssetConstraint(policy, vaults[i], type(uint256).max, address(this), 0)) {
                    revert InvalidPolicy();
                }
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) {
            (
                address asset,
                address recipient,
                uint256 maximum,
                bytes32 referenceHash,
                bytes32 budgetId,
                uint48 epochLength,
                uint256 epochBudget
            ) = abi.decode(policy.moduleData, (address, address, uint256, bytes32, bytes32, uint48, uint256));
            if (
                asset == address(0) || recipient == address(0) || referenceHash == bytes32(0)
                    || !_hasAssetConstraint(policy, asset, maximum, recipient, 0)
                    || (epochLength == 0 && (budgetId != bytes32(0) || epochBudget != 0))
                    || (epochLength != 0 && (budgetId == bytes32(0) || epochBudget == 0))
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.Payroll) {
            (address asset, address employee, uint256 maximum, bytes32 paymentId,, uint48 earliest, uint48 latest) =
                abi.decode(policy.moduleData, (address, address, uint256, bytes32, uint256, uint48, uint48));
            if (
                asset == address(0) || employee == address(0) || paymentId == bytes32(0) || latest < earliest
                    || !_hasAssetConstraint(policy, asset, maximum, employee, 0)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.Subscription) {
            (
                bytes32 subscriptionId,
                address asset,
                address merchant,
                uint256 maximum,
                uint48 interval,
                uint48 start,
                uint48 end,
                uint32 maxPayments
            ) = abi.decode(policy.moduleData, (bytes32, address, address, uint256, uint48, uint48, uint48, uint32));
            if (
                subscriptionId == bytes32(0) || asset == address(0) || merchant == address(0) || interval == 0
                    || end < start || maxPayments == 0 || !_hasAssetConstraint(policy, asset, maximum, merchant, 0)
            ) revert InvalidPolicy();
        } else if (
            policy.module == IntentTypesV2.PolicyModule.NftPurchase
                || policy.module == IntentTypesV2.PolicyModule.Administration
        ) {
            phase4Validator.validateShape(policy, address(this));
        }
    }

    function _validateModule(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        view
    {
        if (policy.module == IntentTypesV2.PolicyModule.Transfer) {
            (address token, address recipient, uint256 maximum, bool nativeTransfer, address target, bytes4 selector) =
                abi.decode(policy.moduleData, (address, address, uint256, bool, address, bytes4));
            if (calls.length != 1 || calls[0].target != target || recipient == address(0)) {
                _violate(ViolationCode.UnauthorizedCall, keccak256(policy.moduleData));
            }
            if (nativeTransfer) {
                if (token != address(0) || target != recipient || calls[0].value > maximum || calls[0].data.length != 0)
                {
                    _violate(ViolationCode.MaxSpendExceeded, keccak256(abi.encode(calls[0].value, maximum)));
                }
            } else {
                if (
                    token == address(0) || target != token || selector != TRANSFER_SELECTOR
                        || calls[0].data.length != 68 || _selectorCalldata(calls[0].data) != selector
                ) {
                    _violate(ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
                }
                (address actualRecipient, uint256 amount) = abi.decode(calls[0].data[4:], (address, uint256));
                if (actualRecipient != recipient) {
                    _violate(ViolationCode.WrongRecipient, keccak256(abi.encode(actualRecipient, recipient)));
                }
                if (amount > maximum) {
                    _violate(ViolationCode.MaxSpendExceeded, keccak256(abi.encode(amount, maximum)));
                }
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.Swap) {
            (address router,,,) = abi.decode(policy.moduleData, (address, address, address, address));
            bool routerCalled;
            for (uint256 i; i < calls.length; ++i) {
                if (calls[i].target == router) routerCalled = true;
            }
            if (!routerCalled) _violate(ViolationCode.UnauthorizedCall, keccak256(policy.moduleData));
        } else if (policy.module == IntentTypesV2.PolicyModule.Approval) {
            (address token, address spender, uint256 maximum, bool requireZero) =
                abi.decode(policy.moduleData, (address, address, uint256, bool));
            if (
                calls.length != 1 || calls[0].target != token || calls[0].data.length != 68
                    || _selectorCalldata(calls[0].data) != APPROVE_SELECTOR
            ) {
                _violate(ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
            }
            (address actualSpender, uint256 amount) = abi.decode(calls[0].data[4:], (address, uint256));
            if (actualSpender != spender) {
                _violate(ViolationCode.UnauthorizedCall, keccak256(abi.encode(actualSpender, spender)));
            }
            if (amount > maximum || (requireZero && amount != 0)) {
                _violate(ViolationCode.AllowanceExceeded, keccak256(abi.encode(amount, maximum, requireZero)));
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.Batch) {
            if (calls.length < 2) _violate(ViolationCode.PolicyModuleFailure, keccak256("batch-too-short"));
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiDeposit) {
            _validateDeposit(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiWithdrawal) {
            _validateWithdrawal(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.YieldRebalance) {
            _validateYieldCalls(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) {
            _validateTreasuryPayment(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Payroll) {
            _validatePayrollPayment(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Subscription) {
            _validateSubscriptionPayment(calls, policy);
        } else if (
            policy.module == IntentTypesV2.PolicyModule.NftPurchase
                || policy.module == IntentTypesV2.PolicyModule.Administration
        ) {
            phase4Validator.validateCalls(calls, policy, address(this));
        }
    }

    */
    function _validateStatefulPolicy(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        view
    {
        if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) {
            _validateTreasuryPayment(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Payroll) {
            _validatePayrollPayment(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Subscription) {
            _validateSubscriptionPayment(calls, policy);
        }
    }

    function _validateTreasuryPayment(
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy
    ) private view {
        (
            address asset,
            address recipient,
            uint256 maximum,
            bytes32 referenceHash,
            bytes32 budgetId,
            uint48 epochLength,
            uint256 epochBudget
        ) = abi.decode(policy.moduleData, (address, address, uint256, bytes32, bytes32, uint48, uint256));
        asset;
        recipient;
        maximum;
        uint256 amount = _paymentAmount(calls[0].data);
        if (usedTreasuryReferences[referenceHash]) {
            _violate(ViolationCode.PaymentPeriodViolation, keccak256(abi.encode(referenceHash)));
        }
        if (epochLength != 0) {
            uint256 epoch = block.timestamp / epochLength;
            uint256 spent = treasuryEpochSpend[budgetId][epoch];
            if (spent > epochBudget || amount > epochBudget - spent) {
                _violate(
                    ViolationCode.MaxSpendExceeded, keccak256(abi.encode(budgetId, epoch, spent, amount, epochBudget))
                );
            }
        }
    }

    function _validatePayrollPayment(IntentTypesV2.ExecutionCall[] calldata, IntentTypesV2.Policy calldata policy)
        private
        view
    {
        (
            address asset,
            address employee,
            uint256 maximum,
            bytes32 paymentId,
            uint256 period,
            uint48 earliest,
            uint48 latest
        ) = abi.decode(policy.moduleData, (address, address, uint256, bytes32, uint256, uint48, uint48));
        maximum;
        bytes32 periodKey = keccak256(abi.encode(asset, employee, period));
        if (
            block.timestamp < earliest || block.timestamp > latest || usedPayrollPayments[paymentId]
                || usedPayrollPeriods[periodKey]
        ) {
            _violate(
                ViolationCode.PaymentPeriodViolation,
                keccak256(abi.encode(paymentId, period, block.timestamp, earliest, latest))
            );
        }
    }

    function _validateSubscriptionPayment(IntentTypesV2.ExecutionCall[] calldata, IntentTypesV2.Policy calldata policy)
        private
        view
    {
        (
            bytes32 subscriptionId,
            address asset,
            address merchant,
            uint256 maximum,
            uint48 interval,
            uint48 start,
            uint48 end,
            uint32 maxPayments
        ) = abi.decode(policy.moduleData, (bytes32, address, address, uint256, uint48, uint48, uint48, uint32));
        asset;
        merchant;
        maximum;
        if (
            cancelledSubscriptions[subscriptionId] || block.timestamp < start || block.timestamp > end
                || subscriptionPaymentCount[subscriptionId] >= maxPayments
        ) {
            _violate(
                ViolationCode.PaymentPeriodViolation,
                keccak256(abi.encode(subscriptionId, subscriptionPaymentCount[subscriptionId], block.timestamp))
            );
        }
        uint256 period = (block.timestamp - start) / interval;
        if (usedSubscriptionPeriods[keccak256(abi.encode(subscriptionId, period))]) {
            _violate(ViolationCode.PaymentPeriodViolation, keccak256(abi.encode(subscriptionId, period)));
        }
    }

    /* Pure module call checks moved to the immutable Phase4PolicyValidator.
    function _validateTokenPaymentCall(
        IntentTypesV2.ExecutionCall[] calldata calls,
        address asset,
        address recipient,
        uint256 maximum
    ) private pure returns (uint256 amount) {
        if (
            calls.length != 1 || calls[0].target != asset || calls[0].value != 0 || calls[0].data.length != 68
                || _selectorCalldata(calls[0].data) != TRANSFER_SELECTOR
        ) _violate(ViolationCode.UnauthorizedCall, keccak256(abi.encode(calls.length, asset)));
        (address actualRecipient, uint256 actualAmount) = abi.decode(calls[0].data[4:], (address, uint256));
        if (actualRecipient != recipient) {
            _violate(ViolationCode.WrongRecipient, keccak256(abi.encode(actualRecipient, recipient)));
        }
        if (actualAmount > maximum) {
            _violate(ViolationCode.MaxSpendExceeded, keccak256(abi.encode(actualAmount, maximum)));
        }
        return actualAmount;
    }

    function _validateDeposit(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        pure
    {
        (address vault, address asset, address beneficiary, uint256 maxAssets,,) =
            abi.decode(policy.moduleData, (address, address, address, uint256, uint256, uint256));
        uint256 depositCount;
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == vault && _selectorCalldata(calls[i].data) == DEPOSIT_SELECTOR) {
                if (calls[i].data.length != 68) {
                    _violate(ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
                }
                (uint256 assets, address receiver) = abi.decode(calls[i].data[4:], (uint256, address));
                if (assets > maxAssets) {
                    _violate(ViolationCode.MaxSpendExceeded, keccak256(abi.encode(assets, maxAssets)));
                }
                if (receiver != beneficiary) {
                    _violate(ViolationCode.WrongRecipient, keccak256(abi.encode(receiver, beneficiary)));
                }
                ++depositCount;
            } else if (calls[i].target == asset) {
                if (calls[i].data.length != 68 || _selectorCalldata(calls[i].data) != APPROVE_SELECTOR) {
                    _violate(ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
                }
                (address spender, uint256 amount) = abi.decode(calls[i].data[4:], (address, uint256));
                if (spender != vault || amount > maxAssets) {
                    _violate(ViolationCode.AllowanceExceeded, keccak256(abi.encode(spender, amount, maxAssets)));
                }
            } else {
                _violate(ViolationCode.UnauthorizedCall, keccak256(abi.encode(i, calls[i].target)));
            }
        }
        if (depositCount != 1) _violate(ViolationCode.UnauthorizedCall, keccak256(abi.encode(depositCount)));
    }

    function _validateWithdrawal(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        view
    {
        (address vault,, address recipient,,) =
            abi.decode(policy.moduleData, (address, address, address, uint256, uint256));
        if (calls.length != 1 || calls[0].target != vault || calls[0].data.length != 100) {
            _violate(ViolationCode.UnauthorizedCall, keccak256(policy.moduleData));
        }
        if (_selectorCalldata(calls[0].data) != WITHDRAW_SELECTOR) {
            _violate(ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
        }
        (, address receiver, address sharesOwner) = abi.decode(calls[0].data[4:], (uint256, address, address));
        if (receiver != recipient || sharesOwner != address(this)) {
            _violate(ViolationCode.WrongRecipient, keccak256(abi.encode(receiver, sharesOwner)));
        }
    }

    function _validateYieldCalls(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        view
    {
        (address asset,,,,) = abi.decode(policy.moduleData, (address, address, bytes32, uint256, uint256));
        address[] memory vaults = _yieldVaults(policy, asset);
        uint256 deposits;
        uint256 withdrawals;
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == asset) {
                if (calls[i].data.length != 68 || _selectorCalldata(calls[i].data) != APPROVE_SELECTOR) {
                    _violate(ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
                }
                (address spender,) = abi.decode(calls[i].data[4:], (address, uint256));
                if (!_contains(vaults, spender) || !_hasAllowanceConstraint(policy, asset, spender, 0)) {
                    _violate(ViolationCode.UnauthorizedCall, keccak256(abi.encode(spender)));
                }
                continue;
            }
            bool approved;
            for (uint256 j; j < vaults.length; ++j) {
                if (calls[i].target == vaults[j]) approved = true;
            }
            if (!approved) {
                _violate(ViolationCode.UnauthorizedCall, keccak256(abi.encode(i, calls[i].target)));
            }
            bytes4 selector = _selectorCalldata(calls[i].data);
            if (selector == DEPOSIT_SELECTOR && calls[i].data.length == 68) {
                (, address receiver) = abi.decode(calls[i].data[4:], (uint256, address));
                if (receiver != address(this)) {
                    _violate(ViolationCode.WrongRecipient, keccak256(abi.encode(receiver)));
                }
                ++deposits;
            } else if (selector == WITHDRAW_SELECTOR && calls[i].data.length == 100) {
                (, address receiver, address sharesOwner) = abi.decode(calls[i].data[4:], (uint256, address, address));
                if (receiver != address(this) || sharesOwner != address(this)) {
                    _violate(ViolationCode.WrongRecipient, keccak256(abi.encode(receiver, sharesOwner)));
                }
                ++withdrawals;
            } else {
                _violate(ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
            }
        }
        if (deposits == 0 || withdrawals == 0) {
            _violate(ViolationCode.PolicyModuleFailure, keccak256(abi.encode(deposits, withdrawals)));
        }
    }

    */
    function _validateOutcomes(
        IntentTypesV2.Policy calldata policy,
        uint256 nativeBefore,
        uint256[] memory accountBefore,
        uint256[] memory recipientBefore
    ) private view {
        uint256 nativeAfter = address(this).balance;
        uint256 nativeSpent = nativeBefore > nativeAfter ? nativeBefore - nativeAfter : 0;
        if (nativeSpent > policy.nativeConstraint.maxSpend) {
            _violate(
                ViolationCode.NativeSpendExceeded, keccak256(abi.encode(nativeSpent, policy.nativeConstraint.maxSpend))
            );
        }
        if (nativeAfter < policy.nativeConstraint.minFinalBalance) {
            _violate(
                ViolationCode.ProtectedAssetLoss,
                keccak256(abi.encode(nativeAfter, policy.nativeConstraint.minFinalBalance))
            );
        }
        uint256 totalSpent;
        for (uint256 i; i < policy.assets.length; ++i) {
            IntentTypesV2.AssetConstraint calldata a = policy.assets[i];
            uint256 accountAfter = IERC20(a.token).balanceOf(address(this));
            uint256 recipientAfter = IERC20(a.token).balanceOf(a.recipient);
            uint256 spent = accountBefore[i] > accountAfter ? accountBefore[i] - accountAfter : 0;
            totalSpent += spent;
            uint256 received = recipientAfter > recipientBefore[i] ? recipientAfter - recipientBefore[i] : 0;
            if (spent > a.maxSpend) {
                _violate(ViolationCode.MaxSpendExceeded, keccak256(abi.encode(i, spent, a.maxSpend)));
            }
            if (received < a.minReceive) {
                _violate(ViolationCode.MinOutputNotMet, keccak256(abi.encode(i, received, a.minReceive)));
            }
            if (accountAfter < a.minFinalBalance) {
                _violate(ViolationCode.ProtectedAssetLoss, keccak256(abi.encode(i, accountAfter, a.minFinalBalance)));
            }
        }
        for (uint256 i; i < policy.allowances.length; ++i) {
            IntentTypesV2.AllowanceConstraint calldata a = policy.allowances[i];
            uint256 finalAllowance = IERC20(a.token).allowance(address(this), a.spender);
            if (finalAllowance > a.maxFinalAllowance) {
                _violate(ViolationCode.AllowanceExceeded, keccak256(abi.encode(i, finalAllowance, a.maxFinalAllowance)));
            }
        }
        if (
            policy.module == IntentTypesV2.PolicyModule.YieldRebalance
                || policy.module == IntentTypesV2.PolicyModule.NftPurchase
        ) {
            phase4Validator.validateOutcome(policy, address(this), totalSpent);
        }
    }

    /* Yield-specific outcome validation moved to the immutable Phase4PolicyValidator.
    function _validateYieldOutcome(IntentTypesV2.Policy calldata policy, uint256 totalSpent) private view {
        (address asset, address oracle,, uint256 maxMovement, uint256 minPortfolioValue) =
            abi.decode(policy.moduleData, (address, address, bytes32, uint256, uint256));
        if (totalSpent > maxMovement) {
            _violate(ViolationCode.MaxSpendExceeded, keccak256(abi.encode(totalSpent, maxMovement)));
        }
        uint256 portfolioValue = IERC20(asset).balanceOf(address(this));
        address[] memory vaults = _yieldVaults(policy, asset);
        for (uint256 i; i < vaults.length; ++i) {
            portfolioValue += IERC20(vaults[i]).balanceOf(address(this)) * IVaultPriceOracle(oracle).price(vaults[i])
            / 1e18;
        }
        if (portfolioValue < minPortfolioValue) {
            _violate(ViolationCode.MinOutputNotMet, keccak256(abi.encode(portfolioValue, minPortfolioValue)));
        }
    }

    */
    function _recordSuccessfulPolicy(IntentTypesV2.Policy calldata policy, IntentTypesV2.ExecutionCall[] calldata calls)
        private
    {
        if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) {
            (,,, bytes32 referenceHash, bytes32 budgetId, uint48 epochLength,) =
                abi.decode(policy.moduleData, (address, address, uint256, bytes32, bytes32, uint48, uint256));
            uint256 amount = _paymentAmount(calls[0].data);
            usedTreasuryReferences[referenceHash] = true;
            if (epochLength != 0) treasuryEpochSpend[budgetId][block.timestamp / epochLength] += amount;
            emit TreasuryPaymentRecorded(referenceHash, budgetId, amount);
        } else if (policy.module == IntentTypesV2.PolicyModule.Payroll) {
            (address asset, address employee,, bytes32 paymentId, uint256 period,,) =
                abi.decode(policy.moduleData, (address, address, uint256, bytes32, uint256, uint48, uint48));
            uint256 amount = _paymentAmount(calls[0].data);
            usedPayrollPayments[paymentId] = true;
            usedPayrollPeriods[keccak256(abi.encode(asset, employee, period))] = true;
            emit PayrollPaymentRecorded(paymentId, period, amount);
        } else if (policy.module == IntentTypesV2.PolicyModule.Subscription) {
            (bytes32 subscriptionId,,,, uint48 interval, uint48 start,,) =
                abi.decode(policy.moduleData, (bytes32, address, address, uint256, uint48, uint48, uint48, uint32));
            uint256 period = (block.timestamp - start) / interval;
            usedSubscriptionPeriods[keccak256(abi.encode(subscriptionId, period))] = true;
            unchecked {
                ++subscriptionPaymentCount[subscriptionId];
            }
            emit SubscriptionPaymentRecorded(subscriptionId, period, _paymentAmount(calls[0].data));
        }
    }

    function _paymentAmount(bytes calldata data) private pure returns (uint256 amount) {
        (, amount) = abi.decode(data[4:], (address, uint256));
    }

    /* Module-specific constraint lookup helpers moved to the immutable Phase4PolicyValidator.
    function _hasAssetConstraint(
        IntentTypesV2.Policy calldata policy,
        address token,
        uint256 maximumSpend,
        address recipient,
        uint256 minimumReceive
    ) private pure returns (bool found) {
        for (uint256 i; i < policy.assets.length; ++i) {
            IntentTypesV2.AssetConstraint calldata a = policy.assets[i];
            if (
                a.token == token && a.maxSpend <= maximumSpend && a.recipient == recipient
                    && a.minReceive >= minimumReceive
            ) return true;
        }
    }

    function _hasTokenConstraint(IntentTypesV2.Policy calldata policy, address token)
        private
        pure
        returns (bool found)
    {
        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token == token) return true;
        }
    }

    function _hasAllowanceConstraint(
        IntentTypesV2.Policy calldata policy,
        address token,
        address spender,
        uint256 maximum
    ) private pure returns (bool found) {
        for (uint256 i; i < policy.allowances.length; ++i) {
            IntentTypesV2.AllowanceConstraint calldata a = policy.allowances[i];
            if (a.token == token && a.spender == spender && a.maxFinalAllowance <= maximum) return true;
        }
    }

    function _yieldVaults(IntentTypesV2.Policy calldata policy, address asset)
        private
        pure
        returns (address[] memory vaults)
    {
        uint256 count;
        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token != asset) ++count;
        }
        vaults = new address[](count);
        uint256 cursor;
        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token != asset) vaults[cursor++] = policy.assets[i].token;
        }
    }

    function _hasDuplicate(address[] memory values) private pure returns (bool) {
        for (uint256 i; i < values.length; ++i) {
            for (uint256 j = i + 1; j < values.length; ++j) {
                if (values[i] == values[j]) return true;
            }
        }
        return false;
    }

    function _contains(address[] memory values, address value) private pure returns (bool) {
        for (uint256 i; i < values.length; ++i) {
            if (values[i] == value) return true;
        }
        return false;
    }

    */
    function _boundedCall(IntentTypesV2.ExecutionCall calldata call_)
        private
        returns (bool ok, bytes32 revertDataHash)
    {
        uint256 maxCopy = MAX_REVERT_DATA_COPY;
        address target = call_.target;
        uint256 value = call_.value;
        bytes memory data = call_.data;
        assembly ("memory-safe") {
            ok := call(gas(), target, value, add(data, 0x20), mload(data), 0, 0)
            if iszero(ok) {
                let size := returndatasize()
                let copySize := size
                if gt(copySize, maxCopy) { copySize := maxCopy }
                let ptr := mload(0x40)
                mstore(ptr, size)
                returndatacopy(add(ptr, 0x20), 0, copySize)
                revertDataHash := keccak256(ptr, add(0x20, copySize))
                mstore(0x40, and(add(add(add(ptr, 0x20), copySize), 0x1f), not(0x1f)))
            }
        }
    }

    function _decodePolicyViolation(bytes memory data) private pure returns (ViolationCode code, bytes32 evidence) {
        if (data.length != 68) return (ViolationCode.PolicyModuleFailure, keccak256(data));
        assembly ("memory-safe") {
            code := mload(add(data, 36))
            evidence := mload(add(data, 68))
        }
        if (uint8(code) > uint8(ViolationCode.NativeSpendExceeded)) {
            return (ViolationCode.PolicyModuleFailure, keccak256(data));
        }
    }

    function _boundedBytesHash(bytes memory data) private pure returns (bytes32) {
        if (data.length <= MAX_REVERT_DATA_COPY) return keccak256(data);
        return keccak256(abi.encode(data.length, keccak256(bytes.concat(_slice(data, MAX_REVERT_DATA_COPY)))));
    }

    function _slice(bytes memory data, uint256 length) private pure returns (bytes memory result) {
        result = new bytes(length);
        for (uint256 i; i < length; ++i) {
            result[i] = data[i];
        }
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        if (data.length >= 4) assembly ("memory-safe") { selector := mload(add(data, 32)) }
    }

    function _selectorCalldata(bytes calldata data) private pure returns (bytes4 selector) {
        if (data.length >= 4) assembly ("memory-safe") { selector := calldataload(data.offset) }
    }

    function _violate(ViolationCode code, bytes32 evidence) private pure {
        revert PolicyViolation(code, evidence);
    }
}
