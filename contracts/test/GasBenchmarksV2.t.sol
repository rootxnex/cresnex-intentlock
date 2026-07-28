// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CresnexIntentLockAccountV2Test} from "./unit/CresnexIntentLockAccountV2.t.sol";
import {IntentTypesV2} from "../src/IntentTypesV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockDexRouter} from "../src/mocks/MockDexRouter.sol";

contract GasBenchmarksV2Test is CresnexIntentLockAccountV2Test {
    function testGas_V2Transfer() public {
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 100e6)));
        _execute(calls, _transferPolicy(address(usdc), recipient, 100e6), 500_001);
    }

    function testGas_V2Swap() public {
        IntentTypesV2.ExecutionCall[] memory calls =
            _swapCalls(100e6, 2 ether, recipient, MockDexRouter.Behavior.Valid, 100e6);
        _execute(calls, _swapPolicy(100e6, 2 ether, recipient), 500_002);
    }

    function testGas_V2BatchViolationEvidence() public {
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 60e6)));
        calls[1] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 50e6)));
        _execute(calls, _batchPolicy(100e6, 110e6), 500_003);
    }
}
