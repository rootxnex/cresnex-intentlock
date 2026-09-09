// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {CresnexIntentLockAccountV3} from "../src/CresnexIntentLockAccountV3.sol";
import {CREIntentRiskConsumer} from "../src/cre/CREIntentRiskConsumer.sol";

/// @notice Deploys and wires the unaudited CRE-gated IntentLock V3 research stack.
/// @dev Workflow authorization is deliberately configured later, after the final workflow identity is frozen.
contract DeployCREIntentLockV3 is Script {
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    address internal constant BASE_SEPOLIA_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;

    error WrongChain(uint256 chainId);
    error ZeroOwner();
    error WrongForwarder(address forwarder);

    struct Deployment {
        CREIntentRiskConsumer consumer;
        CresnexIntentLockAccountV3 accountV3;
    }

    function run() external returns (Deployment memory deployed) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert WrongChain(block.chainid);
        address owner = vm.envAddress("OWNER_ADDRESS");
        if (owner == address(0)) revert ZeroOwner();
        address forwarder = vm.envOr("CRE_FORWARDER_ADDRESS", BASE_SEPOLIA_FORWARDER);
        if (forwarder != BASE_SEPOLIA_FORWARDER) revert WrongForwarder(forwarder);

        vm.startBroadcast();
        deployed.consumer = new CREIntentRiskConsumer(forwarder);
        deployed.accountV3 = new CresnexIntentLockAccountV3(owner, deployed.consumer);
        deployed.consumer.setAuthorizedGate(address(deployed.accountV3));
        vm.stopBroadcast();
    }
}
