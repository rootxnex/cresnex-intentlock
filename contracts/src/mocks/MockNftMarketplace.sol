// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC721} from "./MockERC721.sol";
import {MockERC1155} from "./MockERC1155.sol";

/// @notice Adversarial marketplace research mock. It is not production marketplace code.
contract MockNftMarketplace {
    using SafeERC20 for IERC20;

    enum Behavior {
        Normal,
        ExcessiveDebit,
        WrongRecipient,
        NoDelivery,
        LargeReturnData,
        LargeRevertData
    }

    Behavior public behavior;
    address public wrongRecipient = address(0xBAD);

    function setBehavior(Behavior next) external {
        behavior = next;
    }

    function buyERC721(address collection, uint256 tokenId, address paymentToken, uint256 price, address recipient)
        external
        payable
    {
        _takePayment(paymentToken, price);
        if (behavior != Behavior.NoDelivery) {
            MockERC721(collection).mint(behavior == Behavior.WrongRecipient ? wrongRecipient : recipient, tokenId);
        }
        _finishAdversarialResponse();
    }

    function buyERC1155(
        address collection,
        uint256 tokenId,
        uint256 quantity,
        address paymentToken,
        uint256 price,
        address recipient
    ) external payable {
        _takePayment(paymentToken, price);
        if (behavior != Behavior.NoDelivery) {
            MockERC1155(collection)
                .mint(behavior == Behavior.WrongRecipient ? wrongRecipient : recipient, tokenId, quantity);
        }
        _finishAdversarialResponse();
    }

    function _takePayment(address paymentToken, uint256 price) private {
        uint256 debit = behavior == Behavior.ExcessiveDebit ? price + 1 : price;
        if (paymentToken == address(0)) {
            require(msg.value == debit, "native payment mismatch");
        } else {
            require(msg.value == 0, "unexpected native payment");
            IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), debit);
        }
    }

    function _finishAdversarialResponse() private view {
        if (behavior == Behavior.LargeReturnData) {
            assembly ("memory-safe") {
                return(0, 0x10000)
            }
        }
        if (behavior == Behavior.LargeRevertData) {
            assembly ("memory-safe") {
                revert(0, 0x10000)
            }
        }
    }
}
