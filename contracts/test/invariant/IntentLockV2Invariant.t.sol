// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

contract IntentLockV2Handler is Test {
    CresnexIntentLockAccountV2 public immutable account;
    MockERC20 public immutable token;
    address public immutable agent;
    address public immutable recipient;
    uint256 internal immutable ownerKey;
    uint256 public nextNonce = 1;
    uint256 public authenticatedViolations;
    bool public rollbackBroken;
    bool public replaySucceeded;
    bool public authenticationAddedStrike;
    bool public evidenceMissing;

    constructor(
        CresnexIntentLockAccountV2 account_,
        MockERC20 token_,
        uint256 ownerKey_,
        address agent_,
        address recipient_
    ) {
        account = account_;
        token = token_;
        ownerKey = ownerKey_;
        agent = agent_;
        recipient = recipient_;
    }

    function overspend(uint96 maximumSeed, uint96 excessSeed) external {
        uint256 maximum = bound(maximumSeed, 0, 10_000e6);
        uint256 actual = maximum + bound(excessSeed, 1, 10_000e6);
        uint256 balanceBefore = token.balanceOf(address(account));
        if (actual > balanceBefore) actual = balanceBefore;
        if (actual <= maximum) return;

        IntentTypesV2.ExecutionCall[] memory calls = _calls(actual);
        IntentTypesV2.Policy memory policy = _policy(maximum);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nextNonce++);
        bytes memory signature = _sign(manifest);
        vm.prank(agent);
        (bool ok, bytes32 evidence) = account.executeIntent(manifest, calls, policy, signature);
        if (ok || token.balanceOf(address(account)) != balanceBefore) rollbackBroken = true;
        if (evidence == bytes32(0)) evidenceMissing = true;
        authenticatedViolations++;

        vm.prank(agent);
        (bool replayOk,) =
            address(account).call(abi.encodeCall(account.executeIntent, (manifest, calls, policy, signature)));
        if (replayOk) replaySucceeded = true;
    }

    function invalidChain(uint64 nonceSeed) external {
        IntentTypesV2.ExecutionCall[] memory calls = _calls(0);
        IntentTypesV2.Policy memory policy = _policy(0);
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 1_000_000 + uint256(nonceSeed));
        manifest.chainId++;
        bytes memory signature = _sign(manifest);
        (,, uint64 strikesBefore) = account.agents(agent);
        vm.prank(agent);
        (bool rejected,) =
            address(account).call(abi.encodeCall(account.executeIntent, (manifest, calls, policy, signature)));
        if (rejected) authenticationAddedStrike = true;
        (,, uint64 strikesAfter) = account.agents(agent);
        if (strikesAfter != strikesBefore) authenticationAddedStrike = true;
    }

    function _calls(uint256 amount) private view returns (IntentTypesV2.ExecutionCall[] memory calls) {
        calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = IntentTypesV2.ExecutionCall(
            address(token), 0, abi.encodeCall(IERC20.transfer, (recipient, amount)), IntentTypesV2.Operation.Call
        );
    }

    function _policy(uint256 maximum) private view returns (IntentTypesV2.Policy memory policy) {
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.assets = new IntentTypesV2.AssetConstraint[](1);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(token), maximum, recipient, maximum, 0);
        policy.moduleData =
            abi.encode(address(token), recipient, maximum, false, address(token), IERC20.transfer.selector);
    }

    function _manifest(IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy, uint256 nonce)
        private
        view
        returns (IntentTypesV2.IntentManifest memory)
    {
        return IntentTypesV2.IntentManifest(
            2,
            address(account),
            account.owner(),
            agent,
            block.chainid,
            account.hashCalls(calls),
            account.hashPolicy(policy),
            nonce,
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            false,
            1
        );
    }

    function _sign(IntentTypesV2.IntentManifest memory manifest) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, account.hashIntent(manifest));
        return abi.encodePacked(r, s, v);
    }
}

contract IntentLockV2InvariantTest is StdInvariant, Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    CresnexIntentLockAccountV2 internal account;
    MockERC20 internal token;
    IntentLockV2Handler internal handler;
    address internal owner;
    address internal agent = address(0xB0B);
    address internal recipient = address(0xCAFE);

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(OWNER_KEY);
        account = new CresnexIntentLockAccountV2(owner);
        token = new MockERC20("Invariant Token", "INV", 6);
        token.mint(address(account), type(uint128).max);
        vm.startPrank(owner);
        account.registerAgent(agent);
        account.setQuarantineThreshold(type(uint64).max);
        vm.stopPrank();
        handler = new IntentLockV2Handler(account, token, OWNER_KEY, agent, recipient);
        targetContract(address(handler));
    }

    function invariant_UnsafeInnerEffectsNeverSurvive() public view {
        assertFalse(handler.rollbackBroken());
    }

    function invariant_ConsumedNonceCannotReplay() public view {
        assertFalse(handler.replaySucceeded());
    }

    function invariant_InvalidAuthenticationNeverStrikes() public view {
        assertFalse(handler.authenticationAddedStrike());
    }

    function invariant_ViolationsStrikeExactlyOnceAndPersistEvidence() public view {
        (,, uint64 strikes) = account.agents(agent);
        assertEq(uint256(strikes), handler.authenticatedViolations());
        assertFalse(handler.evidenceMissing());
    }
}
