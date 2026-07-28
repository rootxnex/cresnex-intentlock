// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IntentLockV2DeFiTest} from "../unit/IntentLockV2DeFi.t.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";

contract IntentLockV2DeFiFuzzTest is IntentLockV2DeFiTest {
    function testFuzz_DepositAmountBoundary(uint96 actualSeed, uint96 maximumSeed, uint64 nonceSeed) public {
        uint256 actual = bound(actualSeed, 1, 500_000e6);
        uint256 maximum = bound(maximumSeed, 0, 500_000e6);
        IntentTypesV2.ExecutionCall[] memory calls = _depositCalls(vaultA, actual, address(account), actual);
        (bool ok,) =
            _execute(calls, _depositPolicy(vaultA, maximum, actual, address(account)), 700_000 + uint256(nonceSeed));
        assertEq(ok, actual <= maximum);
    }

    function testFuzz_MinimumShares(uint96 assetsSeed, uint96 minimumSeed, uint64 nonceSeed) public {
        uint256 assets = bound(assetsSeed, 1, 500_000e6);
        uint256 minimum = bound(minimumSeed, 0, 500_000e6);
        (bool ok,) = _execute(
            _depositCalls(vaultA, assets, address(account), assets),
            _depositPolicy(vaultA, assets, minimum, address(account)),
            800_000 + uint256(nonceSeed)
        );
        assertEq(ok, assets >= minimum);
    }
}
