// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Ownerless deterministic pricing fixture for local research only.
contract MockVaultPriceOracle {
    mapping(address vault => uint256 assetValuePerShare) public prices;

    function setPrice(address vault, uint256 assetValuePerShare) external {
        prices[vault] = assetValuePerShare;
    }

    function price(address vault) external view returns (uint256) {
        return prices[vault];
    }
}
