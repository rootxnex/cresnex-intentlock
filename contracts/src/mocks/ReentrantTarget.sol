// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract ReentrantTarget {
    function reenter(address account, bytes calldata payload) external {
        (bool ok,) = account.call(payload);
        require(ok, "reentry blocked");
    }
}

