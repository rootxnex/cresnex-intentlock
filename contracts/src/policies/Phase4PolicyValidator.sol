// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IntentTypesV2} from "../IntentTypesV2.sol";

/// @notice Immutable Phase 4 validation module. It never executes account calls.
contract Phase4PolicyValidator {
    uint8 private constant WRONG_RECIPIENT = 3;
    uint8 private constant ALLOWANCE_EXCEEDED = 4;
    uint8 private constant UNAUTHORIZED_CALL = 5;
    uint8 private constant NFT_NOT_RECEIVED = 8;
    uint8 private constant ADMIN_PARAMETER_OUT_OF_RANGE = 10;
    uint8 private constant POLICY_MODULE_FAILURE = 11;

    bytes4 private constant APPROVE_SELECTOR = IERC20.approve.selector;
    bytes4 private constant BUY_721_SELECTOR = bytes4(keccak256("buyERC721(address,uint256,address,uint256,address)"));
    bytes4 private constant BUY_1155_SELECTOR =
        bytes4(keccak256("buyERC1155(address,uint256,uint256,address,uint256,address)"));
    bytes4 private constant SET_PARAMETER_SELECTOR = bytes4(keccak256("setParameter(uint256)"));
    bytes4 private constant SET_APPROVED_ADDRESS_SELECTOR = bytes4(keccak256("setApprovedAddress(address)"));
    bytes4 private constant SET_PAUSED_SELECTOR = bytes4(keccak256("setPaused(bool)"));
    bytes4 private constant GRANT_ROLE_SELECTOR = bytes4(keccak256("grantRole(bytes32,address)"));
    bytes4 private constant SET_TREASURY_LIMIT_SELECTOR = bytes4(keccak256("setTreasuryLimit(uint256)"));

    error InvalidPolicy();
    error PolicyViolation(uint8 code, bytes32 evidence);

    function validateShape(IntentTypesV2.Policy calldata policy, address account) external pure {
        if (policy.module == IntentTypesV2.PolicyModule.NftPurchase) {
            (
                address marketplace,
                address collection,
                uint256 tokenId,
                bytes32 tokenCommitment,
                address paymentToken,
                uint256 maxPayment,
                address recipient,
                uint256 minQuantity,
                uint8 standard,
                address approvalSpender,
                uint256 maxFinalAllowance,
                bool requireExactToken
            ) = abi.decode(
                policy.moduleData,
                (address, address, uint256, bytes32, address, uint256, address, uint256, uint8, address, uint256, bool)
            );
            if (
                marketplace == address(0) || collection == address(0) || paymentToken == address(0)
                    || recipient == address(0) || approvalSpender != marketplace || standard < 1 || standard > 2
                    || minQuantity == 0 || (requireExactToken && tokenCommitment != keccak256(abi.encode(tokenId)))
                    || !_hasAsset(policy, paymentToken, maxPayment, account)
                    || !_hasAllowance(policy, paymentToken, marketplace, maxFinalAllowance)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.Administration) {
            (
                address target,
                bytes4 selector,
                uint256 minimum,
                uint256 maximum,
                address approvedAddress,
                bytes32 role,
                uint48 validAfter
            ) = abi.decode(policy.moduleData, (address, bytes4, uint256, uint256, address, bytes32, uint48));
            validAfter;
            if (
                target == address(0) || minimum > maximum || !_allowedAdminSelector(selector)
                    || ((selector == SET_APPROVED_ADDRESS_SELECTOR || selector == GRANT_ROLE_SELECTOR)
                        && approvedAddress == address(0)) || (selector == GRANT_ROLE_SELECTOR && role == bytes32(0))
            ) revert InvalidPolicy();
        } else {
            revert InvalidPolicy();
        }
    }

    function validateCalls(
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        address account
    ) external view {
        if (policy.module == IntentTypesV2.PolicyModule.NftPurchase) {
            _validateNftCalls(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Administration) {
            _validateAdminCall(calls, policy, account);
        } else {
            _violate(POLICY_MODULE_FAILURE, keccak256("unsupported-phase4-module"));
        }
    }

    function validateOutcome(IntentTypesV2.Policy calldata policy) external view {
        if (policy.module != IntentTypesV2.PolicyModule.NftPurchase) return;
        (, address collection, uint256 tokenId,,,, address recipient, uint256 minQuantity, uint8 standard,,,) = abi.decode(
            policy.moduleData,
            (address, address, uint256, bytes32, address, uint256, address, uint256, uint8, address, uint256, bool)
        );
        if (standard == 1) {
            try IERC721(collection).ownerOf(tokenId) returns (address currentOwner) {
                if (currentOwner != recipient) {
                    _violate(NFT_NOT_RECEIVED, keccak256(abi.encode(collection, tokenId, currentOwner, recipient)));
                }
            } catch {
                _violate(NFT_NOT_RECEIVED, keccak256(abi.encode(collection, tokenId, recipient)));
            }
        } else {
            uint256 quantity = IERC1155(collection).balanceOf(recipient, tokenId);
            if (quantity < minQuantity) {
                _violate(NFT_NOT_RECEIVED, keccak256(abi.encode(collection, tokenId, quantity, minQuantity)));
            }
        }
    }

    function _validateNftCalls(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        pure
    {
        (
            address marketplace,
            address collection,
            uint256 tokenId,
            bytes32 tokenCommitment,
            address paymentToken,
            uint256 maxPayment,
            address recipient,
            uint256 minQuantity,
            uint8 standard,,,
            bool requireExactToken
        ) = abi.decode(
            policy.moduleData,
            (address, address, uint256, bytes32, address, uint256, address, uint256, uint8, address, uint256, bool)
        );
        uint256 purchaseCount;
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == paymentToken) {
                if (calls[i].data.length != 68 || _selector(calls[i].data) != APPROVE_SELECTOR) {
                    _violate(UNAUTHORIZED_CALL, keccak256(calls[i].data));
                }
                (address spender, uint256 amount) = abi.decode(calls[i].data[4:], (address, uint256));
                if (spender != marketplace || amount > maxPayment) {
                    _violate(ALLOWANCE_EXCEEDED, keccak256(abi.encode(spender, amount, maxPayment)));
                }
                continue;
            }
            if (calls[i].target != marketplace || calls[i].value != 0) {
                _violate(UNAUTHORIZED_CALL, keccak256(abi.encode(i, calls[i].target)));
            }
            if (standard == 1) {
                if (_selector(calls[i].data) != BUY_721_SELECTOR || calls[i].data.length != 164) {
                    _violate(UNAUTHORIZED_CALL, keccak256(calls[i].data));
                }
                (address actualCollection, uint256 actualId, address payToken, uint256 price, address receiver) =
                    abi.decode(calls[i].data[4:], (address, uint256, address, uint256, address));
                _validateNftArguments(
                    actualCollection,
                    actualId,
                    payToken,
                    price,
                    receiver,
                    collection,
                    tokenId,
                    tokenCommitment,
                    paymentToken,
                    maxPayment,
                    recipient,
                    requireExactToken
                );
            } else {
                if (_selector(calls[i].data) != BUY_1155_SELECTOR || calls[i].data.length != 196) {
                    _violate(UNAUTHORIZED_CALL, keccak256(calls[i].data));
                }
                (
                    address actualCollection,
                    uint256 actualId,
                    uint256 quantity,
                    address payToken,
                    uint256 price,
                    address receiver
                ) = abi.decode(calls[i].data[4:], (address, uint256, uint256, address, uint256, address));
                _validateNftArguments(
                    actualCollection,
                    actualId,
                    payToken,
                    price,
                    receiver,
                    collection,
                    tokenId,
                    tokenCommitment,
                    paymentToken,
                    maxPayment,
                    recipient,
                    requireExactToken
                );
                if (quantity < minQuantity) {
                    _violate(NFT_NOT_RECEIVED, keccak256(abi.encode(quantity, minQuantity)));
                }
            }
            ++purchaseCount;
        }
        if (purchaseCount != 1) _violate(UNAUTHORIZED_CALL, keccak256(abi.encode(purchaseCount)));
    }

    function _validateNftArguments(
        address actualCollection,
        uint256 actualId,
        address payToken,
        uint256 price,
        address receiver,
        address collection,
        uint256 tokenId,
        bytes32 tokenCommitment,
        address paymentToken,
        uint256 maxPayment,
        address recipient,
        bool requireExactToken
    ) private pure {
        if (actualCollection != collection || payToken != paymentToken) {
            _violate(UNAUTHORIZED_CALL, keccak256(abi.encode(actualCollection, payToken)));
        }
        if (
            (requireExactToken && actualId != tokenId)
                || (!requireExactToken && keccak256(abi.encode(actualId)) != tokenCommitment)
        ) _violate(UNAUTHORIZED_CALL, keccak256(abi.encode(actualId, tokenId, tokenCommitment)));
        if (price > maxPayment) _violate(ALLOWANCE_EXCEEDED, keccak256(abi.encode(price, maxPayment)));
        if (receiver != recipient) _violate(WRONG_RECIPIENT, keccak256(abi.encode(receiver, recipient)));
    }

    function _validateAdminCall(
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        address
    ) private view {
        (
            address target,
            bytes4 selector,
            uint256 minimum,
            uint256 maximum,
            address approvedAddress,
            bytes32 role,
            uint48 validAfter
        ) = abi.decode(policy.moduleData, (address, bytes4, uint256, uint256, address, bytes32, uint48));
        if (block.timestamp < validAfter) {
            _violate(ADMIN_PARAMETER_OUT_OF_RANGE, keccak256(abi.encode(block.timestamp, validAfter)));
        }
        if (
            calls.length != 1 || calls[0].target != target || calls[0].value != 0
                || _selector(calls[0].data) != selector
        ) _violate(UNAUTHORIZED_CALL, keccak256(abi.encode(calls.length, target, selector)));

        if (selector == SET_PARAMETER_SELECTOR || selector == SET_TREASURY_LIMIT_SELECTOR) {
            if (calls[0].data.length != 36) _violate(UNAUTHORIZED_CALL, keccak256(calls[0].data));
            uint256 value = abi.decode(calls[0].data[4:], (uint256));
            if (value < minimum || value > maximum) {
                _violate(ADMIN_PARAMETER_OUT_OF_RANGE, keccak256(abi.encode(value, minimum, maximum)));
            }
        } else if (selector == SET_APPROVED_ADDRESS_SELECTOR) {
            if (calls[0].data.length != 36) _violate(UNAUTHORIZED_CALL, keccak256(calls[0].data));
            address value = abi.decode(calls[0].data[4:], (address));
            if (value != approvedAddress) {
                _violate(ADMIN_PARAMETER_OUT_OF_RANGE, keccak256(abi.encode(value, approvedAddress)));
            }
        } else if (selector == SET_PAUSED_SELECTOR) {
            if (calls[0].data.length != 36) _violate(UNAUTHORIZED_CALL, keccak256(calls[0].data));
            uint256 value = abi.decode(calls[0].data[4:], (bool)) ? 1 : 0;
            if (value < minimum || value > maximum) {
                _violate(ADMIN_PARAMETER_OUT_OF_RANGE, keccak256(abi.encode(value, minimum, maximum)));
            }
        } else if (selector == GRANT_ROLE_SELECTOR) {
            if (calls[0].data.length != 68) _violate(UNAUTHORIZED_CALL, keccak256(calls[0].data));
            (bytes32 actualRole, address grantee) = abi.decode(calls[0].data[4:], (bytes32, address));
            if (actualRole != role || grantee != approvedAddress) {
                _violate(ADMIN_PARAMETER_OUT_OF_RANGE, keccak256(abi.encode(actualRole, grantee)));
            }
        } else {
            _violate(UNAUTHORIZED_CALL, keccak256(abi.encode(selector)));
        }
    }

    function _allowedAdminSelector(bytes4 selector) private pure returns (bool) {
        return selector == SET_PARAMETER_SELECTOR || selector == SET_APPROVED_ADDRESS_SELECTOR
            || selector == SET_PAUSED_SELECTOR || selector == GRANT_ROLE_SELECTOR
            || selector == SET_TREASURY_LIMIT_SELECTOR;
    }

    function _hasAsset(IntentTypesV2.Policy calldata policy, address token, uint256 maximum, address account)
        private
        pure
        returns (bool)
    {
        for (uint256 i; i < policy.assets.length; ++i) {
            IntentTypesV2.AssetConstraint calldata item = policy.assets[i];
            if (item.token == token && item.maxSpend <= maximum && item.recipient == account) return true;
        }
        return false;
    }

    function _hasAllowance(IntentTypesV2.Policy calldata policy, address token, address spender, uint256 maximum)
        private
        pure
        returns (bool)
    {
        for (uint256 i; i < policy.allowances.length; ++i) {
            IntentTypesV2.AllowanceConstraint calldata item = policy.allowances[i];
            if (item.token == token && item.spender == spender && item.maxFinalAllowance <= maximum) return true;
        }
        return false;
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        if (data.length >= 4) assembly ("memory-safe") { selector := calldataload(data.offset) }
    }

    function _violate(uint8 code, bytes32 evidence) private pure {
        revert PolicyViolation(code, evidence);
    }
}
