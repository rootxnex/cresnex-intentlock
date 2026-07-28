// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IntentLockV2PaymentsTest} from "./unit/IntentLockV2Payments.t.sol";

contract GasBenchmarksV2PaymentsTest is IntentLockV2PaymentsTest {
    function testGas_V2TreasuryPayment() public {
        _execute(
            _paymentCall(recipient, 10e6),
            _treasuryPolicy(recipient, 10e6, keccak256("gas-treasury"), BUDGET_ID, 1 days, 100e6),
            2_200_001
        );
    }

    function testGas_V2PayrollPayment() public {
        _execute(
            _paymentCall(employee, 10e6),
            _payrollPolicy(
                employee, 10e6, keccak256("gas-payroll"), 1, uint48(block.timestamp), uint48(block.timestamp + 1 days)
            ),
            2_200_002
        );
    }

    function testGas_V2SubscriptionPayment() public {
        uint48 start = uint48(block.timestamp);
        _execute(
            _paymentCall(merchant, 5e6),
            _subscriptionPolicy(merchant, 5e6, keccak256("gas-sub"), 1 days, start, start + 10 days, 10),
            2_200_003
        );
    }
}
