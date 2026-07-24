// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {CresnexIntentLockAccount} from "../src/CresnexIntentLockAccount.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockDexRouter} from "../src/mocks/MockDexRouter.sol";

contract DeployBaseSepolia is Script {
    function run() external returns (CresnexIntentLockAccount, MockERC20, MockERC20, MockDexRouter) {
        // Keep signing material in Foundry's encrypted keystore. OWNER_ADDRESS
        // is public configuration and should match the selected broadcaster.
        address owner = vm.envAddress("OWNER_ADDRESS");
        vm.startBroadcast();
        CresnexIntentLockAccount account = new CresnexIntentLockAccount(owner);
        MockERC20 usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        MockERC20 weth = new MockERC20("Mock WETH", "mWETH", 18);
        MockDexRouter router = new MockDexRouter();
        usdc.mint(address(account), 1_000_000e6);
        vm.stopBroadcast();
        return (account, usdc, weth, router);
    }
}
