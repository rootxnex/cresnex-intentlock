// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IntentLockV2DeFiTest} from "./unit/IntentLockV2DeFi.t.sol";
import {IntentTypesV2} from "../src/IntentTypesV2.sol";

contract GasBenchmarksV2DeFiTest is IntentLockV2DeFiTest {
    function testGas_V2Deposit() public {
        _execute(
            _depositCalls(vaultA, 100e6, address(account), 100e6),
            _depositPolicy(vaultA, 100e6, 100e6, address(account)),
            900_001
        );
    }

    function testGas_V2Withdrawal() public {
        _seedVault(vaultA, 100e6);
        _execute(
            _withdrawCalls(vaultA, 100e6, recipient, address(account)),
            _withdrawPolicy(vaultA, 100e6, 100e6, recipient),
            900_002
        );
    }

    function testGas_V2YieldRebalance() public {
        _seedVault(vaultA, 100e6);
        IntentTypesV2.ExecutionCall[] memory calls = _rebalanceCalls(vaultA, vaultB, 100e6);
        _execute(calls, _yieldPolicy(100e6, _portfolioValue()), 900_003);
    }
}
