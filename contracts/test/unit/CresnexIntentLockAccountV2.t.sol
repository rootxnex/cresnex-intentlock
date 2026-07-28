// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockDexRouter} from "../../src/mocks/MockDexRouter.sol";

contract CresnexIntentLockAccountV2Test is Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    address internal owner;
    address internal agent = address(0xB0B);
    address internal recipient = address(0xCAFE);
    address internal thief = address(0xBAD);
    CresnexIntentLockAccountV2 internal account;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockDexRouter internal router;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        owner = vm.addr(OWNER_KEY);
        account = new CresnexIntentLockAccountV2(owner);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        weth = new MockERC20("Mock WETH", "mWETH", 18);
        router = new MockDexRouter();
        usdc.mint(address(account), 1_000_000e6);
        vm.prank(owner);
        account.registerAgent(agent);
    }

    function testTransferPolicyAllowsBoundedTransfer() public {
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 100e6)));
        (bool ok,) = _execute(calls, _transferPolicy(address(usdc), recipient, 100e6), 1);
        assertTrue(ok);
        assertEq(usdc.balanceOf(recipient), 100e6);
    }

    function testTransferBlocksExcessWrongRecipientDifferentTokenAndHiddenBatch() public {
        IntentTypesV2.Policy memory policy = _transferPolicy(address(usdc), recipient, 100e6);
        _assertViolation(_one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 100e6 + 1))), policy, 2);
        _assertViolation(_one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (thief, 1))), policy, 3);
        _assertViolation(_one(address(weth), 0, abi.encodeCall(IERC20.transfer, (recipient, 1))), policy, 4);

        IntentTypesV2.ExecutionCall[] memory hidden = new IntentTypesV2.ExecutionCall[](2);
        hidden[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 100e6)));
        hidden[1] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (thief, 1)));
        _assertViolation(hidden, policy, 5);
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(usdc.balanceOf(thief), 0);
    }

    function testNativeTransferEnforcesSpendAndFinalBalance() public {
        vm.deal(address(account), 2 ether);
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.nativeConstraint = IntentTypesV2.NativeConstraint(0.5 ether, 1.5 ether);
        policy.moduleData = abi.encode(address(0), recipient, 0.5 ether, true, recipient, bytes4(0));
        (bool ok,) = _execute(_one(recipient, 0.5 ether, ""), policy, 6);
        assertTrue(ok);
        assertEq(address(account).balance, 1.5 ether);
        _assertViolation(_one(recipient, 0.6 ether, ""), policy, 7);
        assertEq(address(account).balance, 1.5 ether);
    }

    function testSwapUsesMeasuredDeltasAndAllowanceCap() public {
        IntentTypesV2.ExecutionCall[] memory calls =
            _swapCalls(100e6, 2 ether, recipient, MockDexRouter.Behavior.Valid, 100e6);
        (bool ok,) = _execute(calls, _swapPolicy(100e6, 2 ether, recipient), 8);
        assertTrue(ok);
        assertEq(weth.balanceOf(recipient), 2 ether);
        assertEq(usdc.allowance(address(account), address(router)), 0);
    }

    function testSwapBlocksOverspendInsufficientOutputWrongRecipientAndUnlimitedApproval() public {
        _assertViolation(
            _swapCalls(100e6, 2 ether, recipient, MockDexRouter.Behavior.ExcessiveInput, 100e6 + 1),
            _swapPolicy(100e6, 2 ether, recipient),
            9
        );
        _assertViolation(
            _swapCalls(100e6, 2 ether, recipient, MockDexRouter.Behavior.InsufficientOutput, 100e6),
            _swapPolicy(100e6, 2 ether, recipient),
            10
        );
        _assertViolation(
            _swapCalls(100e6, 2 ether, recipient, MockDexRouter.Behavior.WrongRecipient, 100e6),
            _swapPolicy(100e6, 2 ether, recipient),
            11
        );
        IntentTypesV2.Policy memory policy =
            _approvalPolicy(address(usdc), address(router), type(uint256).max, false, 0);
        _assertViolation(
            _one(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(router), type(uint256).max))), policy, 12
        );
        assertEq(usdc.allowance(address(account), address(router)), 0);
    }

    function testApprovalAllowsBoundedValueAndBlocksWrongSpenderOrExcess() public {
        IntentTypesV2.Policy memory policy = _approvalPolicy(address(usdc), address(router), 50e6, false, 50e6);
        (bool ok,) =
            _execute(_one(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(router), 50e6))), policy, 13);
        assertTrue(ok);
        _assertViolation(_one(address(usdc), 0, abi.encodeCall(IERC20.approve, (thief, 1))), policy, 14);
        _assertViolation(
            _one(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(router), 50e6 + 1))), policy, 15
        );
    }

    function testBatchBindsOrderAndAggregateOutcome() public {
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 60e6)));
        calls[1] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 50e6)));
        IntentTypesV2.Policy memory policy = _batchPolicy(100e6, 110e6);
        _assertViolation(calls, policy, 16);
        assertEq(usdc.balanceOf(recipient), 0);

        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 17);
        bytes memory signature = _sign(manifest);
        (calls[0], calls[1]) = (calls[1], calls[0]);
        vm.prank(agent);
        vm.expectRevert(CresnexIntentLockAccountV2.CallsHashMismatch.selector);
        account.executeIntent(manifest, calls, policy, signature);
    }

    function testOrdinaryTargetFailureConsumesNonceWithoutStrike() public {
        IntentTypesV2.Policy memory policy = _transferPolicy(address(weth), recipient, 1);
        (bool ok, bytes32 evidence) =
            _execute(_one(address(weth), 0, abi.encodeCall(IERC20.transfer, (recipient, 1))), policy, 18);
        assertFalse(ok);
        assertNotEq(evidence, bytes32(0));
        assertTrue(account.usedNonces(18));
        _assertStrikes(0);
    }

    function testAuthenticationAndMalformedPolicyFailuresDoNotStrikeOrConsumeNonce() public {
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 1)));
        IntentTypesV2.Policy memory policy = _transferPolicy(address(usdc), recipient, 1);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 19);
        manifest.chainId++;
        bytes memory signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.WrongChain.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);
        assertFalse(account.usedNonces(19));

        policy.moduleData = hex"01";
        manifest = _manifest(calls, policy, 20);
        signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.InvalidPolicy.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);
        assertFalse(account.usedNonces(20));
        _assertStrikes(0);
    }

    function testUnsupportedEvidenceModeAndMisboundPolicyAreStructuralFailures() public {
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 1)));
        IntentTypesV2.Policy memory policy = _transferPolicy(address(usdc), recipient, 1);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 201);
        manifest.evidenceMode = 0;
        bytes memory signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.InvalidPolicy.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);
        assertFalse(account.usedNonces(201));

        policy.assets[0].token = address(weth);
        manifest = _manifest(calls, policy, 202);
        signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.InvalidPolicy.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);
        assertFalse(account.usedNonces(202));
        _assertStrikes(0);
    }

    function testReplayExpiryQuarantineAndOwnerControls() public {
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 1)));
        IntentTypesV2.Policy memory policy = _transferPolicy(address(usdc), recipient, 1);
        _execute(calls, policy, 21);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 21);
        bytes memory signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.NonceAlreadyUsed.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);

        manifest = _manifest(calls, policy, 22);
        manifest.validAfter = uint48(block.timestamp - 2);
        manifest.validUntil = uint48(block.timestamp - 1);
        signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.IntentExpired.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);

        vm.startPrank(owner);
        account.cancelNonce(23);
        account.emergencyRevokeAgent(agent);
        account.pause();
        vm.stopPrank();
        assertTrue(account.usedNonces(23));
        (bool registered, bool quarantined,) = account.agents(agent);
        assertFalse(registered);
        assertTrue(quarantined);
        assertTrue(account.paused());
    }

    function testRemovingAgentPreservesStrikeHistoryAndOnlySelfIsEnforced() public {
        _assertViolation(
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 2))),
            _transferPolicy(address(usdc), recipient, 1),
            24
        );
        vm.prank(owner);
        account.removeAgent(agent);
        (bool registered,, uint64 strikes) = account.agents(agent);
        assertFalse(registered);
        assertEq(strikes, 1);

        IntentTypesV2.ExecutionCall[] memory noCalls = new IntentTypesV2.ExecutionCall[](0);
        IntentTypesV2.Policy memory blank;
        vm.expectRevert(CresnexIntentLockAccountV2.OnlySelf.selector);
        account.executeIsolated(noCalls, blank);
    }

    function _transferPolicy(address token, address receiver, uint256 maximum)
        internal
        pure
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.assets = _assets(token, maximum, receiver, 0);
        policy.moduleData = abi.encode(token, receiver, maximum, false, token, IERC20.transfer.selector);
    }

    function _swapPolicy(uint256 maxInput, uint256 minOutput, address receiver)
        internal
        view
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.Swap;
        policy.assets = new IntentTypesV2.AssetConstraint[](2);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(usdc), maxInput, address(account), 0, 0);
        policy.assets[1] = IntentTypesV2.AssetConstraint(address(weth), 0, receiver, minOutput, 0);
        policy.allowances = _allowances(address(usdc), address(router), 0);
        policy.moduleData = abi.encode(address(router), address(usdc), address(weth), receiver);
    }

    function _approvalPolicy(address token, address spender, uint256 maximum, bool requireZero, uint256 cap)
        internal
        pure
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.Approval;
        policy.allowances = _allowances(token, spender, cap);
        policy.moduleData = abi.encode(token, spender, maximum, requireZero);
    }

    function _batchPolicy(uint256 maximum, uint256 minimum) internal view returns (IntentTypesV2.Policy memory policy) {
        policy.module = IntentTypesV2.PolicyModule.Batch;
        policy.assets = _assets(address(usdc), maximum, recipient, minimum);
    }

    function _assets(address token, uint256 maximum, address receiver, uint256 minimum)
        internal
        pure
        returns (IntentTypesV2.AssetConstraint[] memory assets)
    {
        assets = new IntentTypesV2.AssetConstraint[](1);
        assets[0] = IntentTypesV2.AssetConstraint(token, maximum, receiver, minimum, 0);
    }

    function _allowances(address token, address spender, uint256 maximum)
        internal
        pure
        returns (IntentTypesV2.AllowanceConstraint[] memory allowances)
    {
        allowances = new IntentTypesV2.AllowanceConstraint[](1);
        allowances[0] = IntentTypesV2.AllowanceConstraint(token, spender, maximum);
    }

    function _swapCalls(
        uint256 input,
        uint256 output,
        address receiver,
        MockDexRouter.Behavior behavior,
        uint256 approval
    ) internal view returns (IntentTypesV2.ExecutionCall[] memory calls) {
        calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(router), approval)));
        calls[1] = _call(
            address(router),
            0,
            abi.encodeCall(router.swap, (address(usdc), address(weth), input, output, receiver, behavior))
        );
    }

    function _one(address target, uint256 value, bytes memory data)
        internal
        pure
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = _call(target, value, data);
    }

    function _call(address target, uint256 value, bytes memory data)
        internal
        pure
        returns (IntentTypesV2.ExecutionCall memory)
    {
        return IntentTypesV2.ExecutionCall(target, value, data, IntentTypesV2.Operation.Call);
    }

    function _manifest(IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy, uint256 nonce)
        internal
        view
        returns (IntentTypesV2.IntentManifest memory)
    {
        return IntentTypesV2.IntentManifest(
            2,
            address(account),
            owner,
            agent,
            block.chainid,
            account.hashCalls(calls),
            account.hashPolicy(policy),
            nonce,
            uint48(block.timestamp),
            uint48(block.timestamp + 1 hours),
            calls.length > 1,
            1
        );
    }

    function _sign(IntentTypesV2.IntentManifest memory manifest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, account.hashIntent(manifest));
        return abi.encodePacked(r, s, v);
    }

    function _execute(IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy, uint256 nonce)
        internal
        returns (bool, bytes32)
    {
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nonce);
        bytes memory signature = _sign(manifest);
        vm.prank(agent);
        return account.executeIntent(manifest, calls, policy, signature);
    }

    function _assertViolation(
        IntentTypesV2.ExecutionCall[] memory calls,
        IntentTypesV2.Policy memory policy,
        uint256 nonce
    ) internal {
        uint256 balanceBefore = usdc.balanceOf(address(account));
        (,, uint64 strikesBefore) = account.agents(agent);
        (bool ok, bytes32 evidence) = _execute(calls, policy, nonce);
        assertFalse(ok);
        assertNotEq(evidence, bytes32(0));
        assertEq(usdc.balanceOf(address(account)), balanceBefore);
        (,, uint64 strikesAfter) = account.agents(agent);
        assertEq(strikesAfter, strikesBefore + 1);
        if (strikesAfter >= account.quarantineThreshold()) {
            vm.startPrank(owner);
            account.unquarantineAgent(agent);
            account.resetAgentStrikes(agent);
            vm.stopPrank();
        }
    }

    function _assertStrikes(uint64 expected) internal view {
        (,, uint64 strikes) = account.agents(agent);
        assertEq(strikes, expected);
    }
}
