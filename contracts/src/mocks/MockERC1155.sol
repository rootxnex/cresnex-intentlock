// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @notice Mintable research mock. It is not production NFT code.
contract MockERC1155 is ERC1155 {
    constructor() ERC1155("mock://{id}") {}

    function mint(address to, uint256 tokenId, uint256 quantity) external {
        _mint(to, tokenId, quantity, "");
    }
}
