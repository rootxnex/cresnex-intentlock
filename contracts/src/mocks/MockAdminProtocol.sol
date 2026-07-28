// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Administrative target research mock. It is not production protocol code.
contract MockAdminProtocol {
    uint256 public parameter;
    address public approvedAddress;
    bool public paused;
    uint256 public treasuryLimit;
    uint256 public dangerousCallCount;
    mapping(bytes32 role => mapping(address account => bool granted)) public roles;

    function setParameter(uint256 value) external {
        parameter = value;
    }

    function setApprovedAddress(address value) external {
        approvedAddress = value;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function grantRole(bytes32 role, address account) external {
        roles[role][account] = true;
    }

    function setTreasuryLimit(uint256 value) external {
        treasuryLimit = value;
    }

    function transferOwnership(address) external {
        ++dangerousCallCount;
    }

    function upgradeToAndCall(address, bytes calldata) external {
        ++dangerousCallCount;
    }
}
