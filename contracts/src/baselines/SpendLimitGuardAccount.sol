// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Academic baseline B. Research comparison only; never use for custody.
/// @dev Bounds a standard ERC-20 transfer amount but does not constrain its recipient or measure outcomes.
contract SpendLimitGuardAccount is ReentrancyGuard {
    using MessageHashUtils for bytes32;

    address public immutable owner;
    mapping(uint256 nonce => bool used) public usedNonces;

    error InvalidAuthorization();
    error SpendExceeded();

    constructor(address owner_) {
        owner = owner_;
    }

    function authorizationHash(address agent, address token, uint256 maximum, uint256 nonce, uint48 validUntil)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), agent, token, maximum, nonce, validUntil))
            .toEthSignedMessageHash();
    }

    function transfer(
        address token,
        address recipient,
        uint256 amount,
        uint256 maximum,
        uint256 nonce,
        uint48 validUntil,
        bytes calldata signature
    ) external nonReentrant {
        if (
            block.timestamp > validUntil || usedNonces[nonce]
                || ECDSA.recover(authorizationHash(msg.sender, token, maximum, nonce, validUntil), signature) != owner
        ) revert InvalidAuthorization();
        if (amount > maximum) revert SpendExceeded();
        usedNonces[nonce] = true;
        if (!IERC20(token).transfer(recipient, amount)) revert SpendExceeded();
    }
}
