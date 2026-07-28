// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CresnexIntentLockAccountV2Test} from "../unit/CresnexIntentLockAccountV2.t.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract IntentLockV2FuzzTest is CresnexIntentLockAccountV2Test {
    function testFuzz_TransferAmountBoundary(uint96 actualSeed, uint96 maximumSeed, uint64 nonceSeed) public {
        uint256 actual = bound(actualSeed, 0, 500_000e6);
        uint256 maximum = bound(maximumSeed, 0, 500_000e6);
        uint256 nonce = 100_000 + uint256(nonceSeed);
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, actual)));
        (bool ok,) = _execute(calls, _transferPolicy(address(usdc), recipient, maximum), nonce);
        assertEq(ok, actual <= maximum);
    }

    function testFuzz_NativeSpendBoundary(uint96 actualSeed, uint96 maximumSeed, uint64 nonceSeed) public {
        uint256 actual = bound(actualSeed, 0, 100 ether);
        uint256 maximum = bound(maximumSeed, 0, 100 ether);
        vm.deal(address(account), 100 ether);
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.nativeConstraint = IntentTypesV2.NativeConstraint(maximum, 0);
        policy.moduleData = abi.encode(address(0), recipient, maximum, true, recipient, bytes4(0));
        (bool ok,) = _execute(_one(recipient, actual, ""), policy, 200_000 + uint256(nonceSeed));
        assertEq(ok, actual <= maximum);
    }

    function testFuzz_AssetArrayBound(uint8 lengthSeed) public {
        uint256 length = bound(lengthSeed, 9, 24);
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.assets = new IntentTypesV2.AssetConstraint[](length);
        for (uint256 i; i < length; ++i) {
            policy.assets[i] = IntentTypesV2.AssetConstraint(address(usdc), 1, recipient, 0, 0);
        }
        policy.moduleData = abi.encode(address(usdc), recipient, 1, false, address(usdc), IERC20.transfer.selector);
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 1)));
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 300_000 + length);
        bytes memory signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.InvalidPolicy.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);
    }

    function testFuzz_AllowanceArrayBound(uint8 lengthSeed) public {
        uint256 length = bound(lengthSeed, 9, 24);
        IntentTypesV2.Policy memory policy = _approvalPolicy(address(usdc), address(router), 1, false, 1);
        policy.allowances = new IntentTypesV2.AllowanceConstraint[](length);
        for (uint256 i; i < length; ++i) {
            policy.allowances[i] = IntentTypesV2.AllowanceConstraint(address(usdc), address(router), 1);
        }
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(router), 1)));
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 400_000 + length);
        bytes memory signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.InvalidPolicy.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);
    }
}
