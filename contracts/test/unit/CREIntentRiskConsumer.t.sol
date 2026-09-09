// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CREIntentRiskConsumer} from "../../src/cre/CREIntentRiskConsumer.sol";

contract CREIntentRiskConsumerTest is Test {
    CREIntentRiskConsumer internal consumer;
    address internal constant FORWARDER = address(0xF0);
    address internal constant ACCOUNT = 0x4423D32fE243D06D7F025Ef4855BC24185704168;
    address internal constant AGENT = 0xEDa2435282D178a5A9c8c001793b1857Fef84E28;
    bytes32 internal constant CALLS_HASH = bytes32(uint256(0x1111));
    bytes32 internal constant POLICY_HASH = bytes32(uint256(0x2222));

    function setUp() public {
        vm.chainId(84_532);
        vm.warp(2_000_000_000);
        consumer = new CREIntentRiskConsumer(FORWARDER);
    }

    function testValidAllowAccepted() public {
        _submit(_verdict(0, 0, true, false));
    }

    function testValidEscalateOneAccepted() public {
        _submit(_verdict(1, 1, true, false));
    }

    function testValidEscalateTwoAccepted() public {
        _submit(_verdict(1, 2, true, false));
    }

    function testValidGenuineBlockAccepted() public {
        _submit(_verdict(2, 3, true, true));
    }

    function testValidFailClosedBlockAccepted() public {
        _submit(_verdict(2, 0, false, false));
    }

    function testWrongCallerRejected() public {
        vm.expectPartialRevert(CREIntentRiskConsumer.UnauthorizedForwarder.selector);
        consumer.onReport("", _encode(_verdict(0, 0, true, false)));
    }

    function testZeroForwarderRejected() public {
        vm.expectRevert(CREIntentRiskConsumer.ZeroForwarder.selector);
        new CREIntentRiskConsumer(address(0));
    }

    function testWrongVersionRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.version = 2;
        _expectInvalid(CREIntentRiskConsumer.InvalidVersion.selector, verdict);
    }

    function testWrongChainIdRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.chainId = 1;
        _expectInvalid(CREIntentRiskConsumer.InvalidChainId.selector, verdict);
    }

    function testWrongRuleIdRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.ruleId = "wrong";
        _expectInvalid(CREIntentRiskConsumer.InvalidRuleId.selector, verdict);
    }

    function testZeroAccountRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.account = address(0);
        _expectInvalid(CREIntentRiskConsumer.ZeroAccount.selector, verdict);
    }

    function testZeroAgentRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.agent = address(0);
        _expectInvalid(CREIntentRiskConsumer.ZeroAgent.selector, verdict);
    }

    function testZeroCallsHashRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.callsHash = bytes32(0);
        _expectInvalid(CREIntentRiskConsumer.ZeroCallsHash.selector, verdict);
    }

    function testZeroPolicyHashRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.policyHash = bytes32(0);
        _expectInvalid(CREIntentRiskConsumer.ZeroPolicyHash.selector, verdict);
    }

    function testInvalidValidityWindowRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.validUntil = verdict.issuedAt;
        _expectInvalid(CREIntentRiskConsumer.InvalidValidityWindow.selector, verdict);
    }

    function testExpiredVerdictRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.issuedAt = block.timestamp - 10;
        verdict.validUntil = block.timestamp - 1;
        verdict.evidenceHash = _evidenceHash(verdict);
        _expectInvalid(CREIntentRiskConsumer.ExpiredVerdict.selector, verdict);
    }

    function testFutureVerdictRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.issuedAt = block.timestamp + 1;
        verdict.validUntil = block.timestamp + 301;
        verdict.evidenceHash = _evidenceHash(verdict);
        _expectInvalid(CREIntentRiskConsumer.FutureVerdict.selector, verdict);
    }

    function testDecisionOverflowRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.decision = 3;
        _expectInvalid(CREIntentRiskConsumer.InvalidDecision.selector, verdict);
    }

    function testAllowWithUnusableEvidenceRejected() public {
        _expectInconsistent(_verdict(0, 0, false, false));
    }

    function testAllowWithNonzeroCountRejected() public {
        _expectInconsistent(_verdict(0, 1, true, false));
    }

    function testEscalateWithZeroRejected() public {
        _expectInconsistent(_verdict(1, 0, true, false));
    }

    function testEscalateWithThreeRejected() public {
        _expectInconsistent(_verdict(1, 3, true, false));
    }

    function testUsableBlockWithoutThresholdRejected() public {
        _expectInconsistent(_verdict(2, 3, true, false));
    }

    function testUsableBlockBelowThresholdRejected() public {
        _expectInconsistent(_verdict(2, 2, true, true));
    }

    function testOperationalBlockWithThresholdRejected() public {
        _expectInconsistent(_verdict(2, 0, false, true));
    }

    function testEvidenceHashMismatchRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.evidenceHash = bytes32(uint256(verdict.evidenceHash) ^ 1);
        _expectInvalid(CREIntentRiskConsumer.InvalidEvidenceHash.selector, verdict);
    }

    function testExactDuplicateReplayRejected() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        _submit(verdict);
        vm.prank(FORWARDER);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictReplay.selector);
        consumer.onReport("", _encode(verdict));
    }

    function testChangingNonceChangesKey() public view {
        assertNotEq(_key(ACCOUNT, AGENT, 7, CALLS_HASH, POLICY_HASH), _key(ACCOUNT, AGENT, 8, CALLS_HASH, POLICY_HASH));
    }

    function testChangingCallsHashChangesKey() public view {
        assertNotEq(
            _key(ACCOUNT, AGENT, 7, CALLS_HASH, POLICY_HASH), _key(ACCOUNT, AGENT, 7, bytes32(uint256(3)), POLICY_HASH)
        );
    }

    function testChangingPolicyHashChangesKey() public view {
        assertNotEq(
            _key(ACCOUNT, AGENT, 7, CALLS_HASH, POLICY_HASH), _key(ACCOUNT, AGENT, 7, CALLS_HASH, bytes32(uint256(3)))
        );
    }

    function testChangingAccountChangesKey() public view {
        assertNotEq(
            _key(ACCOUNT, AGENT, 7, CALLS_HASH, POLICY_HASH), _key(address(1), AGENT, 7, CALLS_HASH, POLICY_HASH)
        );
    }

    function testChangingAgentChangesKey() public view {
        assertNotEq(
            _key(ACCOUNT, AGENT, 7, CALLS_HASH, POLICY_HASH), _key(ACCOUNT, address(2), 7, CALLS_HASH, POLICY_HASH)
        );
    }

    function testTypeScriptSolidityAbiVector() public {
        bytes memory payload =
            hex"0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002200000000000000000000000004423d32fe243d06d7f025ef4855bc241857041680000000000000000000000000000000000000000000000000000000000014a34000000000000000000000000eda2435282d178a5a9c8c001793b1857fef84e2800000000000000000000000000000000000000000000000000000000000000071111111111111111111111111111111111111111111111111111111111111111222222222222222222222222222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002c6a0e500000000000000000000000000000000000000000000000000000000773442800000000000000000000000000000000000000000000000000000000077359400000000000000000000000000000000000000000000000000000000007735952c000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000007b0e03f362114d38006adca7fa449448ffcd363b1d15502877e293c971e21e2e0000000000000000000000000000000000000000000000000000000000000022696e74656e746c6f636b2d6167656e742d76696f6c6174696f6e732d3234682d7631000000000000000000000000000000000000000000000000000000000000";
        vm.prank(FORWARDER);
        consumer.onReport("", payload);
        bytes32 vectorCallsHash = 0x1111111111111111111111111111111111111111111111111111111111111111;
        bytes32 vectorPolicyHash = 0x2222222222222222222222222222222222222222222222222222222222222222;
        bytes32 key = _key(ACCOUNT, AGENT, 7, vectorCallsHash, vectorPolicyHash);
        (uint8 decision,,,, bytes32 evidenceHash,, bool received,) = consumer.verdicts(key);
        assertEq(decision, 0);
        assertEq(evidenceHash, 0x7b0e03f362114d38006adca7fa449448ffcd363b1d15502877e293c971e21e2e);
        assertTrue(received);
    }

    function testFuzzBindingChangesKey(uint256 nonce, bytes32 callsHash, bytes32 policyHash) public view {
        vm.assume(nonce != 7 || callsHash != CALLS_HASH || policyHash != POLICY_HASH);
        assertNotEq(
            _key(ACCOUNT, AGENT, 7, CALLS_HASH, POLICY_HASH), _key(ACCOUNT, AGENT, nonce, callsHash, policyHash)
        );
    }

    function testFuzzValidExpiryAccepted(uint32 age, uint32 duration) public {
        age = uint32(bound(age, 0, 30 days));
        duration = uint32(bound(duration, uint256(age) + 1, type(uint32).max));
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        verdict.issuedAt = block.timestamp - age;
        verdict.validUntil = verdict.issuedAt + duration;
        verdict.evidenceHash = _evidenceHash(verdict);
        _submit(verdict);
    }

    function testFuzzInvalidDecisionEvidence(uint8 count) public {
        count = uint8(bound(count, 1, type(uint8).max));
        _expectInconsistent(_verdict(0, count, true, false));
    }

    function testOnlyGateAdminCanConfigureGate() public {
        vm.prank(address(0xBAD));
        vm.expectPartialRevert(CREIntentRiskConsumer.UnauthorizedGateAdmin.selector);
        consumer.setAuthorizedGate(address(this));
    }

    function testZeroGateRejected() public {
        vm.expectRevert(CREIntentRiskConsumer.ZeroGate.selector);
        consumer.setAuthorizedGate(address(0));
    }

    function testGateCanOnlyBeConfiguredOnce() public {
        consumer.setAuthorizedGate(address(this));
        vm.expectRevert(CREIntentRiskConsumer.GateAlreadyConfigured.selector);
        consumer.setAuthorizedGate(address(1));
    }

    function testAuthorizedGateConsumesAllowExactlyOnce() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        _submit(verdict);
        consumer.setAuthorizedGate(address(this));
        (bytes32 key, bytes32 evidenceHash) = _consume(verdict);
        assertEq(evidenceHash, verdict.evidenceHash);
        (,,,,,,, bool consumed) = consumer.verdicts(key);
        assertTrue(consumed);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictAlreadyConsumed.selector);
        _consume(verdict);
    }

    function testUnauthorizedGateCannotConsume() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        _submit(verdict);
        consumer.setAuthorizedGate(address(0xBEEF));
        vm.expectPartialRevert(CREIntentRiskConsumer.UnauthorizedGate.selector);
        _consume(verdict);
    }

    function testMissingVerdictCannotBeConsumed() public {
        consumer.setAuthorizedGate(address(this));
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictMissing.selector);
        _consume(_verdict(0, 0, true, false));
    }

    function testExpiredAcceptedVerdictCannotBeConsumed() public {
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(0, 0, true, false);
        _submit(verdict);
        consumer.setAuthorizedGate(address(this));
        vm.warp(verdict.validUntil + 1);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictExpired.selector);
        _consume(verdict);
    }

    function testEscalateCannotBeConsumed() public {
        _assertDecisionCannotBeConsumed(_verdict(1, 1, true, false));
    }

    function testGenuineBlockCannotBeConsumed() public {
        _assertDecisionCannotBeConsumed(_verdict(2, 3, true, true));
    }

    function testOperationalBlockCannotBeConsumed() public {
        _assertDecisionCannotBeConsumed(_verdict(2, 0, false, false));
    }

    function _verdict(uint8 decision, uint8 count, bool usable, bool threshold)
        internal
        view
        returns (CREIntentRiskConsumer.RiskVerdict memory verdict)
    {
        verdict = CREIntentRiskConsumer.RiskVerdict({
            version: 1,
            decision: decision,
            ruleId: "intentlock-agent-violations-24h-v1",
            account: ACCOUNT,
            chainId: block.chainid,
            agent: AGENT,
            nonce: 7,
            callsHash: CALLS_HASH,
            policyHash: POLICY_HASH,
            recentViolationCount: count,
            graphIndexedBlock: 46_571_749,
            windowStart: block.timestamp - 1 days,
            issuedAt: block.timestamp - 1,
            validUntil: block.timestamp + 299,
            evidenceUsable: usable,
            thresholdReached: threshold,
            evidenceHash: bytes32(0)
        });
        verdict.evidenceHash = _evidenceHash(verdict);
    }

    function _evidenceHash(CREIntentRiskConsumer.RiskVerdict memory verdict) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                verdict.version,
                "intentlock-agent-violations-24h-v1",
                "recent indexed IntentLock policy violations",
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
    }

    function _encode(CREIntentRiskConsumer.RiskVerdict memory verdict) internal pure returns (bytes memory) {
        return abi.encode(
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
        );
    }

    function _submit(CREIntentRiskConsumer.RiskVerdict memory verdict) internal {
        vm.prank(FORWARDER);
        consumer.onReport("", _encode(verdict));
    }

    function _expectInvalid(bytes4 selector, CREIntentRiskConsumer.RiskVerdict memory verdict) internal {
        vm.prank(FORWARDER);
        vm.expectPartialRevert(selector);
        consumer.onReport("", _encode(verdict));
    }

    function _expectInconsistent(CREIntentRiskConsumer.RiskVerdict memory verdict) internal {
        _expectInvalid(CREIntentRiskConsumer.InconsistentDecisionEvidence.selector, verdict);
    }

    function _consume(CREIntentRiskConsumer.RiskVerdict memory verdict)
        internal
        returns (bytes32 key, bytes32 evidenceHash)
    {
        return consumer.consumeVerdict(
            verdict.account, verdict.chainId, verdict.agent, verdict.nonce, verdict.callsHash, verdict.policyHash
        );
    }

    function _assertDecisionCannotBeConsumed(CREIntentRiskConsumer.RiskVerdict memory verdict) internal {
        _submit(verdict);
        consumer.setAuthorizedGate(address(this));
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictNotAllow.selector);
        _consume(verdict);
    }

    function _key(address account, address agent, uint256 nonce, bytes32 callsHash, bytes32 policyHash)
        internal
        view
        returns (bytes32)
    {
        return consumer.verdictKey(account, block.chainid, agent, nonce, callsHash, policyHash);
    }
}
