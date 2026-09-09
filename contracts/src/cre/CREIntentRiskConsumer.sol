// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./IReceiver.sol";

/// @notice Standalone Phase 10 receiver for CRE-produced IntentLock risk verdicts.
/// @dev Both the Forwarder and the configured workflow identity must authenticate every report.
contract CREIntentRiskConsumer is IReceiver {
    uint8 public constant VERDICT_VERSION = 1;
    uint8 public constant DECISION_ALLOW = 0;
    uint8 public constant DECISION_ESCALATE = 1;
    uint8 public constant DECISION_BLOCK = 2;
    string public constant RULE_ID = "intentlock-agent-violations-24h-v1";
    string public constant SIGNAL = "recent indexed IntentLock policy violations";
    bytes32 public constant RULE_ID_HASH = keccak256(bytes(RULE_ID));

    address public immutable forwarder;
    address public immutable gateAdmin;
    address public authorizedGate;
    bytes32 public expectedWorkflowId;
    address public expectedWorkflowOwner;
    bool public workflowAuthorizationConfigured;

    struct RiskVerdict {
        uint8 version;
        uint8 decision;
        string ruleId;
        address account;
        uint256 chainId;
        address agent;
        uint256 nonce;
        bytes32 callsHash;
        bytes32 policyHash;
        uint8 recentViolationCount;
        uint256 graphIndexedBlock;
        uint256 windowStart;
        uint256 issuedAt;
        uint256 validUntil;
        bool evidenceUsable;
        bool thresholdReached;
        bytes32 evidenceHash;
    }

    struct StoredVerdict {
        uint8 decision;
        uint256 validUntil;
        bool evidenceUsable;
        bool thresholdReached;
        bytes32 evidenceHash;
        uint256 receivedAt;
        bool received;
        bool consumed;
    }

    mapping(bytes32 verdictKey => StoredVerdict verdict) public verdicts;

    error ZeroForwarder();
    error UnauthorizedForwarder(address caller);
    error InvalidVersion(uint8 version);
    error InvalidDecision(uint8 decision);
    error InvalidRuleId();
    error InvalidChainId(uint256 chainId);
    error ZeroAccount();
    error ZeroAgent();
    error ZeroCallsHash();
    error ZeroPolicyHash();
    error InvalidValidityWindow();
    error FutureVerdict(uint256 issuedAt);
    error ExpiredVerdict(uint256 validUntil);
    error InconsistentDecisionEvidence();
    error InvalidEvidenceHash();
    error VerdictReplay(bytes32 verdictKey);
    error UnauthorizedGateAdmin(address caller);
    error ZeroGate();
    error GateAlreadyConfigured();
    error UnauthorizedGate(address caller);
    error InvalidMetadataLength(uint256 length);
    error WorkflowAuthorizationNotConfigured();
    error ZeroWorkflowId();
    error ZeroWorkflowOwner();
    error WorkflowAuthorizationAlreadyConfigured();
    error UnauthorizedWorkflow(bytes32 workflowId, address workflowOwner);
    error VerdictMissing(bytes32 verdictKey);
    error VerdictExpired(bytes32 verdictKey);
    error VerdictNotAllow(bytes32 verdictKey);
    error VerdictAlreadyConsumed(bytes32 verdictKey);

    event RiskVerdictAccepted(
        bytes32 indexed verdictKey,
        address indexed account,
        address indexed agent,
        uint256 nonce,
        uint8 decision,
        bytes32 evidenceHash,
        uint256 validUntil
    );
    event AuthorizedGateConfigured(address indexed gate);
    event ExpectedWorkflowConfigured(bytes32 indexed workflowId, address indexed workflowOwner);
    event RiskVerdictConsumed(bytes32 indexed verdictKey, bytes32 indexed evidenceHash);

    constructor(address forwarder_) {
        if (forwarder_ == address(0)) revert ZeroForwarder();
        forwarder = forwarder_;
        gateAdmin = msg.sender;
    }

    function setAuthorizedGate(address gate) external {
        if (msg.sender != gateAdmin) revert UnauthorizedGateAdmin(msg.sender);
        if (gate == address(0)) revert ZeroGate();
        if (authorizedGate != address(0)) revert GateAlreadyConfigured();
        authorizedGate = gate;
        emit AuthorizedGateConfigured(gate);
    }

    function setExpectedWorkflow(bytes32 workflowId, address workflowOwner) external {
        if (msg.sender != gateAdmin) revert UnauthorizedGateAdmin(msg.sender);
        if (workflowId == bytes32(0)) revert ZeroWorkflowId();
        if (workflowOwner == address(0)) revert ZeroWorkflowOwner();
        if (workflowAuthorizationConfigured) revert WorkflowAuthorizationAlreadyConfigured();
        expectedWorkflowId = workflowId;
        expectedWorkflowOwner = workflowOwner;
        workflowAuthorizationConfigured = true;
        emit ExpectedWorkflowConfigured(workflowId, workflowOwner);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert UnauthorizedForwarder(msg.sender);
        (bytes32 workflowId, address workflowOwner) = _decodeMetadata(metadata);
        if (!workflowAuthorizationConfigured) revert WorkflowAuthorizationNotConfigured();
        if (workflowId != expectedWorkflowId || workflowOwner != expectedWorkflowOwner) {
            revert UnauthorizedWorkflow(workflowId, workflowOwner);
        }
        RiskVerdict memory verdict = _decodeVerdict(report);
        _validateVerdict(verdict);

        bytes32 key = verdictKey(
            verdict.account, verdict.chainId, verdict.agent, verdict.nonce, verdict.callsHash, verdict.policyHash
        );
        if (verdicts[key].received) revert VerdictReplay(key);

        verdicts[key] = StoredVerdict({
            decision: verdict.decision,
            validUntil: verdict.validUntil,
            evidenceUsable: verdict.evidenceUsable,
            thresholdReached: verdict.thresholdReached,
            evidenceHash: verdict.evidenceHash,
            receivedAt: block.timestamp,
            received: true,
            consumed: false
        });
        emit RiskVerdictAccepted(
            key,
            verdict.account,
            verdict.agent,
            verdict.nonce,
            verdict.decision,
            verdict.evidenceHash,
            verdict.validUntil
        );
    }

    function consumeVerdict(
        address account,
        uint256 chainId,
        address agent,
        uint256 nonce,
        bytes32 callsHash,
        bytes32 policyHash
    ) external returns (bytes32 key, bytes32 evidenceHash) {
        if (msg.sender != authorizedGate) revert UnauthorizedGate(msg.sender);
        key = verdictKey(account, chainId, agent, nonce, callsHash, policyHash);
        StoredVerdict storage stored = verdicts[key];
        if (!stored.received) revert VerdictMissing(key);
        if (stored.consumed) revert VerdictAlreadyConsumed(key);
        if (block.timestamp > stored.validUntil) revert VerdictExpired(key);
        if (stored.decision != DECISION_ALLOW || !stored.evidenceUsable || stored.thresholdReached) {
            revert VerdictNotAllow(key);
        }
        stored.consumed = true;
        evidenceHash = stored.evidenceHash;
        emit RiskVerdictConsumed(key, evidenceHash);
    }

    function verdictKey(
        address account,
        uint256 chainId,
        address agent,
        uint256 nonce,
        bytes32 callsHash,
        bytes32 policyHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(account, chainId, agent, nonce, callsHash, policyHash));
    }

    function isVerdictUsable(bytes32 key) external view returns (bool) {
        StoredVerdict storage stored = verdicts[key];
        return stored.received && stored.evidenceUsable && block.timestamp <= stored.validUntil;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _decodeMetadata(bytes calldata metadata)
        internal
        pure
        returns (bytes32 workflowId, address workflowOwner)
    {
        if (metadata.length != 64) {
            revert InvalidMetadataLength(metadata.length);
        }
        assembly ("memory-safe") {
            workflowId := calldataload(metadata.offset)
            workflowOwner := shr(96, calldataload(add(metadata.offset, 42)))
        }
    }

    function _decodeVerdict(bytes calldata report) internal pure returns (RiskVerdict memory verdict) {
        (
            verdict.version,
            verdict.decision,
            verdict.ruleId,
            verdict.account,
            verdict.chainId,
            verdict.agent,
            verdict.nonce,
            verdict.callsHash,
            verdict.policyHash,
            verdict.recentViolationCount,
            verdict.graphIndexedBlock,
            verdict.windowStart,
            verdict.issuedAt,
            verdict.validUntil,
            verdict.evidenceUsable,
            verdict.thresholdReached,
            verdict.evidenceHash
        ) =
            abi.decode(
                report,
                (
                    uint8,
                    uint8,
                    string,
                    address,
                    uint256,
                    address,
                    uint256,
                    bytes32,
                    bytes32,
                    uint8,
                    uint256,
                    uint256,
                    uint256,
                    uint256,
                    bool,
                    bool,
                    bytes32
                )
            );
    }

    function _validateVerdict(RiskVerdict memory verdict) internal view {
        if (verdict.version != VERDICT_VERSION) revert InvalidVersion(verdict.version);
        if (verdict.decision > DECISION_BLOCK) revert InvalidDecision(verdict.decision);
        if (keccak256(bytes(verdict.ruleId)) != RULE_ID_HASH) revert InvalidRuleId();
        if (verdict.chainId != block.chainid) revert InvalidChainId(verdict.chainId);
        if (verdict.account == address(0)) revert ZeroAccount();
        if (verdict.agent == address(0)) revert ZeroAgent();
        if (verdict.callsHash == bytes32(0)) revert ZeroCallsHash();
        if (verdict.policyHash == bytes32(0)) revert ZeroPolicyHash();
        if (verdict.validUntil <= verdict.issuedAt) revert InvalidValidityWindow();
        if (block.timestamp < verdict.issuedAt) revert FutureVerdict(verdict.issuedAt);
        if (block.timestamp > verdict.validUntil) revert ExpiredVerdict(verdict.validUntil);

        if (verdict.decision == DECISION_ALLOW) {
            if (!verdict.evidenceUsable || verdict.recentViolationCount != 0 || verdict.thresholdReached) {
                revert InconsistentDecisionEvidence();
            }
        } else if (verdict.decision == DECISION_ESCALATE) {
            if (
                !verdict.evidenceUsable || verdict.recentViolationCount == 0 || verdict.recentViolationCount >= 3
                    || verdict.thresholdReached
            ) revert InconsistentDecisionEvidence();
        } else if (verdict.evidenceUsable) {
            if (verdict.recentViolationCount < 3 || !verdict.thresholdReached) {
                revert InconsistentDecisionEvidence();
            }
        } else if (verdict.thresholdReached) {
            revert InconsistentDecisionEvidence();
        }

        bytes32 expectedEvidenceHash = keccak256(
            abi.encode(
                verdict.version,
                RULE_ID,
                SIGNAL,
                verdict.account,
                verdict.chainId,
                verdict.agent,
                verdict.nonce,
                verdict.callsHash,
                verdict.policyHash,
                verdict.decision,
                verdict.recentViolationCount,
                verdict.graphIndexedBlock,
                verdict.windowStart,
                verdict.issuedAt,
                verdict.validUntil,
                verdict.evidenceUsable,
                verdict.thresholdReached
            )
        );
        if (verdict.evidenceHash != expectedEvidenceHash) revert InvalidEvidenceHash();
    }
}
