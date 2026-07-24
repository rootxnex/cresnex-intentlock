// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CresnexIntentLockAccountTest} from "./unit/CresnexIntentLockAccount.t.sol";
import {IntentTypes} from "../src/IntentTypes.sol";
import {MockDexRouter} from "../src/mocks/MockDexRouter.sol";

contract GasBenchmarksTest is CresnexIntentLockAccountTest {
    function testGas_ValidSingleIntent() public {
        IntentTypes.ExecutionCall[] memory calls = _mintCall(1 ether);
        _execute(_manifest(calls, 40_001, false, 0, 1 ether), calls, ownerKey);
    }

    function testGas_ValidBatchIntent() public {
        IntentTypes.ExecutionCall[] memory calls = _swapCalls(1e6, 1 ether, recipient, MockDexRouter.Behavior.Valid);
        _execute(_manifest(calls, 40_002, true, 1e6, 1 ether), calls, ownerKey);
    }

    function testGas_FailedOutcomeAndEvidence() public {
        IntentTypes.ExecutionCall[] memory calls =
            _swapCalls(1e6, 1 ether, recipient, MockDexRouter.Behavior.InsufficientOutput);
        _execute(_manifest(calls, 40_003, true, 1e6, 1 ether), calls, ownerKey);
    }
}

