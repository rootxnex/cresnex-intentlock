// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CresnexIntentLockAccountV2Test} from "./CresnexIntentLockAccountV2.t.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {MockERC4626Vault} from "../../src/mocks/MockERC4626Vault.sol";
import {MockVaultPriceOracle} from "../../src/mocks/MockVaultPriceOracle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract IntentLockV2DeFiTest is CresnexIntentLockAccountV2Test {
    MockERC4626Vault internal vaultA;
    MockERC4626Vault internal vaultB;
    MockVaultPriceOracle internal oracle;

    function setUp() public override {
        super.setUp();
        vaultA = new MockERC4626Vault(usdc, "Mock Vault A", "mvA");
        vaultB = new MockERC4626Vault(usdc, "Mock Vault B", "mvB");
        oracle = new MockVaultPriceOracle();
        oracle.setPrice(address(vaultA), 1e18);
        oracle.setPrice(address(vaultB), 1e18);
    }

    function testDepositValid() public {
        (bool ok,) = _execute(
            _depositCalls(vaultA, 100e6, address(account), 100e6),
            _depositPolicy(vaultA, 100e6, 100e6, address(account)),
            600
        );
        assertTrue(ok);
        assertEq(vaultA.balanceOf(address(account)), 100e6);
        assertEq(usdc.allowance(address(account), address(vaultA)), 0);
    }

    function testDepositBlocksExcessWrongBeneficiaryTooFewSharesAndResidualAllowance() public {
        _assertViolation(
            _depositCalls(vaultA, 101e6, address(account), 101e6),
            _depositPolicy(vaultA, 100e6, 100e6, address(account)),
            601
        );
        _assertViolation(
            _depositCalls(vaultA, 100e6, thief, 100e6), _depositPolicy(vaultA, 100e6, 100e6, address(account)), 602
        );

        vaultA.setBehavior(MockERC4626Vault.Behavior.TooFewShares);
        _assertViolation(
            _depositCalls(vaultA, 100e6, address(account), 100e6),
            _depositPolicy(vaultA, 100e6, 100e6, address(account)),
            603
        );
        vaultA.setBehavior(MockERC4626Vault.Behavior.Normal);
        _assertViolation(
            _depositCalls(vaultA, 100e6, address(account), 200e6),
            _depositPolicy(vaultA, 100e6, 100e6, address(account)),
            604
        );
        assertEq(vaultA.balanceOf(address(account)), 0);
        assertEq(usdc.allowance(address(account), address(vaultA)), 0);
    }

    function testMaliciousVaultExcessivePullRollsBack() public {
        vaultA.setBehavior(MockERC4626Vault.Behavior.ExcessiveAssetPull);
        _assertViolation(
            _depositCalls(vaultA, 100e6, address(account), 101e6),
            _depositPolicy(vaultA, 100e6, 100e6, address(account)),
            605
        );
        assertEq(vaultA.balanceOf(address(account)), 0);
    }

    function testDepositRejectsHiddenAssetCallEvenWhenAggregateSpendFits() public {
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](3);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (thief, 1)));
        calls[1] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(vaultA), 99e6)));
        calls[2] = _call(address(vaultA), 0, abi.encodeCall(vaultA.deposit, (99e6, address(account))));
        _assertViolation(calls, _depositPolicy(vaultA, 100e6, 99e6, address(account)), 615);
        assertEq(usdc.balanceOf(thief), 0);
        assertEq(vaultA.balanceOf(address(account)), 0);
    }

    function testWithdrawalValid() public {
        _seedVault(vaultA, 100e6);
        (bool ok,) = _execute(
            _withdrawCalls(vaultA, 100e6, recipient, address(account)),
            _withdrawPolicy(vaultA, 100e6, 100e6, recipient),
            606
        );
        assertTrue(ok);
        assertEq(vaultA.balanceOf(address(account)), 0);
        assertEq(usdc.balanceOf(recipient), 100e6);
    }

    function testWithdrawalBlocksExcessBurnInsufficientAssetsWrongRecipientAndUnexpectedLoss() public {
        _seedVault(vaultA, 400e6);
        vaultA.setBehavior(MockERC4626Vault.Behavior.ExcessiveShareBurn);
        _assertViolation(
            _withdrawCalls(vaultA, 100e6, recipient, address(account)),
            _withdrawPolicy(vaultA, 100e6, 100e6, recipient),
            607
        );

        vaultA.setBehavior(MockERC4626Vault.Behavior.TooFewAssets);
        _assertViolation(
            _withdrawCalls(vaultA, 100e6, recipient, address(account)),
            _withdrawPolicy(vaultA, 100e6, 100e6, recipient),
            608
        );

        vaultA.setBehavior(MockERC4626Vault.Behavior.WrongRecipient);
        _assertViolation(
            _withdrawCalls(vaultA, 100e6, recipient, address(account)),
            _withdrawPolicy(vaultA, 100e6, 100e6, recipient),
            609
        );

        vaultA.setBehavior(MockERC4626Vault.Behavior.Normal);
        _assertViolation(
            _withdrawCalls(vaultA, 101e6, recipient, address(account)),
            _withdrawPolicy(vaultA, 100e6, 100e6, recipient),
            610
        );
        assertEq(usdc.balanceOf(recipient), 0);
        assertEq(vaultA.balanceOf(address(account)), 400e6);
    }

    function testYieldRebalanceBetweenApprovedVaults() public {
        _seedVault(vaultA, 100e6);
        uint256 minimumValue = _portfolioValue();
        IntentTypesV2.ExecutionCall[] memory calls = _rebalanceCalls(vaultA, vaultB, 100e6);
        (bool ok,) = _execute(calls, _yieldPolicy(100e6, minimumValue), 611);
        assertTrue(ok);
        assertEq(vaultA.balanceOf(address(account)), 0);
        assertEq(vaultB.balanceOf(address(account)), 100e6);
    }

    function testYieldBlocksMovementLimitValueLossAndUnapprovedVault() public {
        _seedVault(vaultA, 300e6);
        uint256 minimumValue = _portfolioValue();
        _assertViolation(_rebalanceCalls(vaultA, vaultB, 100e6), _yieldPolicy(99e6, minimumValue), 612);

        oracle.setPrice(address(vaultB), 0.5e18);
        _assertViolation(_rebalanceCalls(vaultA, vaultB, 100e6), _yieldPolicy(100e6, minimumValue), 613);
        oracle.setPrice(address(vaultB), 1e18);

        MockERC4626Vault unapproved = new MockERC4626Vault(usdc, "Unapproved", "NO");
        IntentTypesV2.ExecutionCall[] memory calls = _rebalanceCalls(vaultA, unapproved, 100e6);
        _assertViolation(calls, _yieldPolicy(100e6, minimumValue), 614);
        assertEq(vaultA.balanceOf(address(account)), 300e6);
    }

    function testYieldRejectsArbitraryApprovedVaultCallAndDuplicateVaultPolicy() public {
        _seedVault(vaultA, 100e6);
        IntentTypesV2.ExecutionCall[] memory calls = _rebalanceCalls(vaultA, vaultB, 100e6);
        IntentTypesV2.ExecutionCall[] memory malicious = new IntentTypesV2.ExecutionCall[](calls.length + 1);
        malicious[0] = _call(
            address(vaultA), 0, abi.encodeCall(vaultA.setBehavior, (MockERC4626Vault.Behavior.ExcessiveShareBurn))
        );
        for (uint256 i; i < calls.length; ++i) {
            malicious[i + 1] = calls[i];
        }
        _assertViolation(malicious, _yieldPolicy(100e6, _portfolioValue()), 616);
        assertEq(uint256(vaultA.behavior()), uint256(MockERC4626Vault.Behavior.Normal));

        IntentTypesV2.Policy memory duplicate = _yieldPolicy(100e6, _portfolioValue());
        duplicate.assets[2].token = address(vaultA);
        address[] memory vaults = new address[](2);
        vaults[0] = address(vaultA);
        vaults[1] = address(vaultA);
        duplicate.moduleData = abi.encode(
            address(usdc),
            address(oracle),
            keccak256(abi.encode(vaults.length, vaults)),
            uint256(100e6),
            _portfolioValue()
        );
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, duplicate, 617);
        bytes memory signature = _sign(manifest);
        vm.expectRevert(CresnexIntentLockAccountV2.InvalidPolicy.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, duplicate, signature);
        assertFalse(account.usedNonces(617));
    }

    function _depositCalls(MockERC4626Vault vault, uint256 assets, address beneficiary, uint256 approval)
        internal
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(vault), approval)));
        calls[1] = _call(address(vault), 0, abi.encodeCall(vault.deposit, (assets, beneficiary)));
    }

    function _depositPolicy(MockERC4626Vault vault, uint256 maxAssets, uint256 minShares, address beneficiary)
        internal
        view
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.DeFiDeposit;
        policy.assets = new IntentTypesV2.AssetConstraint[](2);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(usdc), maxAssets, address(account), 0, 0);
        policy.assets[1] = IntentTypesV2.AssetConstraint(address(vault), 0, beneficiary, minShares, 0);
        policy.allowances = _allowances(address(usdc), address(vault), 0);
        policy.moduleData = abi.encode(address(vault), address(usdc), beneficiary, maxAssets, minShares, uint256(0));
    }

    function _withdrawCalls(MockERC4626Vault vault, uint256 assets, address receiver, address sharesOwner)
        internal
        pure
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = _call(address(vault), 0, abi.encodeCall(vault.withdraw, (assets, receiver, sharesOwner)));
    }

    function _withdrawPolicy(MockERC4626Vault vault, uint256 maxShares, uint256 minAssets, address receiver)
        internal
        view
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.DeFiWithdrawal;
        policy.assets = new IntentTypesV2.AssetConstraint[](2);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(vault), maxShares, address(account), 0, 0);
        policy.assets[1] = IntentTypesV2.AssetConstraint(address(usdc), 0, receiver, minAssets, 0);
        policy.moduleData = abi.encode(address(vault), address(usdc), receiver, maxShares, minAssets);
    }

    function _yieldPolicy(uint256 maxMovement, uint256 minValue)
        internal
        view
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.YieldRebalance;
        policy.assets = new IntentTypesV2.AssetConstraint[](3);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(usdc), maxMovement, address(account), 0, 0);
        policy.assets[1] = IntentTypesV2.AssetConstraint(address(vaultA), maxMovement, address(account), 0, 0);
        policy.assets[2] = IntentTypesV2.AssetConstraint(address(vaultB), maxMovement, address(account), 0, 0);
        policy.allowances = _allowances(address(usdc), address(vaultB), 0);
        address[] memory vaults = new address[](2);
        vaults[0] = address(vaultA);
        vaults[1] = address(vaultB);
        policy.moduleData = abi.encode(
            address(usdc), address(oracle), keccak256(abi.encode(vaults.length, vaults)), maxMovement, minValue
        );
    }

    function _rebalanceCalls(MockERC4626Vault from, MockERC4626Vault to, uint256 assets)
        internal
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        calls = new IntentTypesV2.ExecutionCall[](3);
        calls[0] = _call(address(from), 0, abi.encodeCall(from.withdraw, (assets, address(account), address(account))));
        calls[1] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(to), assets)));
        calls[2] = _call(address(to), 0, abi.encodeCall(to.deposit, (assets, address(account))));
    }

    function _seedVault(MockERC4626Vault vault, uint256 amount) internal {
        usdc.mint(address(this), amount);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, address(account));
    }

    function _portfolioValue() internal view returns (uint256) {
        return
            usdc.balanceOf(address(account)) + vaultA.balanceOf(address(account)) + vaultB.balanceOf(address(account));
    }
}
