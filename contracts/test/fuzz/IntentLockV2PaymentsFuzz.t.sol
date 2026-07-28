// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IntentLockV2PaymentsTest} from "../unit/IntentLockV2Payments.t.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";

contract IntentLockV2PaymentsFuzzTest is IntentLockV2PaymentsTest {
    function testFuzz_TreasuryAmountBoundary(uint96 actualSeed, uint96 maximumSeed, uint64 nonceSeed) public {
        uint256 actual = bound(actualSeed, 0, 500_000e6);
        uint256 maximum = bound(maximumSeed, 0, 500_000e6);
        bytes32 referenceHash = keccak256(abi.encode("fuzz-treasury", nonceSeed));
        (bool ok,) = _execute(
            _paymentCall(recipient, actual),
            _treasuryPolicy(recipient, maximum, referenceHash, bytes32(0), 0, 0),
            2_000_000 + uint256(nonceSeed)
        );
        assertEq(ok, actual <= maximum);
    }

    function testFuzz_PayrollWindow(uint48 offsetSeed, uint64 nonceSeed) public {
        uint256 offset = bound(uint256(offsetSeed), 0, 2 days);
        uint48 earliest = uint48(block.timestamp + 1 days);
        uint48 latest = uint48(block.timestamp + 2 days);
        vm.warp(block.timestamp + offset);
        bytes32 paymentId = keccak256(abi.encode("fuzz-payroll", nonceSeed));
        IntentTypesV2.Policy memory policy = _payrollPolicy(employee, 1, paymentId, nonceSeed, earliest, latest);
        (bool ok,) = _execute(_paymentCall(employee, 1), policy, 2_100_000 + uint256(nonceSeed));
        assertEq(ok, block.timestamp >= earliest && block.timestamp <= latest);
    }
}
