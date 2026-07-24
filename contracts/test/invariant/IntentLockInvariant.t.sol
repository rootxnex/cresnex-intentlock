// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {CresnexIntentLockAccount} from "../../src/CresnexIntentLockAccount.sol";
import {IntentTypes} from "../../src/IntentTypes.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockDexRouter} from "../../src/mocks/MockDexRouter.sol";

/// @dev Stateful adversarial driver. It submits only authenticated unsafe intents,
/// then records any violation of rollback, replay, allowance, or evidence properties.
contract UnsafeExecutionHandler is Test {
    CresnexIntentLockAccount public immutable account;
    CresnexIntentLockAccount public immutable quarantinedAccount;
    MockERC20 public immutable usdc;
    MockERC20 public immutable weth;
    MockDexRouter public immutable router;
    address public immutable agent;
    address public immutable recipient;
    uint256 internal immutable ownerKey;
    uint256 public nextNonce = 1;
    uint256 public violationCount;
    bytes32 public lastEvidence;
    bool public balanceRollbackBroken;
    bool public allowanceCapBroken;
    bool public replaySucceeded;
    bool public evidenceMissing;
    bool public quarantinedExecutionSucceeded;

    constructor(
        CresnexIntentLockAccount account_,
        CresnexIntentLockAccount quarantinedAccount_,
        MockERC20 usdc_,
        MockERC20 weth_,
        MockDexRouter router_,
        uint256 ownerKey_,
        address agent_,
        address recipient_
    ) {
        account = account_;
        quarantinedAccount = quarantinedAccount_;
        usdc = usdc_;
        weth = weth_;
        router = router_;
        ownerKey = ownerKey_;
        agent = agent_;
        recipient = recipient_;
    }

    function unsafeSwap(uint96 inputSeed, uint96 outputSeed, uint8 behaviorSeed) external {
        uint256 input = bound(uint256(inputSeed), 1, 10_000e6);
        uint256 output = bound(uint256(outputSeed), 1, 10_000 ether);
        MockDexRouter.Behavior behavior =
            behaviorSeed % 2 == 0 ? MockDexRouter.Behavior.ExcessiveInput : MockDexRouter.Behavior.InsufficientOutput;
        IntentTypes.ExecutionCall[] memory calls = _swapCalls(input, output, behavior);
        _executeUnsafe(_manifest(account, calls, nextNonce++, input, output, true), calls);
    }

    function unsafeAllowance(uint96 allowanceSeed) external {
        uint256 excessive = bound(uint256(allowanceSeed), 1, type(uint96).max);
        IntentTypes.ExecutionCall[] memory calls = new IntentTypes.ExecutionCall[](1);
        calls[0] =
            IntentTypes.ExecutionCall(address(usdc), 0, abi.encodeCall(usdc.approve, (address(router), excessive)));
        _executeUnsafe(_manifest(account, calls, nextNonce++, 0, 0, false), calls);
    }

    function attemptQuarantinedExecution(uint64 nonceSeed) external {
        IntentTypes.ExecutionCall[] memory calls = new IntentTypes.ExecutionCall[](1);
        calls[0] = IntentTypes.ExecutionCall(address(weth), 0, abi.encodeCall(weth.mint, (recipient, 1)));
        IntentTypes.IntentManifest memory manifest =
            _manifest(quarantinedAccount, calls, uint256(nonceSeed) + 1_000_000, 0, 1, false);
        bytes memory signature = _sign(quarantinedAccount, manifest);
        vm.prank(agent);
        (bool callOk, bytes memory result) = address(quarantinedAccount)
            .call(abi.encodeCall(quarantinedAccount.executeIntent, (manifest, calls, signature)));
        if (callOk) {
            (bool executionOk,) = abi.decode(result, (bool, bytes32));
            if (executionOk) quarantinedExecutionSucceeded = true;
        }
    }

    function unauthorizedRecovery() external {
        vm.prank(address(0xBAD));
        (bool ok,) = address(quarantinedAccount).call(abi.encodeCall(quarantinedAccount.unquarantineAgent, (agent)));
        if (ok) quarantinedExecutionSucceeded = true;
    }

    function _executeUnsafe(IntentTypes.IntentManifest memory manifest, IntentTypes.ExecutionCall[] memory calls)
        internal
    {
        uint256 inputBefore = usdc.balanceOf(address(account));
        uint256 outputBefore = weth.balanceOf(recipient);
        uint256 allowanceBefore = usdc.allowance(address(account), address(router));
        bytes memory signature = _sign(account, manifest);

        vm.prank(agent);
        (bool executionOk, bytes32 evidence) = account.executeIntent(manifest, calls, signature);
        if (executionOk) balanceRollbackBroken = true;
        if (usdc.balanceOf(address(account)) != inputBefore || weth.balanceOf(recipient) != outputBefore) {
            balanceRollbackBroken = true;
        }
        if (
            usdc.allowance(address(account), address(router)) != allowanceBefore
                || usdc.allowance(address(account), address(router)) > manifest.maxFinalAllowance
        ) allowanceCapBroken = true;

        if (evidence == bytes32(0)) {
            evidenceMissing = true;
        } else {
            lastEvidence = evidence;
            ++violationCount;
            (address recordedAgent,,,,,, uint256 recordedStrikes,) = account.violations(evidence);
            if (recordedAgent != agent || recordedStrikes != violationCount) evidenceMissing = true;
        }

        vm.prank(agent);
        (bool replayCallOk,) =
            address(account).call(abi.encodeCall(account.executeIntent, (manifest, calls, signature)));
        if (replayCallOk) replaySucceeded = true;
    }

    function _swapCalls(uint256 input, uint256 output, MockDexRouter.Behavior behavior)
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
            abi.encodeCall(router.swap, (address(usdc), address(weth), input, output, recipient, behavior))
        );
    }

    function _manifest(
        CresnexIntentLockAccount targetAccount,
        IntentTypes.ExecutionCall[] memory calls,
        uint256 nonce,
        uint256 maxInput,
        uint256 minOutput,
        bool allowBatch
    ) internal view returns (IntentTypes.IntentManifest memory) {
        return IntentTypes.IntentManifest({
            account: address(targetAccount),
            agent: agent,
            chainId: block.chainid,
            callsHash: targetAccount.hashCalls(calls),
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
            validUntil: uint48(block.timestamp + 1 days),
            allowBatch: allowBatch
        });
    }

    function _sign(CresnexIntentLockAccount targetAccount, IntentTypes.IntentManifest memory manifest)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, targetAccount.hashIntent(manifest));
        return abi.encodePacked(r, s, v);
    }
}

contract IntentLockInvariantTest is StdInvariant, Test {
    uint256 internal ownerKey = 0xA11CE;
    address internal owner;
    address internal agent;
    address internal recipient = address(0xCAFE);
    CresnexIntentLockAccount internal account;
    CresnexIntentLockAccount internal quarantinedAccount;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockDexRouter internal router;
    UnsafeExecutionHandler internal handler;
    uint256 internal initialBalance;

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(ownerKey);
        agent = vm.addr(0xB0B);
        account = new CresnexIntentLockAccount(owner);
        quarantinedAccount = new CresnexIntentLockAccount(owner);
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        weth = new MockERC20("Mock WETH", "mWETH", 18);
        router = new MockDexRouter();
        initialBalance = 1_000_000e6;
        usdc.mint(address(account), initialBalance);
        usdc.mint(address(quarantinedAccount), initialBalance);

        vm.startPrank(owner);
        account.registerAgent(agent);
        account.setQuarantineThreshold(type(uint256).max);
        quarantinedAccount.registerAgent(agent);
        quarantinedAccount.setQuarantineThreshold(1);
        vm.stopPrank();
        _quarantineDedicatedAccount();

        handler =
            new UnsafeExecutionHandler(account, quarantinedAccount, usdc, weth, router, ownerKey, agent, recipient);
        targetContract(address(handler));
    }

    function invariant_UnsafeExecutionCannotReduceProtectedBalance() public view {
        assertFalse(handler.balanceRollbackBroken());
        assertEq(usdc.balanceOf(address(account)), initialBalance);
        assertEq(weth.balanceOf(recipient), 0);
    }

    function invariant_UnsafeExecutionCannotLeaveExcessiveAllowance() public view {
        assertFalse(handler.allowanceCapBroken());
        assertEq(usdc.allowance(address(account), address(router)), 0);
    }

    function invariant_ConsumedNonceCannotExecuteAgain() public view {
        assertFalse(handler.replaySucceeded());
    }

    function invariant_QuarantinedAgentCannotExecute() public view {
        (, bool quarantined,) = quarantinedAccount.agents(agent);
        assertTrue(quarantined);
        assertFalse(handler.quarantinedExecutionSucceeded());
    }

    function invariant_OnlyOwnerCanClearQuarantine() public view {
        (, bool quarantined,) = quarantinedAccount.agents(agent);
        assertTrue(quarantined);
    }

    function invariant_ViolationEvidencePersistsAfterRollback() public view {
        assertFalse(handler.evidenceMissing());
        (,, uint256 strikes) = account.agents(agent);
        assertEq(strikes, handler.violationCount());
        if (handler.lastEvidence() != bytes32(0)) {
            (address recordedAgent,,,,,,,) = account.violations(handler.lastEvidence());
            assertEq(recordedAgent, agent);
        }
    }

    function _quarantineDedicatedAccount() internal {
        IntentTypes.ExecutionCall[] memory calls = new IntentTypes.ExecutionCall[](1);
        calls[0] = IntentTypes.ExecutionCall(address(usdc), 0, abi.encodeCall(usdc.approve, (address(router), 1)));
        IntentTypes.IntentManifest memory manifest = IntentTypes.IntentManifest({
            account: address(quarantinedAccount),
            agent: agent,
            chainId: block.chainid,
            callsHash: quarantinedAccount.hashCalls(calls),
            inputToken: address(usdc),
            maxInputAmount: 0,
            outputToken: address(weth),
            minOutputAmount: 0,
            recipient: recipient,
            approvalToken: address(usdc),
            approvalSpender: address(router),
            maxFinalAllowance: 0,
            nonce: 1,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 1 days),
            allowBatch: false
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, quarantinedAccount.hashIntent(manifest));
        vm.prank(agent);
        (bool ok,) = quarantinedAccount.executeIntent(manifest, calls, abi.encodePacked(r, s, v));
        assertFalse(ok);
    }
}
