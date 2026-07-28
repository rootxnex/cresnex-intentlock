// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

contract IntentLockV2PaymentsHandler is Test {
    CresnexIntentLockAccountV2 public immutable account;
    MockERC20 public immutable token;
    address public immutable agent;
    address public immutable merchant;
    uint256 internal immutable ownerKey;
    bytes32 public constant SUBSCRIPTION_ID = keccak256("invariant-subscription");
    uint256 public nextNonce = 1;
    bool public doubleChargeSucceeded;
    bool public countMismatch;

    constructor(
        CresnexIntentLockAccountV2 account_,
        MockERC20 token_,
        uint256 ownerKey_,
        address agent_,
        address merchant_
    ) {
        account = account_;
        token = token_;
        ownerKey = ownerKey_;
        agent = agent_;
        merchant = merchant_;
    }

    function charge(uint96 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 100e6);
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = IntentTypesV2.ExecutionCall(
            address(token), 0, abi.encodeCall(IERC20.transfer, (merchant, amount)), IntentTypesV2.Operation.Call
        );
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Subscription;
        policy.assets = new IntentTypesV2.AssetConstraint[](1);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(token), 100e6, merchant, 0, 0);
        policy.moduleData = abi.encode(
            SUBSCRIPTION_ID,
            address(token),
            merchant,
            uint256(100e6),
            uint48(1 days),
            uint48(block.timestamp),
            uint48(block.timestamp + 30 days),
            uint32(30)
        );
        IntentTypesV2.IntentManifest memory manifest = IntentTypesV2.IntentManifest(
            2,
            address(account),
            account.owner(),
            agent,
            block.chainid,
            account.hashCalls(calls),
            account.hashPolicy(policy),
            nextNonce++,
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            false,
            1
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, account.hashIntent(manifest));
        uint256 beforeBalance = token.balanceOf(merchant);
        vm.prank(agent);
        (bool ok,) = account.executeIntent(manifest, calls, policy, abi.encodePacked(r, s, v));
        uint32 count = account.subscriptionPaymentCount(SUBSCRIPTION_ID);
        if (beforeBalance != 0 && ok) doubleChargeSucceeded = true;
        if (count > 1 || (token.balanceOf(merchant) == 0 && count != 0)) countMismatch = true;
    }
}

contract IntentLockV2PaymentsInvariantTest is StdInvariant, Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    CresnexIntentLockAccountV2 internal account;
    MockERC20 internal token;
    IntentLockV2PaymentsHandler internal handler;
    address internal owner;
    address internal agent = address(0xB0B);
    address internal merchant = address(0xBEEF);

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(OWNER_KEY);
        account = new CresnexIntentLockAccountV2(owner);
        token = new MockERC20("Payment Token", "PAY", 6);
        token.mint(address(account), type(uint128).max);
        vm.startPrank(owner);
        account.registerAgent(agent);
        account.setQuarantineThreshold(type(uint64).max);
        vm.stopPrank();
        handler = new IntentLockV2PaymentsHandler(account, token, OWNER_KEY, agent, merchant);
        targetContract(address(handler));
    }

    function invariant_OnlyOneChargePerSubscriptionPeriod() public view {
        assertFalse(handler.doubleChargeSucceeded());
        assertLe(account.subscriptionPaymentCount(handler.SUBSCRIPTION_ID()), 1);
    }

    function invariant_SubscriptionCountMatchesCommittedPayment() public view {
        assertFalse(handler.countMismatch());
        assertEq(token.balanceOf(merchant) == 0, account.subscriptionPaymentCount(handler.SUBSCRIPTION_ID()) == 0);
    }
}
