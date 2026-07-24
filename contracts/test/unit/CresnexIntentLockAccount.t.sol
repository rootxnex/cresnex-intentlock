// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CresnexIntentLockAccount} from "../../src/CresnexIntentLockAccount.sol";
import {IntentTypes} from "../../src/IntentTypes.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockDexRouter} from "../../src/mocks/MockDexRouter.sol";
import {ReentrantTarget} from "../../src/mocks/ReentrantTarget.sol";

contract CresnexIntentLockAccountTest is Test {
    uint256 internal ownerKey = 0xA11CE;
    uint256 internal agentKey = 0xB0B;
    address internal owner;
    address internal agent;
    address internal outsider = address(0xBAD);
    address internal recipient = address(0xCAFE);
    CresnexIntentLockAccount internal account;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockDexRouter internal router;

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(ownerKey);
        agent = vm.addr(agentKey);
        account = new CresnexIntentLockAccount(owner);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        weth = new MockERC20("Mock WETH", "mWETH", 18);
        router = new MockDexRouter();
        usdc.mint(address(account), 1_000_000e6);
        vm.prank(owner);
        account.registerAgent(agent);
    }

    function testOwnerCanRegisterAgent() public {
        vm.prank(owner);
        account.registerAgent(outsider);
        (bool registered,,) = account.agents(outsider);
        assertTrue(registered);
    }

    function testNonOwnerCannotRegisterAgent() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        account.registerAgent(outsider);
    }

    function testRegisteredAgentCanExecuteValidSingleIntent() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(5 ether);
        (bool ok,) = _execute(_manifest(calls, 1, false, 0, 5 ether), calls, ownerKey);
        assertTrue(ok);
        assertEq(weth.balanceOf(recipient), 5 ether);
    }

    function testValidBatchSwapSucceeds() public {
        IntentTypes.ExecutionCall[] memory calls = _swapCalls(100e6, 2 ether, recipient, MockDexRouter.Behavior.Valid);
        (bool ok,) = _execute(_manifest(calls, 2, true, 100e6, 2 ether), calls, ownerKey);
        assertTrue(ok);
        assertEq(usdc.balanceOf(address(account)), 999_900e6);
        assertEq(weth.balanceOf(recipient), 2 ether);
        assertEq(usdc.allowance(address(account), address(router)), 0);
    }

    function testUnregisteredAgentRejectedWithoutStrike() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 3, false, 0, 1);
        m.agent = outsider;
        bytes memory sig = _sign(m, ownerKey);
        vm.prank(outsider);
        vm.expectRevert(CresnexIntentLockAccount.UnauthorizedAgent.selector);
        account.executeIntent(m, calls, sig);
        (,, uint256 strikes) = account.agents(agent);
        assertEq(strikes, 0);
    }

    function testWrongSignatureRejectedWithoutStrike() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 4, false, 0, 1);
        bytes memory signature = _sign(m, agentKey);
        vm.prank(agent);
        vm.expectRevert(CresnexIntentLockAccount.InvalidOwnerSignature.selector);
        account.executeIntent(m, calls, signature);
        (,, uint256 strikes) = account.agents(agent);
        assertEq(strikes, 0);
    }

    function testWrongAccountRejected() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 5, false, 0, 1);
        m.account = outsider;
        _expectAuthFailure(m, calls, CresnexIntentLockAccount.WrongAccount.selector);
    }

    function testWrongChainRejected() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 6, false, 0, 1);
        m.chainId++;
        _expectAuthFailure(m, calls, CresnexIntentLockAccount.WrongChain.selector);
    }

    function testFutureAndExpiredIntentsRejected() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory future = _manifest(calls, 7, false, 0, 1);
        future.validAfter = uint48(block.timestamp + 10);
        future.validUntil = uint48(block.timestamp + 20);
        _expectAuthFailure(future, calls, CresnexIntentLockAccount.IntentNotYetValid.selector);

        IntentTypes.IntentManifest memory expired = _manifest(calls, 8, false, 0, 1);
        expired.validAfter = uint48(block.timestamp - 2);
        expired.validUntil = uint48(block.timestamp - 1);
        _expectAuthFailure(expired, calls, CresnexIntentLockAccount.IntentExpired.selector);
    }

    function testNonceReplayRejected() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 9, false, 0, 1);
        _execute(m, calls, ownerKey);
        bytes memory signature = _sign(m, ownerKey);
        vm.prank(agent);
        vm.expectRevert(CresnexIntentLockAccount.NonceAlreadyUsed.selector);
        account.executeIntent(m, calls, signature);
    }

    function testCallsHashMismatchAndBatchPermissionRejected() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 10, false, 0, 1);
        m.callsHash = bytes32(uint256(1));
        _expectAuthFailure(m, calls, CresnexIntentLockAccount.CallsHashMismatch.selector);

        IntentTypes.ExecutionCall[] memory batch = _swapCalls(1e6, 1, recipient, MockDexRouter.Behavior.Valid);
        IntentTypes.IntentManifest memory noBatch = _manifest(batch, 11, false, 1e6, 1);
        _expectAuthFailure(noBatch, batch, CresnexIntentLockAccount.BatchNotAllowed.selector);
    }

    function testOverspendRollsBackAndPersistsEvidence() public {
        uint256 beforeBalance = usdc.balanceOf(address(account));
        IntentTypes.ExecutionCall[] memory calls =
            _swapCalls(100e6, 2 ether, recipient, MockDexRouter.Behavior.ExcessiveInput);
        (bool ok, bytes32 evidence) = _execute(_manifest(calls, 12, true, 100e6, 2 ether), calls, ownerKey);
        assertFalse(ok);
        assertNotEq(evidence, bytes32(0));
        assertEq(usdc.balanceOf(address(account)), beforeBalance);
        assertEq(usdc.allowance(address(account), address(router)), 0);
        (,, uint256 strikes) = account.agents(agent);
        assertEq(strikes, 1);
        (address recordedAgent,,,,,, uint256 recordedStrikes,) = account.violations(evidence);
        assertEq(recordedAgent, agent);
        assertEq(recordedStrikes, 1);
    }

    function testInsufficientOutputAndWrongRecipientRollBack() public {
        _assertBlockedSwap(13, MockDexRouter.Behavior.InsufficientOutput);
        _assertBlockedSwap(14, MockDexRouter.Behavior.WrongRecipient);
    }

    function testExcessiveAllowanceRollsBack() public {
        IntentTypes.ExecutionCall[] memory calls = new IntentTypes.ExecutionCall[](1);
        calls[0] = IntentTypes.ExecutionCall(
            address(usdc), 0, abi.encodeCall(usdc.approve, (address(router), type(uint256).max))
        );
        IntentTypes.IntentManifest memory m = _manifest(calls, 15, false, 0, 0);
        m.maxFinalAllowance = 1;
        (bool ok,) = _execute(m, calls, ownerKey);
        assertFalse(ok);
        assertEq(usdc.allowance(address(account), address(router)), 0);
    }

    function testThresholdQuarantinesAndOwnerRecoversAgent() public {
        vm.prank(owner);
        account.setQuarantineThreshold(2);
        _assertBlockedSwap(16, MockDexRouter.Behavior.InsufficientOutput);
        _assertBlockedSwap(17, MockDexRouter.Behavior.InsufficientOutput);
        (, bool quarantined, uint256 strikes) = account.agents(agent);
        assertTrue(quarantined);
        assertEq(strikes, 2);

        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 18, false, 0, 1);
        _expectAuthFailure(m, calls, CresnexIntentLockAccount.AgentQuarantinedError.selector);
        vm.startPrank(owner);
        account.unquarantineAgent(agent);
        account.resetAgentStrikes(agent);
        vm.stopPrank();
        (, quarantined, strikes) = account.agents(agent);
        assertFalse(quarantined);
        assertEq(strikes, 0);
    }

    function testOnlySelfAndReentrancyFailSafely() public {
        IntentTypes.ExecutionCall[] memory empty = new IntentTypes.ExecutionCall[](0);
        IntentTypes.IntentManifest memory blank;
        vm.expectRevert(CresnexIntentLockAccount.OnlySelf.selector);
        account.executeIsolated(blank, empty);

        ReentrantTarget target = new ReentrantTarget();
        IntentTypes.ExecutionCall[] memory calls = new IntentTypes.ExecutionCall[](1);
        bytes memory nested = abi.encodeCall(account.executeIntent, (blank, empty, bytes("")));
        calls[0] =
            IntentTypes.ExecutionCall(address(target), 0, abi.encodeCall(target.reenter, (address(account), nested)));
        (bool ok,) = _execute(_manifest(calls, 19, false, 0, 0), calls, ownerKey);
        assertFalse(ok);
    }

    function testPausedAccountRejectsExecution() public {
        vm.prank(owner);
        account.pause();
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1);
        IntentTypes.IntentManifest memory m = _manifest(calls, 20, false, 0, 1);
        bytes memory signature = _sign(m, ownerKey);
        vm.prank(agent);
        vm.expectRevert();
        account.executeIntent(m, calls, signature);
    }

    function _assertBlockedSwap(uint256 nonce, MockDexRouter.Behavior behavior) internal {
        uint256 inputBefore = usdc.balanceOf(address(account));
        uint256 outputBefore = weth.balanceOf(recipient);
        IntentTypes.ExecutionCall[] memory calls = _swapCalls(100e6, 2 ether, recipient, behavior);
        (bool ok,) = _execute(_manifest(calls, nonce, true, 100e6, 2 ether), calls, ownerKey);
        assertFalse(ok);
        assertEq(usdc.balanceOf(address(account)), inputBefore);
        assertEq(weth.balanceOf(recipient), outputBefore);
    }

    function _mintCall(uint256 amount) internal view returns (IntentTypes.ExecutionCall[] memory calls) {
        calls = new IntentTypes.ExecutionCall[](1);
        calls[0] = IntentTypes.ExecutionCall(address(weth), 0, abi.encodeCall(weth.mint, (recipient, amount)));
    }

    function _swapCalls(uint256 input, uint256 output, address receiver, MockDexRouter.Behavior behavior)
        internal
        view
        returns (IntentTypes.ExecutionCall[] memory calls)
    {
        calls = new IntentTypes.ExecutionCall[](2);
        uint256 approval = behavior == MockDexRouter.Behavior.ExcessiveInput ? input + 1 : input;
        calls[0] =
            IntentTypes.ExecutionCall(address(usdc), 0, abi.encodeCall(usdc.approve, (address(router), approval)));
        calls[1] = IntentTypes.ExecutionCall(
            address(router),
            0,
            abi.encodeCall(router.swap, (address(usdc), address(weth), input, output, receiver, behavior))
        );
    }

    function _manifest(
        IntentTypes.ExecutionCall[] memory calls,
        uint256 nonce,
        bool allowBatch,
        uint256 maxInput,
        uint256 minOutput
    ) internal view returns (IntentTypes.IntentManifest memory) {
        return IntentTypes.IntentManifest({
            account: address(account),
            agent: agent,
            chainId: block.chainid,
            callsHash: account.hashCalls(calls),
            inputToken: address(usdc),
            maxInputAmount: maxInput,
            outputToken: address(weth),
            minOutputAmount: minOutput,
            recipient: recipient,
            approvalToken: address(usdc),
            approvalSpender: address(router),
            maxFinalAllowance: 0,
            nonce: nonce,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 1 hours),
            allowBatch: allowBatch
        });
    }

    function _sign(IntentTypes.IntentManifest memory m, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = account.hashIntent(m);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _execute(IntentTypes.IntentManifest memory m, IntentTypes.ExecutionCall[] memory calls, uint256 key)
        internal
        returns (bool, bytes32)
    {
        bytes memory signature = _sign(m, key);
        vm.prank(agent);
        return account.executeIntent(m, calls, signature);
    }

    function _expectAuthFailure(
        IntentTypes.IntentManifest memory m,
        IntentTypes.ExecutionCall[] memory calls,
        bytes4 selector
    ) internal {
        bytes memory signature = _sign(m, ownerKey);
        vm.prank(agent);
        vm.expectRevert(selector);
        account.executeIntent(m, calls, signature);
    }
}
