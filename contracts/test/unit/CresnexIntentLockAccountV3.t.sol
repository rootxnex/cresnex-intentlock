// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {CresnexIntentLockAccountV3} from "../../src/CresnexIntentLockAccountV3.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {CREIntentRiskConsumer} from "../../src/cre/CREIntentRiskConsumer.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

contract CresnexIntentLockAccountV3Test is Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    address internal constant FORWARDER = address(0xF0);
    address internal constant AGENT = address(0xB0B);
    address internal constant RECIPIENT = address(0xCAFE);
    bytes32 internal constant WORKFLOW_ID = keccak256("intentlock-risk-workflow");
    address internal constant WORKFLOW_OWNER = address(0xC0FFEE);
    bytes10 internal constant WORKFLOW_NAME = "intentlock";

    address internal owner;
    CREIntentRiskConsumer internal consumer;
    CresnexIntentLockAccountV3 internal account;
    MockERC20 internal token;

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(OWNER_KEY);
        consumer = new CREIntentRiskConsumer(FORWARDER);
        consumer.setExpectedWorkflow(WORKFLOW_ID, WORKFLOW_OWNER);
        account = new CresnexIntentLockAccountV3(owner, consumer);
        consumer.setAuthorizedGate(address(account));
        vm.prank(owner);
        account.registerAgent(AGENT);
        vm.deal(address(account), 10 ether);
        token = new MockERC20("Mock", "MOCK", 18);
    }

    function testMatchingAllowAndValidIntentSucceeds() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        (bool success,) = _executeAllowed(calls, policy, 1);
        assertTrue(success);
        assertEq(RECIPIENT.balance, 0.1 ether);
    }

    function testNoVerdictRejectsWithoutSecuritySideEffects() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 2);
        bytes memory signature = _sign(manifest);
        vm.recordLogs();
        vm.prank(AGENT);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictMissing.selector);
        account.executeIntent(manifest, calls, policy, signature);
        assertEq(vm.getRecordedLogs().length, 0);
        _assertCreRejected(2);
    }

    function testEscalateRejects() public {
        _assertRiskDecisionRejected(1, 1, true, false, 3);
    }

    function testGenuineBlockRejects() public {
        _assertRiskDecisionRejected(2, 3, true, true, 4);
    }

    function testOperationalBlockRejects() public {
        _assertRiskDecisionRejected(2, 0, false, false, 5);
    }

    function testExpiredAllowRejects() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 6);
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(manifest, 0, 0, true, false);
        _accept(verdict);
        vm.warp(verdict.validUntil + 1);
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictExpired.selector);
        account.executeIntent(manifest, calls, policy, signature);
        _assertCreRejected(6);
    }

    function testWrongAccountManifestRejectedBeforeGate() public {
        _assertBadManifest(CresnexIntentLockAccountV2.WrongAccount.selector, 7, 0);
    }

    function testWrongAgentManifestRejectedBeforeGate() public {
        _assertBadManifest(CresnexIntentLockAccountV2.UnauthorizedAgent.selector, 8, 1);
    }

    function testWrongChainManifestRejectedBeforeGate() public {
        _assertBadManifest(CresnexIntentLockAccountV2.WrongChain.selector, 9, 2);
    }

    function testWrongNonceVerdictRejected() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 10);
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(manifest, 0, 0, true, false);
        verdict.nonce++;
        verdict.evidenceHash = _evidenceHash(verdict);
        _accept(verdict);
        _expectMissing(manifest, calls, policy);
        _assertCreRejected(10);
    }

    function testDifferentCallPackageCannotUseVerdict() public {
        (IntentTypesV2.ExecutionCall[] memory original, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory originalManifest = _manifest(original, policy, 11);
        _accept(_verdict(originalManifest, 0, 0, true, false));
        (IntentTypesV2.ExecutionCall[] memory changed,) = _nativePackage(0.2 ether, 1 ether);
        IntentTypesV2.IntentManifest memory changedManifest = _manifest(changed, policy, 11);
        _expectMissing(changedManifest, changed, policy);
        _assertCreRejected(11);
    }

    function testDifferentPolicyCannotUseVerdict() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory original) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory originalManifest = _manifest(calls, original, 12);
        _accept(_verdict(originalManifest, 0, 0, true, false));
        (, IntentTypesV2.Policy memory changed) = _nativePackage(0.1 ether, 2 ether);
        IntentTypesV2.IntentManifest memory changedManifest = _manifest(calls, changed, 12);
        _expectMissing(changedManifest, calls, changed);
        _assertCreRejected(12);
    }

    function testDifferentNonceCannotUseVerdict() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory first = _manifest(calls, policy, 13);
        _accept(_verdict(first, 0, 0, true, false));
        IntentTypesV2.IntentManifest memory changed = _manifest(calls, policy, 14);
        _expectMissing(changed, calls, policy);
        _assertCreRejected(14);
    }

    function testInvalidOwnerSignatureRejectedBeforeVerdictConsumption() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 15);
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(manifest, 0, 0, true, false);
        _accept(verdict);
        bytes32 digest = account.hashIntent(manifest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADD, digest);
        bytes memory wrongOwnerSignature = abi.encodePacked(r, s, v);
        vm.prank(AGENT);
        vm.expectRevert(CresnexIntentLockAccountV2.InvalidOwnerSignature.selector);
        account.executeIntent(manifest, calls, policy, wrongOwnerSignature);
        assertFalse(_consumed(verdict));
    }

    function testPolicyViolationAfterAllowPreservesV2Semantics() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.2 ether, 0.1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 16);
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(manifest, 0, 0, true, false);
        _accept(verdict);
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        (bool success, bytes32 evidence) = account.executeIntent(manifest, calls, policy, signature);
        assertFalse(success);
        assertNotEq(evidence, bytes32(0));
        assertTrue(account.usedNonces(16));
        assertTrue(_consumed(verdict));
        (, bool quarantined, uint64 strikes) = account.agents(AGENT);
        assertFalse(quarantined);
        assertEq(strikes, 1);
    }

    function testOrdinaryExecutionFailurePreservesV2Semantics() public {
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = IntentTypesV2.ExecutionCall({
            target: address(token),
            value: 0,
            data: abi.encodeCall(IERC20.transfer, (RECIPIENT, 1)),
            operation: IntentTypesV2.Operation.Call
        });
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.assets = new IntentTypesV2.AssetConstraint[](1);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(token), 1, RECIPIENT, 0, 0);
        policy.moduleData = abi.encode(address(token), RECIPIENT, 1, false, address(token), IERC20.transfer.selector);
        (bool success, bytes32 evidence) = _executeAllowed(calls, policy, 17);
        assertFalse(success);
        assertNotEq(evidence, bytes32(0));
        (,, uint64 strikes) = account.agents(AGENT);
        assertEq(strikes, 0);
    }

    function testOutcomeChecksRemainEnforcedAfterAllow() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.5 ether, 0.5 ether);
        policy.nativeConstraint.minFinalBalance = 9.75 ether;
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 18);
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(manifest, 0, 0, true, false);
        _accept(verdict);
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        (bool success,) = account.executeIntent(manifest, calls, policy, signature);
        assertFalse(success);
        assertEq(RECIPIENT.balance, 0);
        (,, uint64 strikes) = account.agents(AGENT);
        assertEq(strikes, 1);
    }

    function testSuccessConsumesVerdictAndIntentNonce() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 19);
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(manifest, 0, 0, true, false);
        _accept(verdict);
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        account.executeIntent(manifest, calls, policy, signature);
        assertTrue(account.usedNonces(19));
        assertTrue(_consumed(verdict));
    }

    function testDownstreamRevertRollsBackVerdictConsumptionThenRetrySucceeds() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 20);
        CREIntentRiskConsumer.RiskVerdict memory verdict = _verdict(manifest, 0, 0, true, false);
        _accept(verdict);
        vm.prank(owner);
        account.pause();
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        vm.expectRevert();
        account.executeIntent(manifest, calls, policy, signature);
        assertFalse(_consumed(verdict));
        assertFalse(account.usedNonces(20));
        vm.prank(owner);
        account.unpause();
        vm.prank(AGENT);
        (bool success,) = account.executeIntent(manifest, calls, policy, signature);
        assertTrue(success);
        assertTrue(_consumed(verdict));
    }

    function testVerdictReplayRejected() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 21);
        _accept(_verdict(manifest, 0, 0, true, false));
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        account.executeIntent(manifest, calls, policy, signature);
        vm.prank(AGENT);
        vm.expectRevert(CresnexIntentLockAccountV2.NonceAlreadyUsed.selector);
        account.executeIntent(manifest, calls, policy, signature);
    }

    function testExecuteIsolatedCannotBypassGate() public {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        vm.expectRevert(CresnexIntentLockAccountV2.OnlySelf.selector);
        account.executeIsolated(calls, policy);
    }

    function testFuzzBindingMutationCannotUseVerdict(uint256 changedNonce) public {
        changedNonce = bound(changedNonce, 101, type(uint128).max);
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) = _nativePackage(1, 1 ether);
        IntentTypesV2.IntentManifest memory original = _manifest(calls, policy, 100);
        _accept(_verdict(original, 0, 0, true, false));
        IntentTypesV2.IntentManifest memory changed = _manifest(calls, policy, changedNonce);
        _expectMissing(changed, calls, policy);
        assertFalse(account.usedNonces(changedNonce));
    }

    function testFuzzNonAllowNeverExecutes(uint8 decisionSeed) public {
        uint8 decision = uint8(bound(decisionSeed, 1, 2));
        uint8 count = decision == 1 ? 1 : 3;
        bool threshold = decision == 2;
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) = _nativePackage(1, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 200 + uint256(decisionSeed));
        _accept(_verdict(manifest, decision, count, true, threshold));
        uint256 beforeBalance = RECIPIENT.balance;
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictNotAllow.selector);
        account.executeIntent(manifest, calls, policy, signature);
        assertEq(RECIPIENT.balance, beforeBalance);
        assertFalse(account.usedNonces(manifest.nonce));
    }

    function _assertRiskDecisionRejected(uint8 decision, uint8 count, bool usable, bool threshold, uint256 nonce)
        internal
    {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nonce);
        _accept(_verdict(manifest, decision, count, usable, threshold));
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictNotAllow.selector);
        account.executeIntent(manifest, calls, policy, signature);
        _assertCreRejected(nonce);
    }

    function _assertBadManifest(bytes4 selector, uint256 nonce, uint8 mutation) internal {
        (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy) =
            _nativePackage(0.1 ether, 1 ether);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nonce);
        if (mutation == 0) manifest.account = address(1);
        else if (mutation == 1) manifest.agent = address(1);
        else manifest.chainId++;
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        vm.expectPartialRevert(selector);
        account.executeIntent(manifest, calls, policy, signature);
        _assertCreRejected(nonce);
    }

    function _assertCreRejected(uint256 nonce) internal view {
        assertFalse(account.usedNonces(nonce));
        (bool registered, bool quarantined, uint64 strikes) = account.agents(AGENT);
        assertTrue(registered);
        assertFalse(quarantined);
        assertEq(strikes, 0);
        assertEq(RECIPIENT.balance, 0);
    }

    function _executeAllowed(
        IntentTypesV2.ExecutionCall[] memory calls,
        IntentTypesV2.Policy memory policy,
        uint256 nonce
    ) internal returns (bool success, bytes32 evidence) {
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nonce);
        _accept(_verdict(manifest, 0, 0, true, false));
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        return account.executeIntent(manifest, calls, policy, signature);
    }

    function _expectMissing(
        IntentTypesV2.IntentManifest memory manifest,
        IntentTypesV2.ExecutionCall[] memory calls,
        IntentTypesV2.Policy memory policy
    ) internal {
        bytes memory signature = _sign(manifest);
        vm.prank(AGENT);
        vm.expectPartialRevert(CREIntentRiskConsumer.VerdictMissing.selector);
        account.executeIntent(manifest, calls, policy, signature);
    }

    function _nativePackage(uint256 amount, uint256 maximum)
        internal
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy)
    {
        calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = IntentTypesV2.ExecutionCall({
            target: RECIPIENT, value: amount, data: "", operation: IntentTypesV2.Operation.Call
        });
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.nativeConstraint = IntentTypesV2.NativeConstraint(maximum, 0);
        policy.moduleData = abi.encode(address(0), RECIPIENT, maximum, true, RECIPIENT, bytes4(0));
    }

    function _manifest(IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy, uint256 nonce)
        internal
        view
        returns (IntentTypesV2.IntentManifest memory manifest)
    {
        manifest = IntentTypesV2.IntentManifest({
            version: 2,
            account: address(account),
            owner: owner,
            agent: AGENT,
            chainId: block.chainid,
            callsHash: account.hashCalls(calls),
            policyHash: account.hashPolicy(policy),
            nonce: nonce,
            validAfter: uint48(block.timestamp - 1),
            validUntil: uint48(block.timestamp + 1 days),
            allowBatch: false,
            evidenceMode: 1
        });
    }

    function _sign(IntentTypesV2.IntentManifest memory manifest) internal view returns (bytes memory) {
        bytes32 digest = account.hashIntent(manifest);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _verdict(
        IntentTypesV2.IntentManifest memory manifest,
        uint8 decision,
        uint8 count,
        bool usable,
        bool threshold
    ) internal view returns (CREIntentRiskConsumer.RiskVerdict memory verdict) {
        verdict = CREIntentRiskConsumer.RiskVerdict({
            version: 1,
            decision: decision,
            ruleId: "intentlock-agent-violations-24h-v1",
            account: address(account),
            chainId: block.chainid,
            agent: manifest.agent,
            nonce: manifest.nonce,
            callsHash: manifest.callsHash,
            policyHash: manifest.policyHash,
            recentViolationCount: count,
            graphIndexedBlock: 1,
            windowStart: block.timestamp - 1 days,
            issuedAt: block.timestamp - 1,
            validUntil: block.timestamp + 300,
            evidenceUsable: usable,
            thresholdReached: threshold,
            evidenceHash: bytes32(0)
        });
        verdict.evidenceHash = _evidenceHash(verdict);
    }

    function _accept(CREIntentRiskConsumer.RiskVerdict memory verdict) internal {
        vm.prank(FORWARDER);
        consumer.onReport(
            abi.encodePacked(WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_OWNER, bytes2(0x0001)), _encode(verdict)
        );
    }

    function _consumed(CREIntentRiskConsumer.RiskVerdict memory verdict) internal view returns (bool consumed) {
        bytes32 key = consumer.verdictKey(
            verdict.account, verdict.chainId, verdict.agent, verdict.nonce, verdict.callsHash, verdict.policyHash
        );
        (,,,,,,, consumed) = consumer.verdicts(key);
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
}
