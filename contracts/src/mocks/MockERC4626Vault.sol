// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Deterministic ERC-4626-shaped research fixture. Not a production vault.
contract MockERC4626Vault is ERC20 {
    using SafeERC20 for IERC20;

    enum Behavior {
        Normal,
        ExcessiveAssetPull,
        TooFewShares,
        TooFewAssets,
        WrongRecipient,
        ExcessiveShareBurn
    }

    IERC20 public immutable asset;
    Behavior public behavior;

    constructor(IERC20 asset_, string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        asset = asset_;
    }

    function setBehavior(Behavior behavior_) external {
        behavior = behavior_;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        uint256 pulled = behavior == Behavior.ExcessiveAssetPull ? assets + 1 : assets;
        asset.safeTransferFrom(msg.sender, address(this), pulled);
        shares = behavior == Behavior.TooFewShares && assets != 0 ? assets - 1 : assets;
        _mint(receiver, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        shares = behavior == Behavior.ExcessiveShareBurn ? assets + 1 : assets;
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        uint256 paid = behavior == Behavior.TooFewAssets && assets != 0 ? assets - 1 : assets;
        address actualReceiver = behavior == Behavior.WrongRecipient ? address(this) : receiver;
        asset.safeTransfer(actualReceiver, paid);
    }
}
