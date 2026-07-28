// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Adversarial receiver used only to verify account reentrancy containment.
contract MockReentrantNftReceiver is IERC721Receiver, IERC1155Receiver {
    address public immutable account;
    bytes public payload;
    bool public attempted;
    bool public reentrySucceeded;

    constructor(address account_) {
        account = account_;
    }

    function setPayload(bytes calldata payload_) external {
        payload = payload_;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        _attempt();
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external returns (bytes4) {
        _attempt();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        returns (bytes4)
    {
        _attempt();
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }

    function _attempt() private {
        attempted = true;
        (reentrySucceeded,) = account.call(payload);
    }
}
