// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CresnexIntentLockAccountTest} from "../unit/CresnexIntentLockAccount.t.sol";
import {CresnexIntentLockAccount} from "../../src/CresnexIntentLockAccount.sol";
import {IntentTypes} from "../../src/IntentTypes.sol";
import {MockDexRouter} from "../../src/mocks/MockDexRouter.sol";

contract IntentLockFuzzTest is CresnexIntentLockAccountTest {
    function testFuzz_InputLimit(uint96 actual, uint96 maximum, uint64 nonceSeed) public {
        actual = uint96(bound(actual, 1, 500_000e6));
        maximum = uint96(bound(maximum, 0, 500_000e6));
        uint256 nonce = 10_000 + uint256(nonceSeed);
        IntentTypes.ExecutionCall[] memory calls = _swapCalls(actual, 1 ether, recipient, MockDexRouter.Behavior.Valid);
        (bool ok,) = _execute(_manifest(calls, nonce, true, maximum, 1 ether), calls, ownerKey);
        assertEq(ok, actual <= maximum);
    }

    function testFuzz_MinimumOutput(uint96 actual, uint96 minimum, uint64 nonceSeed) public {
        actual = uint96(bound(actual, 0, 1000 ether));
        minimum = uint96(bound(minimum, 0, 1000 ether));
        IntentTypes.ExecutionCall[] memory calls = _mintCall(actual);
        (bool ok,) = _execute(_manifest(calls, 20_000 + uint256(nonceSeed), false, 0, minimum), calls, ownerKey);
        assertEq(ok, actual >= minimum);
    }

    function testFuzz_BatchLengthRejectedAboveLimit(uint8 extra) public {
        uint256 length = bound(extra, 17, 64);
        IntentTypes.ExecutionCall[] memory calls = new IntentTypes.ExecutionCall[](length);
        for (uint256 i; i < length; ++i) {
            calls[i] = _mintCall(0)[0];
        }
        IntentTypes.IntentManifest memory m = _manifest(calls, 30_000 + length, true, 0, 0);
        _expectAuthFailure(m, calls, CresnexIntentLockAccount.InvalidCallCount.selector);
    }
}
