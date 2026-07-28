// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CresnexIntentLockAccountV2Test} from "./CresnexIntentLockAccountV2.t.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract IntentLockV2PaymentsTest is CresnexIntentLockAccountV2Test {
    bytes32 internal constant BUDGET_ID = keccak256("dao-operations");
    bytes32 internal constant SUBSCRIPTION_ID = keccak256("research-subscription");
    address internal employee = address(0xE11);
    address internal merchant = address(0xBEEF);

    function testTreasuryPaymentValidAndRecordsReferenceAndBudget() public {
        bytes32 referenceHash = keccak256("grant-001");
        (bool ok,) = _execute(
            _paymentCall(recipient, 60e6),
            _treasuryPolicy(recipient, 60e6, referenceHash, BUDGET_ID, 1 days, 100e6),
            1_000_001
        );
        assertTrue(ok);
        assertTrue(account.usedTreasuryReferences(referenceHash));
        assertEq(account.treasuryEpochSpend(BUDGET_ID, block.timestamp / 1 days), 60e6);
        assertEq(usdc.balanceOf(recipient), 60e6);
    }

    function testTreasuryBlocksExcessWrongRecipientDuplicateReferenceBudgetAndHiddenCall() public {
        bytes32 first = keccak256("grant-002");
        _assertViolation(
            _paymentCall(recipient, 61e6), _treasuryPolicy(recipient, 60e6, first, BUDGET_ID, 1 days, 100e6), 1_000_002
        );
        _assertViolation(
            _paymentCall(thief, 1), _treasuryPolicy(recipient, 60e6, first, BUDGET_ID, 1 days, 100e6), 1_000_003
        );

        _execute(
            _paymentCall(recipient, 60e6), _treasuryPolicy(recipient, 60e6, first, BUDGET_ID, 1 days, 100e6), 1_000_004
        );
        _assertViolation(
            _paymentCall(recipient, 1), _treasuryPolicy(recipient, 60e6, first, BUDGET_ID, 1 days, 100e6), 1_000_005
        );
        _assertViolation(
            _paymentCall(recipient, 50e6),
            _treasuryPolicy(recipient, 60e6, keccak256("grant-003"), BUDGET_ID, 1 days, 100e6),
            1_000_006
        );

        IntentTypesV2.ExecutionCall[] memory hidden = new IntentTypesV2.ExecutionCall[](2);
        hidden[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 1)));
        hidden[1] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (thief, 1)));
        _assertViolation(
            hidden, _treasuryPolicy(recipient, 60e6, keccak256("grant-004"), BUDGET_ID, 1 days, 100e6), 1_000_007
        );
        assertEq(usdc.balanceOf(thief), 0);
    }

    function testPayrollValidAndBlocksDuplicateEarlyLateExcessAndWrongEmployee() public {
        bytes32 paymentId = keccak256("employee-2026-07");
        (bool ok,) = _execute(
            _paymentCall(employee, 10e6),
            _payrollPolicy(
                employee, 10e6, paymentId, 202607, uint48(block.timestamp), uint48(block.timestamp + 1 days)
            ),
            1_100_001
        );
        assertTrue(ok);
        assertTrue(account.usedPayrollPayments(paymentId));

        _assertViolation(
            _paymentCall(employee, 10e6),
            _payrollPolicy(
                employee, 10e6, paymentId, 202607, uint48(block.timestamp), uint48(block.timestamp + 1 days)
            ),
            1_100_002
        );
        _assertViolation(
            _paymentCall(employee, 10e6),
            _payrollPolicy(
                employee,
                10e6,
                keccak256("different-id-same-period"),
                202607,
                uint48(block.timestamp),
                uint48(block.timestamp + 1 days)
            ),
            1_100_007
        );
        _assertViolation(
            _paymentCall(employee, 10e6),
            _payrollPolicy(
                employee,
                10e6,
                keccak256("early"),
                202608,
                uint48(block.timestamp + 1),
                uint48(block.timestamp + 1 days)
            ),
            1_100_003
        );
        _assertViolation(
            _paymentCall(employee, 10e6),
            _payrollPolicy(
                employee, 10e6, keccak256("late"), 202606, uint48(block.timestamp - 2 days), uint48(block.timestamp - 1)
            ),
            1_100_004
        );
        _assertViolation(
            _paymentCall(employee, 10e6 + 1),
            _payrollPolicy(
                employee, 10e6, keccak256("excess"), 202608, uint48(block.timestamp), uint48(block.timestamp + 1 days)
            ),
            1_100_005
        );
        _assertViolation(
            _paymentCall(thief, 1),
            _payrollPolicy(
                employee, 10e6, keccak256("wrong"), 202608, uint48(block.timestamp), uint48(block.timestamp + 1 days)
            ),
            1_100_006
        );
    }

    function testSubscriptionRecurringPeriodsCountAndOwnerCancellation() public {
        uint48 start = uint48(block.timestamp);
        uint48 interval = 1 days;
        IntentTypesV2.Policy memory policy =
            _subscriptionPolicy(merchant, 5e6, SUBSCRIPTION_ID, interval, start, start + 10 days, 2);
        (bool ok,) = _execute(_paymentCall(merchant, 5e6), policy, 1_200_001);
        assertTrue(ok);
        assertEq(account.subscriptionPaymentCount(SUBSCRIPTION_ID), 1);

        _assertViolation(_paymentCall(merchant, 5e6), policy, 1_200_002);
        vm.warp(block.timestamp + interval);
        (ok,) = _execute(_paymentCall(merchant, 5e6), policy, 1_200_003);
        assertTrue(ok);
        assertEq(account.subscriptionPaymentCount(SUBSCRIPTION_ID), 2);
        vm.warp(block.timestamp + interval);
        _assertViolation(_paymentCall(merchant, 5e6), policy, 1_200_004);

        vm.prank(owner);
        account.cancelSubscription(SUBSCRIPTION_ID);
        assertTrue(account.cancelledSubscriptions(SUBSCRIPTION_ID));
        _assertViolation(_paymentCall(merchant, 1), policy, 1_200_005);
    }

    function testSubscriptionBlocksExcessWrongMerchantExpiryAndNonOwnerCancellation() public {
        uint48 start = uint48(block.timestamp);
        IntentTypesV2.Policy memory policy =
            _subscriptionPolicy(merchant, 5e6, SUBSCRIPTION_ID, 1 days, start, start + 2 days, 10);
        _assertViolation(_paymentCall(merchant, 5e6 + 1), policy, 1_300_001);
        _assertViolation(_paymentCall(thief, 1), policy, 1_300_002);
        vm.warp(start + 2 days + 1);
        _assertViolation(_paymentCall(merchant, 1), policy, 1_300_003);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, thief));
        vm.prank(thief);
        account.cancelSubscription(SUBSCRIPTION_ID);
    }

    function _paymentCall(address receiver, uint256 amount)
        internal
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        return _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (receiver, amount)));
    }

    function _treasuryPolicy(
        address receiver,
        uint256 maximum,
        bytes32 referenceHash,
        bytes32 budgetId,
        uint48 epochLength,
        uint256 epochBudget
    ) internal view returns (IntentTypesV2.Policy memory policy) {
        policy.module = IntentTypesV2.PolicyModule.TreasuryPayment;
        policy.assets = _assets(address(usdc), maximum, receiver, 0);
        policy.moduleData =
            abi.encode(address(usdc), receiver, maximum, referenceHash, budgetId, epochLength, epochBudget);
    }

    function _payrollPolicy(
        address receiver,
        uint256 maximum,
        bytes32 paymentId,
        uint256 period,
        uint48 earliest,
        uint48 latest
    ) internal view returns (IntentTypesV2.Policy memory policy) {
        policy.module = IntentTypesV2.PolicyModule.Payroll;
        policy.assets = _assets(address(usdc), maximum, receiver, 0);
        policy.moduleData = abi.encode(address(usdc), receiver, maximum, paymentId, period, earliest, latest);
    }

    function _subscriptionPolicy(
        address receiver,
        uint256 maximum,
        bytes32 subscriptionId,
        uint48 interval,
        uint48 start,
        uint48 end,
        uint32 maxPayments
    ) internal view returns (IntentTypesV2.Policy memory policy) {
        policy.module = IntentTypesV2.PolicyModule.Subscription;
        policy.assets = _assets(address(usdc), maximum, receiver, 0);
        policy.moduleData =
            abi.encode(subscriptionId, address(usdc), receiver, maximum, interval, start, end, maxPayments);
    }
}
