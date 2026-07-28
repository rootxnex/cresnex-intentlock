// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Academic baseline A. Research comparison only; never use for custody.
/// @dev The owner authorizes an agent and time window, but no target, calldata, or outcome.
contract SignatureOnlyAccount is ReentrancyGuard {
    using MessageHashUtils for bytes32;

    address public immutable owner;
    mapping(uint256 nonce => bool used) public usedNonces;

    error InvalidAuthorization();
    error ExecutionFailed();

    constructor(address owner_) {
        owner = owner_;
    }

    receive() external payable {}

    function authorizationHash(address agent, uint256 nonce, uint48 validUntil) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), agent, nonce, validUntil)).toEthSignedMessageHash();
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 nonce,
        uint48 validUntil,
        bytes calldata signature
    ) external nonReentrant {
        if (
            msg.sender == address(0) || block.timestamp > validUntil || usedNonces[nonce]
                || ECDSA.recover(authorizationHash(msg.sender, nonce, validUntil), signature) != owner
        ) revert InvalidAuthorization();
        usedNonces[nonce] = true;
        (bool ok,) = target.call{value: value}(data);
        if (!ok) revert ExecutionFailed();
    }
}
