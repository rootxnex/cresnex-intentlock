// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "./MockERC20.sol";

contract MockDexRouter {
    using SafeERC20 for IERC20;
    enum Behavior {
        Valid,
        ExcessiveInput,
        InsufficientOutput,
        WrongRecipient,
        RevertAfterInput
    }
    error MockPartialFailure();

    function swap(
        address input,
        address output,
        uint256 inputAmount,
        uint256 outputAmount,
        address recipient,
        Behavior behavior
    ) external {
        uint256 debit = behavior == Behavior.ExcessiveInput ? inputAmount + 1 : inputAmount;
        IERC20(input).safeTransferFrom(msg.sender, address(this), debit);
        if (behavior == Behavior.RevertAfterInput) revert MockPartialFailure();
        uint256 credit = behavior == Behavior.InsufficientOutput && outputAmount > 0 ? outputAmount - 1 : outputAmount;
        address receiver = behavior == Behavior.WrongRecipient ? address(this) : recipient;
        MockERC20(output).mint(receiver, credit);
    }
}

