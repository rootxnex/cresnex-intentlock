// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Academic baseline C. Research comparison only; never use for custody.
/// @dev Binds a target, selector, and decoded transfer amount, but not the recipient or post-state.
contract PathAndSpendGuardAccount is ReentrancyGuard {
    using MessageHashUtils for bytes32;

    address public immutable owner;
    mapping(uint256 nonce => bool used) public usedNonces;

    error InvalidAuthorization();
    error PathRejected();
    error ExecutionFailed();

    constructor(address owner_) {
        owner = owner_;
    }

    function authorizationHash(
        address agent,
        address target,
        bytes4 selector,
        uint256 maximum,
        uint256 nonce,
        uint48 validUntil
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), agent, target, selector, maximum, nonce, validUntil))
            .toEthSignedMessageHash();
    }

    function execute(
        address target,
        bytes calldata data,
        bytes4 selector,
        uint256 maximum,
        uint256 nonce,
        uint48 validUntil,
        bytes calldata signature
    ) external nonReentrant {
        if (
            block.timestamp > validUntil || usedNonces[nonce]
                || ECDSA.recover(authorizationHash(msg.sender, target, selector, maximum, nonce, validUntil), signature)
                    != owner
        ) revert InvalidAuthorization();
        if (data.length != 68 || bytes4(data[:4]) != selector) revert PathRejected();
        (, uint256 amount) = abi.decode(data[4:], (address, uint256));
        if (amount > maximum) revert PathRejected();
        usedNonces[nonce] = true;
        (bool ok,) = target.call(data);
        if (!ok) revert ExecutionFailed();
    }
}
