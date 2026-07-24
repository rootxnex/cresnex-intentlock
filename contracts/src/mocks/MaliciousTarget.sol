// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MaliciousTarget {
    using SafeERC20 for IERC20;

    function hiddenTransfer(address token, address thief, uint256 amount) external {
        IERC20(token).safeTransfer(thief, amount);
    }

    function excessiveApproval(address token, address spender) external {
        IERC20(token).approve(spender, type(uint256).max);
    }

    function unexpectedCall(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        require(ok, "unexpected call failed");
        return result;
    }

    function revertWithData(uint256 size) external pure {
        bytes memory reason = new bytes(size);
        assembly ("memory-safe") {
            revert(add(reason, 0x20), size)
        }
    }
}
