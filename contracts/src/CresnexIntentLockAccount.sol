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
import {IntentTypes} from "./IntentTypes.sol";
import {ICresnexIntentLock} from "./interfaces/ICresnexIntentLock.sol";

/// @notice Experimental intent-bound smart account. Not audited or production-ready.
contract CresnexIntentLockAccount is ICresnexIntentLock, EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BATCH_SIZE = 16;
    bytes32 public constant EXECUTION_CALL_TYPEHASH =
        keccak256("ExecutionCall(address target,uint256 value,bytes data)");
    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "IntentManifest(address account,address agent,uint256 chainId,bytes32 callsHash,address inputToken,uint256 maxInputAmount,address outputToken,uint256 minOutputAmount,address recipient,address approvalToken,address approvalSpender,uint256 maxFinalAllowance,uint256 nonce,uint48 validAfter,uint48 validUntil,bool allowBatch)"
    );

    error OnlySelf();
    error UnauthorizedAgent();
    error AgentQuarantinedError();
    error WrongAccount();
    error WrongChain();
    error InvalidValidityWindow();
    error IntentNotYetValid();
    error IntentExpired();
    error NonceAlreadyUsed();
    error InvalidCallCount();
    error BatchNotAllowed();
    error InvalidCallTarget();
    error CallsHashMismatch();
    error InvalidOwnerSignature();
    error InvalidPolicy();
    error InputOverspent(uint256 spent, uint256 maximum);
    error InsufficientOutput(uint256 received, uint256 minimum);
    error ExcessiveAllowance(uint256 allowance, uint256 maximum);
    error TargetCallFailed(uint256 index, bytes32 revertDataHash);
    error InvalidThreshold();

    mapping(address => AgentState) public agents;
    mapping(uint256 => bool) public usedNonces;
    mapping(bytes32 => ViolationRecord) public violations;
    uint256 public quarantineThreshold = 3;

    event AgentRegistered(address indexed agent);
    event AgentRemoved(address indexed agent);
    event QuarantineThresholdUpdated(uint256 threshold);
    event AgentStrikesReset(address indexed agent);

    constructor(address initialOwner) EIP712("Cresnex IntentLock", "1") Ownable(initialOwner) {}

    receive() external payable {}

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
        delete agents[agent];
        emit AgentRemoved(agent);
    }

    function setQuarantineThreshold(uint256 threshold) external onlyOwner {
        if (threshold == 0) revert InvalidThreshold();
        quarantineThreshold = threshold;
        emit QuarantineThresholdUpdated(threshold);
    }

    function resetAgentStrikes(address agent) external onlyOwner {
        agents[agent].strikes = 0;
        emit AgentStrikesReset(agent);
    }

    function unquarantineAgent(address agent) external onlyOwner {
        agents[agent].quarantined = false;
        emit AgentRecovered(agent);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency owner escape hatch; its power is explicit in the threat model.
    function recoverToken(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || recipient == address(0)) revert InvalidPolicy();
        IERC20(token).safeTransfer(recipient, amount);
    }

    function hashExecutionCall(IntentTypes.ExecutionCall calldata call_) public pure returns (bytes32) {
        return keccak256(abi.encode(EXECUTION_CALL_TYPEHASH, call_.target, call_.value, keccak256(call_.data)));
    }

    function hashCalls(IntentTypes.ExecutionCall[] calldata calls) public pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            hashes[i] = hashExecutionCall(calls[i]);
        }
        return keccak256(abi.encode(calls.length, hashes));
    }

    function hashIntent(IntentTypes.IntentManifest calldata m) public view returns (bytes32) {
        // All manifest members are static ABI types. Splitting the encoding and
        // concatenating the two 32-byte-aligned segments is byte-for-byte
        // equivalent to one abi.encode call, while avoiding legacy-codegen
        // stack limits during coverage instrumentation.
        bytes memory prefix = abi.encode(
            INTENT_TYPEHASH,
            m.account,
            m.agent,
            m.chainId,
            m.callsHash,
            m.inputToken,
            m.maxInputAmount,
            m.outputToken,
            m.minOutputAmount
        );
        bytes memory suffix = abi.encode(
            m.recipient,
            m.approvalToken,
            m.approvalSpender,
            m.maxFinalAllowance,
            m.nonce,
            m.validAfter,
            m.validUntil,
            m.allowBatch
        );
        return _hashTypedDataV4(keccak256(bytes.concat(prefix, suffix)));
    }

    function executeIntent(
        IntentTypes.IntentManifest calldata manifest,
        IntentTypes.ExecutionCall[] calldata calls,
        bytes calldata ownerSignature
    ) external nonReentrant whenNotPaused returns (bool success, bytes32 evidenceHash) {
        bytes32 intentHash = _authenticate(manifest, calls, ownerSignature);
        usedNonces[manifest.nonce] = true;

        bytes memory payload = abi.encodeCall(this.executeIsolated, (manifest, calls));
        bytes memory result;
        (success, result) = address(this).call(payload);
        if (success) {
            emit IntentExecuted(intentHash, manifest.agent);
            return (true, bytes32(0));
        }

        bytes4 selector = _selector(result);
        bytes32 revertHash = keccak256(result);
        AgentState storage state = agents[manifest.agent];
        unchecked {
            ++state.strikes;
        }
        if (state.strikes >= quarantineThreshold && !state.quarantined) {
            state.quarantined = true;
            emit AgentQuarantined(manifest.agent, state.strikes);
        }
        evidenceHash = keccak256(
            abi.encode(
                manifest.agent,
                intentHash,
                manifest.callsHash,
                block.timestamp,
                revertHash,
                selector,
                state.strikes,
                state.quarantined
            )
        );
        violations[evidenceHash] = ViolationRecord({
            agent: manifest.agent,
            intentHash: intentHash,
            callsHash: manifest.callsHash,
            timestamp: uint48(block.timestamp),
            revertDataHash: revertHash,
            reasonSelector: selector,
            strikeCount: state.strikes,
            quarantined: state.quarantined
        });
        emit IntentViolation(intentHash, manifest.agent, evidenceHash, selector, state.strikes);
    }

    function executeIsolated(IntentTypes.IntentManifest calldata m, IntentTypes.ExecutionCall[] calldata calls)
        external
        onlySelf
    {
        uint256 inputBefore = IERC20(m.inputToken).balanceOf(address(this));
        uint256 outputBefore = IERC20(m.outputToken).balanceOf(m.recipient);

        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory reason) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert TargetCallFailed(i, keccak256(reason));
        }

        uint256 inputAfter = IERC20(m.inputToken).balanceOf(address(this));
        uint256 outputAfter = IERC20(m.outputToken).balanceOf(m.recipient);
        uint256 spent = inputBefore > inputAfter ? inputBefore - inputAfter : 0;
        uint256 received = outputAfter > outputBefore ? outputAfter - outputBefore : 0;
        if (spent > m.maxInputAmount) revert InputOverspent(spent, m.maxInputAmount);
        if (received < m.minOutputAmount) revert InsufficientOutput(received, m.minOutputAmount);
        uint256 finalAllowance = IERC20(m.approvalToken).allowance(address(this), m.approvalSpender);
        if (finalAllowance > m.maxFinalAllowance) {
            revert ExcessiveAllowance(finalAllowance, m.maxFinalAllowance);
        }
    }

    function _authenticate(
        IntentTypes.IntentManifest calldata m,
        IntentTypes.ExecutionCall[] calldata calls,
        bytes calldata signature
    ) internal view returns (bytes32 digest) {
        AgentState memory state = agents[msg.sender];
        if (msg.sender != m.agent || !state.registered) revert UnauthorizedAgent();
        if (state.quarantined) revert AgentQuarantinedError();
        if (m.account != address(this)) revert WrongAccount();
        if (m.chainId != block.chainid) revert WrongChain();
        if (m.validUntil <= m.validAfter) revert InvalidValidityWindow();
        if (block.timestamp < m.validAfter) revert IntentNotYetValid();
        if (block.timestamp > m.validUntil) revert IntentExpired();
        if (usedNonces[m.nonce]) revert NonceAlreadyUsed();
        if (calls.length == 0 || calls.length > MAX_BATCH_SIZE) revert InvalidCallCount();
        if (calls.length > 1 && !m.allowBatch) revert BatchNotAllowed();
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == address(0) || calls[i].target == address(this)) revert InvalidCallTarget();
        }
        if (
            m.inputToken == address(0) || m.outputToken == address(0) || m.recipient == address(0)
                || m.approvalToken == address(0) || m.approvalSpender == address(0)
        ) revert InvalidPolicy();
        if (hashCalls(calls) != m.callsHash) revert CallsHashMismatch();
        digest = hashIntent(m);
        if (ECDSA.recover(digest, signature) != owner()) revert InvalidOwnerSignature();
    }

    function _selector(bytes memory data) private pure returns (bytes4 selector) {
        if (data.length >= 4) assembly ("memory-safe") { selector := mload(add(data, 32)) }
    }
}
