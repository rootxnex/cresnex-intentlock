// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CresnexIntentLockAccount} from "../src/CresnexIntentLockAccount.sol";
import {CresnexIntentLockAccountV2} from "../src/CresnexIntentLockAccountV2.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockDexRouter} from "../src/mocks/MockDexRouter.sol";
import {MockERC4626Vault} from "../src/mocks/MockERC4626Vault.sol";
import {MockVaultPriceOracle} from "../src/mocks/MockVaultPriceOracle.sol";
import {MockERC721} from "../src/mocks/MockERC721.sol";
import {MockERC1155} from "../src/mocks/MockERC1155.sol";
import {MockNftMarketplace} from "../src/mocks/MockNftMarketplace.sol";
import {MockAdminProtocol} from "../src/mocks/MockAdminProtocol.sol";

/// @notice Deploys the complete local or public-testnet research stack and writes public metadata only.
contract DeployResearchStack is Script {
    struct Deployment {
        CresnexIntentLockAccount accountV1;
        CresnexIntentLockAccountV2 accountV2;
        MockERC20 usdc;
        MockERC20 weth;
        MockDexRouter router;
        MockERC4626Vault vaultA;
        MockERC4626Vault vaultB;
        MockVaultPriceOracle oracle;
        MockERC721 nft721;
        MockERC1155 nft1155;
        MockNftMarketplace nftMarketplace;
        MockAdminProtocol adminProtocol;
    }

    function run() external returns (Deployment memory deployed) {
        address owner = vm.envAddress("OWNER_ADDRESS");
        string memory output = vm.envOr(
            "DEPLOYMENT_OUTPUT", string.concat("../shared/deployments/local-", vm.toString(block.chainid), ".json")
        );
        uint256 deploymentBlock = block.number + 1;

        vm.startBroadcast();
        deployed.accountV1 = new CresnexIntentLockAccount(owner);
        deployed.accountV2 = new CresnexIntentLockAccountV2(owner);
        deployed.usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        deployed.weth = new MockERC20("Mock WETH", "mWETH", 18);
        deployed.router = new MockDexRouter();
        deployed.vaultA = new MockERC4626Vault(IERC20(address(deployed.usdc)), "Mock Vault A", "mvA");
        deployed.vaultB = new MockERC4626Vault(IERC20(address(deployed.usdc)), "Mock Vault B", "mvB");
        deployed.oracle = new MockVaultPriceOracle();
        deployed.nft721 = new MockERC721();
        deployed.nft1155 = new MockERC1155();
        deployed.nftMarketplace = new MockNftMarketplace();
        deployed.adminProtocol = new MockAdminProtocol();
        deployed.usdc.mint(address(deployed.accountV1), 1_000_000e6);
        deployed.usdc.mint(address(deployed.accountV2), 1_000_000e6);
        deployed.oracle.setPrice(address(deployed.vaultA), 1e18);
        deployed.oracle.setPrice(address(deployed.vaultB), 1e18);
        vm.stopBroadcast();

        _writeDeployment(deployed, owner, deploymentBlock, output);
    }

    function _writeDeployment(Deployment memory deployed, address owner, uint256 deploymentBlock, string memory output)
        private
    {
        string memory key = "cresnexIntentLock";
        vm.serializeString(key, "schema", "cresnex-intentlock-deployment-v1");
        vm.serializeString(key, "network", block.chainid == 84532 ? "base-sepolia" : "local-anvil");
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deploymentBlock", deploymentBlock);
        vm.serializeString(key, "abiVersion", "2");
        vm.serializeAddress(key, "owner", owner);
        vm.serializeAddress(key, "accountV1", address(deployed.accountV1));
        vm.serializeAddress(key, "accountV2", address(deployed.accountV2));
        vm.serializeAddress(key, "usdc", address(deployed.usdc));
        vm.serializeAddress(key, "weth", address(deployed.weth));
        vm.serializeAddress(key, "router", address(deployed.router));
        vm.serializeAddress(key, "vaultA", address(deployed.vaultA));
        vm.serializeAddress(key, "vaultB", address(deployed.vaultB));
        vm.serializeAddress(key, "oracle", address(deployed.oracle));
        vm.serializeAddress(key, "nft721", address(deployed.nft721));
        vm.serializeAddress(key, "nft1155", address(deployed.nft1155));
        vm.serializeAddress(key, "nftMarketplace", address(deployed.nftMarketplace));
        string memory json = vm.serializeAddress(key, "adminProtocol", address(deployed.adminProtocol));
        vm.writeJson(json, output);
    }
}
