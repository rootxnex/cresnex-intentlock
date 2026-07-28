// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockERC4626Vault} from "../../src/mocks/MockERC4626Vault.sol";

contract IntentLockV2DeFiHandler is Test {
    CresnexIntentLockAccountV2 public immutable account;
    MockERC20 public immutable asset;
    MockERC4626Vault public immutable vault;
    address public immutable agent;
    uint256 internal immutable ownerKey;
    uint256 public nextNonce = 1;
    uint256 public violationCount;
    bool public rollbackBroken;
    bool public evidenceMissing;

    constructor(
        CresnexIntentLockAccountV2 account_,
        MockERC20 asset_,
        MockERC4626Vault vault_,
        uint256 ownerKey_,
        address agent_
    ) {
        account = account_;
        asset = asset_;
        vault = vault_;
        ownerKey = ownerKey_;
        agent = agent_;
    }

    function excessiveDeposit(uint96 maximumSeed, uint96 excessSeed) external {
        uint256 maximum = bound(maximumSeed, 0, 10_000e6);
        uint256 actual = maximum + bound(excessSeed, 1, 10_000e6);
        uint256 balanceBefore = asset.balanceOf(address(account));
        if (actual > balanceBefore) actual = balanceBefore;
        if (actual <= maximum) return;

        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = IntentTypesV2.ExecutionCall(
            address(asset), 0, abi.encodeCall(IERC20.approve, (address(vault), actual)), IntentTypesV2.Operation.Call
        );
        calls[1] = IntentTypesV2.ExecutionCall(
            address(vault), 0, abi.encodeCall(vault.deposit, (actual, address(account))), IntentTypesV2.Operation.Call
        );

        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.DeFiDeposit;
        policy.assets = new IntentTypesV2.AssetConstraint[](2);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(asset), maximum, address(account), 0, 0);
        policy.assets[1] = IntentTypesV2.AssetConstraint(address(vault), 0, address(account), actual, 0);
        policy.allowances = new IntentTypesV2.AllowanceConstraint[](1);
        policy.allowances[0] = IntentTypesV2.AllowanceConstraint(address(asset), address(vault), 0);
        policy.moduleData = abi.encode(address(vault), address(asset), address(account), maximum, actual, uint256(0));

        IntentTypesV2.IntentManifest memory manifest = IntentTypesV2.IntentManifest(
            2,
            address(account),
            account.owner(),
            agent,
            block.chainid,
            account.hashCalls(calls),
            account.hashPolicy(policy),
            nextNonce++,
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            true,
            1
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, account.hashIntent(manifest));
        vm.prank(agent);
        (bool ok, bytes32 evidence) = account.executeIntent(manifest, calls, policy, abi.encodePacked(r, s, v));
        if (
            ok || asset.balanceOf(address(account)) != balanceBefore || vault.balanceOf(address(account)) != 0
                || asset.allowance(address(account), address(vault)) != 0
        ) rollbackBroken = true;
        if (evidence == bytes32(0)) evidenceMissing = true;
        violationCount++;
    }
}

contract IntentLockV2DeFiInvariantTest is StdInvariant, Test {
    uint256 internal constant OWNER_KEY = 0xA11CE;
    CresnexIntentLockAccountV2 internal account;
    MockERC20 internal asset;
    MockERC4626Vault internal vault;
    IntentLockV2DeFiHandler internal handler;
    address internal owner;
    address internal agent = address(0xB0B);

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(OWNER_KEY);
        account = new CresnexIntentLockAccountV2(owner);
        asset = new MockERC20("Invariant Asset", "DINV", 6);
        vault = new MockERC4626Vault(asset, "Invariant Vault", "iv");
        asset.mint(address(account), type(uint128).max);
        vm.startPrank(owner);
        account.registerAgent(agent);
        account.setQuarantineThreshold(type(uint64).max);
        vm.stopPrank();
        handler = new IntentLockV2DeFiHandler(account, asset, vault, OWNER_KEY, agent);
        targetContract(address(handler));
    }

    function invariant_UnsafeVaultEffectsNeverSurvive() public view {
        assertFalse(handler.rollbackBroken());
    }

    function invariant_DeFiEvidenceAndStrikesPersist() public view {
        (,, uint64 strikes) = account.agents(agent);
        assertEq(uint256(strikes), handler.violationCount());
        assertFalse(handler.evidenceMissing());
    }
}
