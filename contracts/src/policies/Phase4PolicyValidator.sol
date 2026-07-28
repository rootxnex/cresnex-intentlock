// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IntentTypesV2} from "../IntentTypesV2.sol";
import {ICresnexIntentLockV2} from "../interfaces/ICresnexIntentLockV2.sol";

interface IVaultPriceOracle {
    function price(address vault) external view returns (uint256);
}

/// @notice Immutable V2 policy validator. It never executes signed account calls or mutates account state.
contract Phase4PolicyValidator {
    bytes4 private constant TRANSFER_SELECTOR = IERC20.transfer.selector;
    bytes4 private constant APPROVE_SELECTOR = IERC20.approve.selector;
    bytes4 private constant DEPOSIT_SELECTOR = bytes4(keccak256("deposit(uint256,address)"));
    bytes4 private constant WITHDRAW_SELECTOR = bytes4(keccak256("withdraw(uint256,address,address)"));
    bytes4 private constant BUY_721_SELECTOR = bytes4(keccak256("buyERC721(address,uint256,address,uint256,address)"));
    bytes4 private constant BUY_1155_SELECTOR =
        bytes4(keccak256("buyERC1155(address,uint256,uint256,address,uint256,address)"));
    bytes4 private constant SET_PARAMETER_SELECTOR = bytes4(keccak256("setParameter(uint256)"));
    bytes4 private constant SET_APPROVED_ADDRESS_SELECTOR = bytes4(keccak256("setApprovedAddress(address)"));
    bytes4 private constant SET_PAUSED_SELECTOR = bytes4(keccak256("setPaused(bool)"));
    bytes4 private constant GRANT_ROLE_SELECTOR = bytes4(keccak256("grantRole(bytes32,address)"));
    bytes4 private constant SET_TREASURY_LIMIT_SELECTOR = bytes4(keccak256("setTreasuryLimit(uint256)"));

    error InvalidPolicy();
    error PolicyViolation(ICresnexIntentLockV2.ViolationCode code, bytes32 evidence);

    function validateShape(IntentTypesV2.Policy calldata policy, address account) external pure {
        uint256 expectedLength;
        if (policy.module == IntentTypesV2.PolicyModule.Transfer) expectedLength = 192;
        else if (policy.module == IntentTypesV2.PolicyModule.Swap) expectedLength = 128;
        else if (policy.module == IntentTypesV2.PolicyModule.Approval) expectedLength = 128;
        else if (policy.module == IntentTypesV2.PolicyModule.Batch) expectedLength = 0;
        else if (policy.module == IntentTypesV2.PolicyModule.DeFiDeposit) expectedLength = 192;
        else if (policy.module == IntentTypesV2.PolicyModule.DeFiWithdrawal) expectedLength = 160;
        else if (policy.module == IntentTypesV2.PolicyModule.YieldRebalance) expectedLength = 160;
        else if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) expectedLength = 224;
        else if (policy.module == IntentTypesV2.PolicyModule.Payroll) expectedLength = 224;
        else if (policy.module == IntentTypesV2.PolicyModule.Subscription) expectedLength = 256;
        else if (policy.module == IntentTypesV2.PolicyModule.NftPurchase) expectedLength = 384;
        else if (policy.module == IntentTypesV2.PolicyModule.Administration) expectedLength = 224;
        else revert InvalidPolicy();
        if (policy.moduleData.length != expectedLength) revert InvalidPolicy();

        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token == address(0) || policy.assets[i].recipient == address(0)) {
                revert InvalidPolicy();
            }
        }
        for (uint256 i; i < policy.allowances.length; ++i) {
            if (policy.allowances[i].token == address(0) || policy.allowances[i].spender == address(0)) {
                revert InvalidPolicy();
            }
        }

        if (policy.module == IntentTypesV2.PolicyModule.Transfer) {
            (address token, address recipient, uint256 maximum, bool nativeTransfer, address target, bytes4 selector) =
                abi.decode(policy.moduleData, (address, address, uint256, bool, address, bytes4));
            if (recipient == address(0) || target == address(0)) revert InvalidPolicy();
            if (nativeTransfer) {
                if (token != address(0) || target != recipient || selector != bytes4(0)) revert InvalidPolicy();
            } else if (
                token == address(0) || target != token || selector != TRANSFER_SELECTOR
                    || !_hasAsset(policy, token, maximum, recipient, 0)
            ) {
                revert InvalidPolicy();
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.Swap) {
            (address router, address input, address output, address recipient) =
                abi.decode(policy.moduleData, (address, address, address, address));
            if (
                router == address(0) || input == address(0) || output == address(0) || input == output
                    || recipient == address(0) || !_hasToken(policy, input)
                    || !_hasAsset(policy, output, type(uint256).max, recipient, 0)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.Approval) {
            (address token, address spender, uint256 maximum, bool requireZero) =
                abi.decode(policy.moduleData, (address, address, uint256, bool));
            if (
                token == address(0) || spender == address(0)
                    || !_hasAllowance(policy, token, spender, requireZero ? 0 : maximum)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiDeposit) {
            (
                address vault,
                address asset,
                address beneficiary,
                uint256 maxAssets,
                uint256 minShares,
                uint256 allowanceCap
            ) = abi.decode(policy.moduleData, (address, address, address, uint256, uint256, uint256));
            if (
                vault == address(0) || asset == address(0) || vault == asset || beneficiary == address(0)
                    || !_hasAsset(policy, asset, maxAssets, account, 0)
                    || !_hasAsset(policy, vault, 0, beneficiary, minShares)
                    || !_hasAllowance(policy, asset, vault, allowanceCap)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiWithdrawal) {
            (address vault, address asset, address recipient, uint256 maxShares, uint256 minAssets) =
                abi.decode(policy.moduleData, (address, address, address, uint256, uint256));
            if (
                vault == address(0) || asset == address(0) || vault == asset || recipient == address(0)
                    || !_hasAsset(policy, vault, maxShares, account, 0)
                    || !_hasAsset(policy, asset, 0, recipient, minAssets)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.YieldRebalance) {
            (address asset, address oracle, bytes32 approvedVaultsHash,,) =
                abi.decode(policy.moduleData, (address, address, bytes32, uint256, uint256));
            address[] memory vaults = _yieldVaults(policy, asset);
            if (
                asset == address(0) || oracle == address(0) || !_hasToken(policy, asset) || vaults.length < 2
                    || _hasDuplicate(vaults) || keccak256(abi.encode(vaults.length, vaults)) != approvedVaultsHash
            ) revert InvalidPolicy();
            for (uint256 i; i < vaults.length; ++i) {
                if (!_hasAsset(policy, vaults[i], type(uint256).max, account, 0)) revert InvalidPolicy();
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) {
            (
                address asset,
                address recipient,
                uint256 maximum,
                bytes32 referenceHash,
                bytes32 budgetId,
                uint48 epochLength,
                uint256 epochBudget
            ) = abi.decode(policy.moduleData, (address, address, uint256, bytes32, bytes32, uint48, uint256));
            if (
                asset == address(0) || recipient == address(0) || referenceHash == bytes32(0)
                    || !_hasAsset(policy, asset, maximum, recipient, 0)
                    || (epochLength == 0 && (budgetId != bytes32(0) || epochBudget != 0))
                    || (epochLength != 0 && (budgetId == bytes32(0) || epochBudget == 0))
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.Payroll) {
            (address asset, address employee, uint256 maximum, bytes32 paymentId,, uint48 earliest, uint48 latest) =
                abi.decode(policy.moduleData, (address, address, uint256, bytes32, uint256, uint48, uint48));
            if (
                asset == address(0) || employee == address(0) || paymentId == bytes32(0) || latest < earliest
                    || !_hasAsset(policy, asset, maximum, employee, 0)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.Subscription) {
            (
                bytes32 subscriptionId,
                address asset,
                address merchant,
                uint256 maximum,
                uint48 interval,
                uint48 start,
                uint48 end,
                uint32 maxPayments
            ) = abi.decode(policy.moduleData, (bytes32, address, address, uint256, uint48, uint48, uint48, uint32));
            if (
                subscriptionId == bytes32(0) || asset == address(0) || merchant == address(0) || interval == 0
                    || end < start || maxPayments == 0 || !_hasAsset(policy, asset, maximum, merchant, 0)
            ) revert InvalidPolicy();
        } else if (policy.module == IntentTypesV2.PolicyModule.NftPurchase) {
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
                marketplace == address(0) || collection == address(0) || recipient == address(0) || standard < 1
                    || standard > 2 || minQuantity == 0
                    || (requireExactToken && tokenCommitment != keccak256(abi.encode(tokenId)))
            ) revert InvalidPolicy();
            if (paymentToken == address(0)) {
                if (
                    approvalSpender != address(0) || maxFinalAllowance != 0
                        || policy.nativeConstraint.maxSpend > maxPayment
                ) revert InvalidPolicy();
            } else if (
                approvalSpender != marketplace || !_hasAsset(policy, paymentToken, maxPayment, account, 0)
                    || !_hasAllowance(policy, paymentToken, marketplace, maxFinalAllowance)
            ) {
                revert InvalidPolicy();
            }
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
        }
    }

    function validateCalls(
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        address account
    ) external view {
        if (policy.module == IntentTypesV2.PolicyModule.Transfer) {
            _validateTransfer(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Swap) {
            (address router,,,) = abi.decode(policy.moduleData, (address, address, address, address));
            bool routerCalled;
            for (uint256 i; i < calls.length; ++i) {
                if (calls[i].target == router) routerCalled = true;
            }
            if (!routerCalled) {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(policy.moduleData));
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.Approval) {
            _validateApproval(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Batch) {
            if (calls.length < 2) {
                _violate(ICresnexIntentLockV2.ViolationCode.PolicyModuleFailure, keccak256("batch-too-short"));
            }
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiDeposit) {
            _validateDeposit(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.DeFiWithdrawal) {
            _validateWithdrawal(calls, policy, account);
        } else if (policy.module == IntentTypesV2.PolicyModule.YieldRebalance) {
            _validateYieldCalls(calls, policy, account);
        } else if (
            policy.module == IntentTypesV2.PolicyModule.TreasuryPayment
                || policy.module == IntentTypesV2.PolicyModule.Payroll
                || policy.module == IntentTypesV2.PolicyModule.Subscription
        ) {
            _validatePayment(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.NftPurchase) {
            _validateNftCalls(calls, policy);
        } else if (policy.module == IntentTypesV2.PolicyModule.Administration) {
            _validateAdminCall(calls, policy);
        } else {
            _violate(ICresnexIntentLockV2.ViolationCode.PolicyModuleFailure, keccak256("unsupported-module"));
        }
    }

    function validateOutcome(IntentTypesV2.Policy calldata policy, address account, uint256 totalSpent) external view {
        if (policy.module == IntentTypesV2.PolicyModule.YieldRebalance) {
            _validateYieldOutcome(policy, account, totalSpent);
            return;
        }
        if (policy.module != IntentTypesV2.PolicyModule.NftPurchase) return;
        (, address collection, uint256 tokenId,,,, address recipient, uint256 minQuantity, uint8 standard,,,) = abi.decode(
            policy.moduleData,
            (address, address, uint256, bytes32, address, uint256, address, uint256, uint8, address, uint256, bool)
        );
        if (standard == 1) {
            try IERC721(collection).ownerOf(tokenId) returns (address currentOwner) {
                if (currentOwner != recipient) {
                    _violate(
                        ICresnexIntentLockV2.ViolationCode.NftNotReceived,
                        keccak256(abi.encode(collection, tokenId, currentOwner, recipient))
                    );
                }
            } catch {
                _violate(
                    ICresnexIntentLockV2.ViolationCode.NftNotReceived,
                    keccak256(abi.encode(collection, tokenId, recipient))
                );
            }
        } else {
            uint256 quantity = IERC1155(collection).balanceOf(recipient, tokenId);
            if (quantity < minQuantity) {
                _violate(
                    ICresnexIntentLockV2.ViolationCode.NftNotReceived,
                    keccak256(abi.encode(collection, tokenId, quantity, minQuantity))
                );
            }
        }
    }

    function _validateTransfer(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        pure
    {
        (address token, address recipient, uint256 maximum, bool nativeTransfer, address target, bytes4 selector) =
            abi.decode(policy.moduleData, (address, address, uint256, bool, address, bytes4));
        if (calls.length != 1 || calls[0].target != target) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(policy.moduleData));
        }
        if (nativeTransfer) {
            if (token != address(0) || target != recipient || calls[0].value > maximum || calls[0].data.length != 0) {
                _violate(
                    ICresnexIntentLockV2.ViolationCode.MaxSpendExceeded, keccak256(abi.encode(calls[0].value, maximum))
                );
            }
            return;
        }
        if (
            token == address(0) || target != token || selector != TRANSFER_SELECTOR || calls[0].data.length != 68
                || _selector(calls[0].data) != selector
        ) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
        }
        (address actualRecipient, uint256 amount) = abi.decode(calls[0].data[4:], (address, uint256));
        if (actualRecipient != recipient) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.WrongRecipient, keccak256(abi.encode(actualRecipient, recipient))
            );
        }
        if (amount > maximum) {
            _violate(ICresnexIntentLockV2.ViolationCode.MaxSpendExceeded, keccak256(abi.encode(amount, maximum)));
        }
    }

    function _validateApproval(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        pure
    {
        (address token, address spender, uint256 maximum, bool requireZero) =
            abi.decode(policy.moduleData, (address, address, uint256, bool));
        if (
            calls.length != 1 || calls[0].target != token || calls[0].value != 0 || calls[0].data.length != 68
                || _selector(calls[0].data) != APPROVE_SELECTOR
        ) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(calls.length, token)));
        }
        (address actualSpender, uint256 amount) = abi.decode(calls[0].data[4:], (address, uint256));
        if (actualSpender != spender) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(actualSpender, spender)));
        }
        if (amount > maximum || (requireZero && amount != 0)) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.AllowanceExceeded,
                keccak256(abi.encode(amount, maximum, requireZero))
            );
        }
    }

    function _validatePayment(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        pure
    {
        address asset;
        address recipient;
        uint256 maximum;
        if (policy.module == IntentTypesV2.PolicyModule.TreasuryPayment) {
            (asset, recipient, maximum,,,,) =
                abi.decode(policy.moduleData, (address, address, uint256, bytes32, bytes32, uint48, uint256));
        } else if (policy.module == IntentTypesV2.PolicyModule.Payroll) {
            (asset, recipient, maximum,,,,) =
                abi.decode(policy.moduleData, (address, address, uint256, bytes32, uint256, uint48, uint48));
        } else {
            (, asset, recipient, maximum,,,,) =
                abi.decode(policy.moduleData, (bytes32, address, address, uint256, uint48, uint48, uint48, uint32));
        }
        if (
            calls.length != 1 || calls[0].target != asset || calls[0].value != 0 || calls[0].data.length != 68
                || _selector(calls[0].data) != TRANSFER_SELECTOR
        ) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(calls.length, asset)));
        }
        (address actualRecipient, uint256 amount) = abi.decode(calls[0].data[4:], (address, uint256));
        if (actualRecipient != recipient) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.WrongRecipient, keccak256(abi.encode(actualRecipient, recipient))
            );
        }
        if (amount > maximum) {
            _violate(ICresnexIntentLockV2.ViolationCode.MaxSpendExceeded, keccak256(abi.encode(amount, maximum)));
        }
    }

    function _validateDeposit(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        pure
    {
        (address vault, address asset, address beneficiary, uint256 maxAssets,,) =
            abi.decode(policy.moduleData, (address, address, address, uint256, uint256, uint256));
        uint256 depositCount;
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == vault && _selector(calls[i].data) == DEPOSIT_SELECTOR) {
                if (calls[i].value != 0 || calls[i].data.length != 68) {
                    _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
                }
                (uint256 assets, address receiver) = abi.decode(calls[i].data[4:], (uint256, address));
                if (assets > maxAssets) {
                    _violate(
                        ICresnexIntentLockV2.ViolationCode.MaxSpendExceeded, keccak256(abi.encode(assets, maxAssets))
                    );
                }
                if (receiver != beneficiary) {
                    _violate(
                        ICresnexIntentLockV2.ViolationCode.WrongRecipient, keccak256(abi.encode(receiver, beneficiary))
                    );
                }
                ++depositCount;
            } else if (calls[i].target == asset) {
                if (calls[i].value != 0 || calls[i].data.length != 68 || _selector(calls[i].data) != APPROVE_SELECTOR) {
                    _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
                }
                (address spender, uint256 amount) = abi.decode(calls[i].data[4:], (address, uint256));
                if (spender != vault || amount > maxAssets) {
                    _violate(
                        ICresnexIntentLockV2.ViolationCode.AllowanceExceeded,
                        keccak256(abi.encode(spender, amount, maxAssets))
                    );
                }
            } else {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(i, calls[i].target)));
            }
        }
        if (depositCount != 1) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(depositCount)));
        }
    }

    function _validateWithdrawal(
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        address account
    ) private pure {
        (address vault,, address recipient,,) = abi.decode(
            policy.moduleData, (address, address, address, uint256, uint256)
        );
        if (
            calls.length != 1 || calls[0].target != vault || calls[0].value != 0 || calls[0].data.length != 100
                || _selector(calls[0].data) != WITHDRAW_SELECTOR
        ) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(policy.moduleData));
        }
        (, address receiver, address sharesOwner) = abi.decode(calls[0].data[4:], (uint256, address, address));
        if (receiver != recipient || sharesOwner != account) {
            _violate(ICresnexIntentLockV2.ViolationCode.WrongRecipient, keccak256(abi.encode(receiver, sharesOwner)));
        }
    }

    function _validateYieldCalls(
        IntentTypesV2.ExecutionCall[] calldata calls,
        IntentTypesV2.Policy calldata policy,
        address account
    ) private pure {
        (address asset,,,,) = abi.decode(policy.moduleData, (address, address, bytes32, uint256, uint256));
        address[] memory vaults = _yieldVaults(policy, asset);
        uint256 deposits;
        uint256 withdrawals;
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].target == asset) {
                if (calls[i].value != 0 || calls[i].data.length != 68 || _selector(calls[i].data) != APPROVE_SELECTOR) {
                    _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
                }
                (address spender,) = abi.decode(calls[i].data[4:], (address, uint256));
                if (!_contains(vaults, spender) || !_hasAllowance(policy, asset, spender, 0)) {
                    _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(spender)));
                }
                continue;
            }
            if (!_contains(vaults, calls[i].target) || calls[i].value != 0) {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(i, calls[i].target)));
            }
            bytes4 selector = _selector(calls[i].data);
            if (selector == DEPOSIT_SELECTOR && calls[i].data.length == 68) {
                (, address receiver) = abi.decode(calls[i].data[4:], (uint256, address));
                if (receiver != account) {
                    _violate(ICresnexIntentLockV2.ViolationCode.WrongRecipient, keccak256(abi.encode(receiver)));
                }
                ++deposits;
            } else if (selector == WITHDRAW_SELECTOR && calls[i].data.length == 100) {
                (, address receiver, address sharesOwner) = abi.decode(calls[i].data[4:], (uint256, address, address));
                if (receiver != account || sharesOwner != account) {
                    _violate(
                        ICresnexIntentLockV2.ViolationCode.WrongRecipient, keccak256(abi.encode(receiver, sharesOwner))
                    );
                }
                ++withdrawals;
            } else {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
            }
        }
        if (deposits == 0 || withdrawals == 0) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.PolicyModuleFailure, keccak256(abi.encode(deposits, withdrawals))
            );
        }
    }

    function _validateYieldOutcome(IntentTypesV2.Policy calldata policy, address account, uint256 totalSpent)
        private
        view
    {
        (address asset, address oracle,, uint256 maxMovement, uint256 minPortfolioValue) =
            abi.decode(policy.moduleData, (address, address, bytes32, uint256, uint256));
        if (totalSpent > maxMovement) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.MaxSpendExceeded, keccak256(abi.encode(totalSpent, maxMovement))
            );
        }
        uint256 portfolioValue = IERC20(asset).balanceOf(account);
        address[] memory vaults = _yieldVaults(policy, asset);
        for (uint256 i; i < vaults.length; ++i) {
            portfolioValue += IERC20(vaults[i]).balanceOf(account) * IVaultPriceOracle(oracle).price(vaults[i]) / 1e18;
        }
        if (portfolioValue < minPortfolioValue) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.MinOutputNotMet,
                keccak256(abi.encode(portfolioValue, minPortfolioValue))
            );
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
            if (paymentToken != address(0) && calls[i].target == paymentToken) {
                if (calls[i].data.length != 68 || _selector(calls[i].data) != APPROVE_SELECTOR) {
                    _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
                }
                (address spender, uint256 amount) = abi.decode(calls[i].data[4:], (address, uint256));
                if (spender != marketplace || amount > maxPayment) {
                    _violate(
                        ICresnexIntentLockV2.ViolationCode.AllowanceExceeded,
                        keccak256(abi.encode(spender, amount, maxPayment))
                    );
                }
                continue;
            }
            if (calls[i].target != marketplace) {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(i, calls[i].target)));
            }
            if (standard == 1) {
                if (_selector(calls[i].data) != BUY_721_SELECTOR || calls[i].data.length != 164) {
                    _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
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
                _validatePaymentValue(calls[i].value, paymentToken, price);
            } else {
                if (_selector(calls[i].data) != BUY_1155_SELECTOR || calls[i].data.length != 196) {
                    _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[i].data));
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
                _validatePaymentValue(calls[i].value, paymentToken, price);
                if (quantity < minQuantity) {
                    _violate(
                        ICresnexIntentLockV2.ViolationCode.NftNotReceived, keccak256(abi.encode(quantity, minQuantity))
                    );
                }
            }
            ++purchaseCount;
        }
        if (purchaseCount != 1) {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(purchaseCount)));
        }
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
            _violate(
                ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(actualCollection, payToken))
            );
        }
        if (
            (requireExactToken && actualId != tokenId)
                || (!requireExactToken && keccak256(abi.encode(actualId)) != tokenCommitment)
        ) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.UnauthorizedCall,
                keccak256(abi.encode(actualId, tokenId, tokenCommitment))
            );
        }
        if (price > maxPayment) {
            _violate(ICresnexIntentLockV2.ViolationCode.AllowanceExceeded, keccak256(abi.encode(price, maxPayment)));
        }
        if (receiver != recipient) {
            _violate(ICresnexIntentLockV2.ViolationCode.WrongRecipient, keccak256(abi.encode(receiver, recipient)));
        }
    }

    function _validatePaymentValue(uint256 callValue, address paymentToken, uint256 price) private pure {
        uint256 requiredValue = paymentToken == address(0) ? price : 0;
        if (callValue != requiredValue) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.MaxSpendExceeded, keccak256(abi.encode(callValue, requiredValue))
            );
        }
    }

    function _validateAdminCall(IntentTypesV2.ExecutionCall[] calldata calls, IntentTypesV2.Policy calldata policy)
        private
        view
    {
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
            _violate(
                ICresnexIntentLockV2.ViolationCode.AdminParameterOutOfRange,
                keccak256(abi.encode(block.timestamp, validAfter))
            );
        }
        if (
            calls.length != 1 || calls[0].target != target || calls[0].value != 0
                || _selector(calls[0].data) != selector
        ) {
            _violate(
                ICresnexIntentLockV2.ViolationCode.UnauthorizedCall,
                keccak256(abi.encode(calls.length, target, selector))
            );
        }

        if (selector == SET_PARAMETER_SELECTOR || selector == SET_TREASURY_LIMIT_SELECTOR) {
            if (calls[0].data.length != 36) {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
            }
            uint256 value = abi.decode(calls[0].data[4:], (uint256));
            if (value < minimum || value > maximum) {
                _violate(
                    ICresnexIntentLockV2.ViolationCode.AdminParameterOutOfRange,
                    keccak256(abi.encode(value, minimum, maximum))
                );
            }
        } else if (selector == SET_APPROVED_ADDRESS_SELECTOR) {
            if (calls[0].data.length != 36) {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
            }
            address value = abi.decode(calls[0].data[4:], (address));
            if (value != approvedAddress) {
                _violate(
                    ICresnexIntentLockV2.ViolationCode.AdminParameterOutOfRange,
                    keccak256(abi.encode(value, approvedAddress))
                );
            }
        } else if (selector == SET_PAUSED_SELECTOR) {
            if (calls[0].data.length != 36) {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
            }
            uint256 value = abi.decode(calls[0].data[4:], (bool)) ? 1 : 0;
            if (value < minimum || value > maximum) {
                _violate(
                    ICresnexIntentLockV2.ViolationCode.AdminParameterOutOfRange,
                    keccak256(abi.encode(value, minimum, maximum))
                );
            }
        } else if (selector == GRANT_ROLE_SELECTOR) {
            if (calls[0].data.length != 68) {
                _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(calls[0].data));
            }
            (bytes32 actualRole, address grantee) = abi.decode(calls[0].data[4:], (bytes32, address));
            if (actualRole != role || grantee != approvedAddress) {
                _violate(
                    ICresnexIntentLockV2.ViolationCode.AdminParameterOutOfRange,
                    keccak256(abi.encode(actualRole, grantee))
                );
            }
        } else {
            _violate(ICresnexIntentLockV2.ViolationCode.UnauthorizedCall, keccak256(abi.encode(selector)));
        }
    }

    function _allowedAdminSelector(bytes4 selector) private pure returns (bool) {
        return selector == SET_PARAMETER_SELECTOR || selector == SET_APPROVED_ADDRESS_SELECTOR
            || selector == SET_PAUSED_SELECTOR || selector == GRANT_ROLE_SELECTOR
            || selector == SET_TREASURY_LIMIT_SELECTOR;
    }

    function _hasAsset(
        IntentTypesV2.Policy calldata policy,
        address token,
        uint256 maximum,
        address recipient,
        uint256 minimumReceive
    ) private pure returns (bool) {
        for (uint256 i; i < policy.assets.length; ++i) {
            IntentTypesV2.AssetConstraint calldata item = policy.assets[i];
            if (
                item.token == token && item.maxSpend <= maximum && item.recipient == recipient
                    && item.minReceive >= minimumReceive
            ) return true;
        }
        return false;
    }

    function _hasToken(IntentTypesV2.Policy calldata policy, address token) private pure returns (bool) {
        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token == token) return true;
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

    function _yieldVaults(IntentTypesV2.Policy calldata policy, address asset)
        private
        pure
        returns (address[] memory vaults)
    {
        uint256 count;
        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token != asset) ++count;
        }
        vaults = new address[](count);
        uint256 cursor;
        for (uint256 i; i < policy.assets.length; ++i) {
            if (policy.assets[i].token != asset) vaults[cursor++] = policy.assets[i].token;
        }
    }

    function _hasDuplicate(address[] memory values) private pure returns (bool) {
        for (uint256 i; i < values.length; ++i) {
            for (uint256 j = i + 1; j < values.length; ++j) {
                if (values[i] == values[j]) return true;
            }
        }
        return false;
    }

    function _contains(address[] memory values, address value) private pure returns (bool) {
        for (uint256 i; i < values.length; ++i) {
            if (values[i] == value) return true;
        }
        return false;
    }

    function _selector(bytes calldata data) private pure returns (bytes4 selector) {
        if (data.length >= 4) assembly ("memory-safe") { selector := calldataload(data.offset) }
    }

    function _violate(ICresnexIntentLockV2.ViolationCode code, bytes32 evidence) private pure {
        revert PolicyViolation(code, evidence);
    }
}
