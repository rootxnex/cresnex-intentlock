// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {MockERC721} from "../../src/mocks/MockERC721.sol";
import {MockERC1155} from "../../src/mocks/MockERC1155.sol";
import {MockNftMarketplace} from "../../src/mocks/MockNftMarketplace.sol";
import {MockReentrantNftReceiver} from "../../src/mocks/MockReentrantNftReceiver.sol";
import {MockAdminProtocol} from "../../src/mocks/MockAdminProtocol.sol";
import {Phase4PolicyValidator} from "../../src/policies/Phase4PolicyValidator.sol";
import {CresnexIntentLockAccountV2Test} from "./CresnexIntentLockAccountV2.t.sol";

contract IntentLockV2Phase4Test is CresnexIntentLockAccountV2Test {
    uint256 private constant TOKEN_ID = 42;
    uint256 private constant PRICE = 100e6;
    bytes32 private constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    MockERC721 private nft721;
    MockERC1155 private nft1155;
    MockNftMarketplace private marketplace;
    MockAdminProtocol private admin;

    function setUp() public override {
        super.setUp();
        nft721 = new MockERC721();
        nft1155 = new MockERC1155();
        marketplace = new MockNftMarketplace();
        admin = new MockAdminProtocol();
    }

    function testNftPurchaseDeliversExactERC721AndClearsAllowance() public {
        (bool ok,) = _execute(_nft721Calls(TOKEN_ID, PRICE, address(account)), _nftPolicy(address(nft721), 1, 1), 400);

        assertTrue(ok);
        assertEq(nft721.ownerOf(TOKEN_ID), address(account));
        assertEq(usdc.balanceOf(address(marketplace)), PRICE);
        assertEq(usdc.allowance(address(account), address(marketplace)), 0);
    }

    function testNftPurchaseDeliversMinimumERC1155Quantity() public {
        (bool ok,) = _execute(_nft1155Calls(TOKEN_ID, 3, PRICE), _nftPolicy(address(nft1155), 2, 3), 401);

        assertTrue(ok);
        assertEq(nft1155.balanceOf(address(account), TOKEN_ID), 3);
        assertEq(usdc.allowance(address(account), address(marketplace)), 0);
    }

    function testNftPurchaseRejectsWrongCollectionTokenRecipientPriceAndMarketplace() public {
        IntentTypesV2.Policy memory policy = _nftPolicy(address(nft721), 1, 1);
        _assertViolation(_nft721Calls(TOKEN_ID + 1, PRICE, address(account)), policy, 402);
        _assertViolation(_nft721Calls(TOKEN_ID, PRICE, thief), policy, 403);
        _assertViolation(_nft721Calls(TOKEN_ID, PRICE + 1, address(account)), policy, 404);
        _assertViolation(_nft1155Calls(TOKEN_ID, 2, PRICE), _nftPolicy(address(nft1155), 2, 3), 433);

        IntentTypesV2.ExecutionCall[] memory calls = _nft721Calls(TOKEN_ID, PRICE, address(account));
        calls[1].target = thief;
        _assertViolation(calls, policy, 405);

        MockERC721 otherCollection = new MockERC721();
        calls = _nft721Calls(TOKEN_ID, PRICE, address(account));
        calls[1].data = abi.encodeCall(
            marketplace.buyERC721, (address(otherCollection), TOKEN_ID, address(usdc), PRICE, address(account))
        );
        _assertViolation(calls, policy, 406);
    }

    function testNftPostconditionsRollbackWrongOrMissingDelivery() public {
        IntentTypesV2.Policy memory policy = _nftPolicy(address(nft721), 1, 1);
        marketplace.setBehavior(MockNftMarketplace.Behavior.WrongRecipient);
        _assertViolation(_nft721Calls(TOKEN_ID, PRICE, address(account)), policy, 407);
        assertEq(usdc.balanceOf(address(marketplace)), 0);

        marketplace.setBehavior(MockNftMarketplace.Behavior.NoDelivery);
        _assertViolation(_nft721Calls(TOKEN_ID, PRICE, address(account)), policy, 408);
        assertEq(usdc.balanceOf(address(marketplace)), 0);
    }

    function testNftExcessivePullFailsAtomicallyWithoutPolicyStrike() public {
        marketplace.setBehavior(MockNftMarketplace.Behavior.ExcessiveDebit);
        uint256 balanceBefore = usdc.balanceOf(address(account));
        (bool ok, bytes32 evidence) =
            _execute(_nft721Calls(TOKEN_ID, PRICE, address(account)), _nftPolicy(address(nft721), 1, 1), 409);

        assertFalse(ok);
        assertNotEq(evidence, bytes32(0));
        assertEq(usdc.balanceOf(address(account)), balanceBefore);
        assertEq(usdc.allowance(address(account), address(marketplace)), 0);
        _assertStrikes(0);
    }

    function testNftPurchaseRejectsHiddenCallAndOversizedApproval() public {
        IntentTypesV2.Policy memory policy = _nftPolicy(address(nft721), 1, 1);
        IntentTypesV2.ExecutionCall[] memory calls = _nft721Calls(TOKEN_ID, PRICE, address(account));
        calls[0].data = abi.encodeCall(IERC20.approve, (address(marketplace), PRICE + 1));
        _assertViolation(calls, policy, 410);

        calls = new IntentTypesV2.ExecutionCall[](3);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(marketplace), PRICE)));
        calls[1] = _call(
            address(marketplace),
            0,
            abi.encodeCall(marketplace.buyERC721, (address(nft721), TOKEN_ID, address(usdc), PRICE, address(account)))
        );
        calls[2] = _call(address(usdc), 0, abi.encodeCall(IERC20.transfer, (thief, 1)));
        _assertViolation(calls, policy, 411);
    }

    function testNftNativePaymentIsBoundedAndDelivered() public {
        vm.deal(address(account), PRICE);
        IntentTypesV2.Policy memory policy = _nativeNftPolicy(address(nft721), 1, 1, address(account));
        IntentTypesV2.ExecutionCall[] memory calls = _nativeNft721Calls(TOKEN_ID, PRICE, address(account));

        (bool ok,) = _execute(calls, policy, 426);

        assertTrue(ok);
        assertEq(nft721.ownerOf(TOKEN_ID), address(account));
        assertEq(address(marketplace).balance, PRICE);
        assertEq(address(account).balance, 0);
    }

    function testNftResidualAllowanceIsAContainedPolicyViolation() public {
        IntentTypesV2.Policy memory policy = _nftPolicy(address(nft721), 1, 1);
        IntentTypesV2.ExecutionCall[] memory calls = _nft721Calls(TOKEN_ID, PRICE - 1, address(account));

        _assertViolation(calls, policy, 427);

        assertEq(usdc.allowance(address(account), address(marketplace)), 0);
        assertEq(usdc.balanceOf(address(marketplace)), 0);
    }

    function testNftLargeReturnDataIsBoundedAndLargeRevertDataIsNonPunitive() public {
        marketplace.setBehavior(MockNftMarketplace.Behavior.LargeReturnData);
        (bool ok,) = _execute(_nft721Calls(TOKEN_ID, PRICE, address(account)), _nftPolicy(address(nft721), 1, 1), 428);
        assertTrue(ok);
        assertEq(nft721.ownerOf(TOKEN_ID), address(account));

        marketplace.setBehavior(MockNftMarketplace.Behavior.LargeRevertData);
        (ok,) = _execute(
            _nft721Calls(TOKEN_ID + 1, PRICE, address(account)),
            _nftPolicyFor(address(nft721), 1, 1, TOKEN_ID + 1, address(account)),
            429
        );
        assertFalse(ok);
        assertTrue(account.usedNonces(429));
        _assertStrikes(0);
    }

    function testReentrantERC721ReceiverIsContained() public {
        MockReentrantNftReceiver receiver = new MockReentrantNftReceiver(address(account));
        IntentTypesV2.Policy memory policy = _nftPolicyFor(address(nft721), 1, 1, TOKEN_ID, address(receiver));
        IntentTypesV2.ExecutionCall[] memory calls = _nft721Calls(TOKEN_ID, PRICE, address(receiver));
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 430);
        bytes memory signature = _sign(manifest);
        receiver.setPayload(abi.encodeCall(account.executeIntent, (manifest, calls, policy, signature)));

        vm.prank(agent);
        (bool ok,) = account.executeIntent(manifest, calls, policy, signature);

        assertTrue(ok);
        assertTrue(receiver.attempted());
        assertFalse(receiver.reentrySucceeded());
        assertEq(nft721.ownerOf(TOKEN_ID), address(receiver));
    }

    function testReentrantERC1155ReceiverIsContained() public {
        MockReentrantNftReceiver receiver = new MockReentrantNftReceiver(address(account));
        IntentTypesV2.Policy memory policy = _nftPolicyFor(address(nft1155), 2, 3, TOKEN_ID, address(receiver));
        IntentTypesV2.ExecutionCall[] memory calls = _nft1155CallsFor(TOKEN_ID, 3, PRICE, address(receiver));
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, 431);
        bytes memory signature = _sign(manifest);
        receiver.setPayload(abi.encodeCall(account.executeIntent, (manifest, calls, policy, signature)));

        vm.prank(agent);
        (bool ok,) = account.executeIntent(manifest, calls, policy, signature);

        assertTrue(ok);
        assertTrue(receiver.attempted());
        assertFalse(receiver.reentrySucceeded());
        assertEq(nft1155.balanceOf(address(receiver), TOKEN_ID), 3);
    }

    function testImmutableValidatorOnlyValidatesAndCannotMutateOrExecute() public view {
        IntentTypesV2.Policy memory policy = _transferPolicy(address(usdc), recipient, 1);
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(usdc), 0, abi.encodeCall(IERC20.transfer, (recipient, 1)));
        uint256 accountBalance = usdc.balanceOf(address(account));
        uint256 recipientBalance = usdc.balanceOf(recipient);
        address accountOwner = account.owner();

        account.phase4Validator().validateShape(policy, address(account));
        account.phase4Validator().validateCalls(calls, policy, address(account));

        assertEq(usdc.balanceOf(address(account)), accountBalance);
        assertEq(usdc.balanceOf(recipient), recipientBalance);
        assertEq(account.owner(), accountOwner);
        assertFalse(account.usedNonces(432));
        _assertStrikes(0);
    }

    function testValidatorRejectsModuleImpersonation() public {
        IntentTypesV2.Policy memory policy = _nftPolicy(address(nft721), 1, 1);
        policy.module = IntentTypesV2.PolicyModule.Administration;
        Phase4PolicyValidator validator = account.phase4Validator();

        vm.expectRevert(Phase4PolicyValidator.InvalidPolicy.selector);
        validator.validateShape(policy, address(account));
    }

    function testAdminAllowsBoundedNumericAddressPauseAndRoleChanges() public {
        IntentTypesV2.Policy memory policy =
            _adminPolicy(MockAdminProtocol.setParameter.selector, 10, 20, address(0), bytes32(0), 0);
        (bool ok,) = _execute(_one(address(admin), 0, abi.encodeCall(admin.setParameter, (15))), policy, 412);
        assertTrue(ok);
        assertEq(admin.parameter(), 15);

        policy = _adminPolicy(MockAdminProtocol.setApprovedAddress.selector, 0, 0, recipient, bytes32(0), 0);
        (ok,) = _execute(_one(address(admin), 0, abi.encodeCall(admin.setApprovedAddress, (recipient))), policy, 413);
        assertTrue(ok);
        assertEq(admin.approvedAddress(), recipient);

        policy = _adminPolicy(MockAdminProtocol.setPaused.selector, 1, 1, address(0), bytes32(0), 0);
        (ok,) = _execute(_one(address(admin), 0, abi.encodeCall(admin.setPaused, (true))), policy, 414);
        assertTrue(ok);
        assertTrue(admin.paused());

        policy = _adminPolicy(MockAdminProtocol.grantRole.selector, 0, 0, recipient, OPERATOR_ROLE, 0);
        (ok,) =
            _execute(_one(address(admin), 0, abi.encodeCall(admin.grantRole, (OPERATOR_ROLE, recipient))), policy, 415);
        assertTrue(ok);
        assertTrue(admin.roles(OPERATOR_ROLE, recipient));
    }

    function testAdminRejectsOutOfRangeWrongTargetSelectorArgumentAndBatch() public {
        IntentTypesV2.Policy memory policy =
            _adminPolicy(MockAdminProtocol.setParameter.selector, 10, 20, address(0), bytes32(0), 0);
        _assertViolation(_one(address(admin), 0, abi.encodeCall(admin.setParameter, (9))), policy, 434);
        _assertViolation(_one(address(admin), 0, abi.encodeCall(admin.setParameter, (21))), policy, 416);
        _assertViolation(_one(thief, 0, abi.encodeCall(admin.setParameter, (15))), policy, 417);
        _assertViolation(_one(address(admin), 0, abi.encodeCall(admin.setTreasuryLimit, (15))), policy, 418);

        policy = _adminPolicy(MockAdminProtocol.setApprovedAddress.selector, 0, 0, recipient, bytes32(0), 0);
        _assertViolation(_one(address(admin), 0, abi.encodeCall(admin.setApprovedAddress, (thief))), policy, 419);

        policy = _adminPolicy(MockAdminProtocol.grantRole.selector, 0, 0, recipient, OPERATOR_ROLE, 0);
        _assertViolation(_one(address(admin), 0, abi.encodeCall(admin.grantRole, (OPERATOR_ROLE, thief))), policy, 435);
        _assertViolation(
            _one(address(admin), 0, abi.encodeCall(admin.grantRole, (keccak256("WRONG_ROLE"), recipient))), policy, 436
        );

        policy = _adminPolicy(MockAdminProtocol.setApprovedAddress.selector, 0, 0, recipient, bytes32(0), 0);
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(admin), 0, abi.encodeCall(admin.setApprovedAddress, (recipient)));
        calls[1] = _call(address(admin), 0, abi.encodeCall(admin.setPaused, (true)));
        _assertViolation(calls, policy, 420);
    }

    function testAdminTimelockAndDangerousSelectorsAreRejected() public {
        IntentTypesV2.Policy memory policy = _adminPolicy(
            MockAdminProtocol.setTreasuryLimit.selector, 1, 100, address(0), bytes32(0), uint48(block.timestamp + 1)
        );
        _assertViolation(_one(address(admin), 0, abi.encodeCall(admin.setTreasuryLimit, (50))), policy, 421);

        policy = _adminPolicy(MockAdminProtocol.transferOwnership.selector, 0, 0, recipient, bytes32(0), 0);
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(admin), 0, abi.encodeCall(admin.transferOwnership, (recipient)));
        _assertStructurallyInvalid(calls, policy, 422);

        policy = _adminPolicy(MockAdminProtocol.upgradeToAndCall.selector, 0, 0, recipient, bytes32(0), 0);
        calls = _one(address(admin), 0, abi.encodeCall(admin.upgradeToAndCall, (recipient, bytes(""))));
        _assertStructurallyInvalid(calls, policy, 423);
    }

    function testFuzzAdminNumericBounds(uint256 value) public {
        value = bound(value, 10, 20);
        IntentTypesV2.Policy memory policy =
            _adminPolicy(MockAdminProtocol.setParameter.selector, 10, 20, address(0), bytes32(0), 0);
        (bool ok,) = _execute(_one(address(admin), 0, abi.encodeCall(admin.setParameter, (value))), policy, 424);
        assertTrue(ok);
        assertEq(admin.parameter(), value);
    }

    function testFuzzERC1155MinimumQuantity(uint8 quantity) public {
        quantity = uint8(bound(quantity, 1, 20));
        (bool ok,) = _execute(_nft1155Calls(TOKEN_ID, quantity, PRICE), _nftPolicy(address(nft1155), 2, quantity), 425);
        assertTrue(ok);
        assertEq(nft1155.balanceOf(address(account), TOKEN_ID), quantity);
    }

    function testFuzzNftPriceAndTokenId(uint96 rawPrice, uint256 tokenId) public {
        uint256 price = bound(uint256(rawPrice), 1, PRICE);
        IntentTypesV2.Policy memory policy = _nftPolicyFor(address(nft721), 1, 1, tokenId, address(account));
        policy.assets[0].maxSpend = price;
        policy.moduleData = abi.encode(
            address(marketplace),
            address(nft721),
            tokenId,
            keccak256(abi.encode(tokenId)),
            address(usdc),
            price,
            address(account),
            uint256(1),
            uint8(1),
            address(marketplace),
            uint256(0),
            true
        );
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(marketplace), price)));
        calls[1] = _call(
            address(marketplace),
            0,
            abi.encodeCall(marketplace.buyERC721, (address(nft721), tokenId, address(usdc), price, address(account)))
        );

        (bool ok,) = _execute(calls, policy, uint256(keccak256(abi.encode(rawPrice, tokenId))));
        assertTrue(ok);
        assertEq(nft721.ownerOf(tokenId), address(account));
    }

    function testFuzzAdminRoleIdentifier(bytes32 role) public view {
        if (role == bytes32(0)) role = bytes32(uint256(1));
        IntentTypesV2.Policy memory policy =
            _adminPolicy(MockAdminProtocol.grantRole.selector, 0, 0, recipient, role, 0);
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(admin), 0, abi.encodeCall(admin.grantRole, (role, recipient)));

        Phase4PolicyValidator validator = account.phase4Validator();
        validator.validateShape(policy, address(account));
        validator.validateCalls(calls, policy, address(account));
    }

    function testFuzzAdminTimestamp(uint48 validAfter) public {
        validAfter = uint48(bound(validAfter, 0, block.timestamp + 1 days));
        IntentTypesV2.Policy memory policy =
            _adminPolicy(MockAdminProtocol.setParameter.selector, 10, 20, address(0), bytes32(0), validAfter);
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(admin), 0, abi.encodeCall(admin.setParameter, (uint256(15))));
        Phase4PolicyValidator validator = account.phase4Validator();

        if (validAfter > block.timestamp) vm.expectRevert();
        validator.validateCalls(calls, policy, address(account));
    }

    function testFuzzBatchLength(uint8 rawLength) public {
        uint256 length = bound(rawLength, 0, account.MAX_CALLS());
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Batch;
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](length);
        Phase4PolicyValidator validator = account.phase4Validator();

        validator.validateShape(policy, address(account));
        if (length < 2) vm.expectRevert();
        validator.validateCalls(calls, policy, address(account));
    }

    function testFuzzUnsupportedModuleIdentifier(uint8 rawModule) public {
        rawModule = uint8(bound(rawModule, 12, type(uint8).max));
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Batch;
        Phase4PolicyValidator validator = account.phase4Validator();
        bytes memory payload = abi.encodeCall(validator.validateShape, (policy, address(account)));
        assembly ("memory-safe") {
            mstore(add(payload, 100), rawModule)
        }

        (bool ok,) = address(validator).call(payload);
        assertFalse(ok);
    }

    function _nftPolicy(address collection, uint8 standard, uint256 minimum)
        private
        view
        returns (IntentTypesV2.Policy memory policy)
    {
        return _nftPolicyFor(collection, standard, minimum, TOKEN_ID, address(account));
    }

    function _nftPolicyFor(address collection, uint8 standard, uint256 minimum, uint256 tokenId, address receiver)
        private
        view
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.NftPurchase;
        policy.assets = _assets(address(usdc), PRICE, address(account), 0);
        policy.allowances = _allowances(address(usdc), address(marketplace), 0);
        policy.moduleData = abi.encode(
            address(marketplace),
            collection,
            tokenId,
            keccak256(abi.encode(tokenId)),
            address(usdc),
            PRICE,
            receiver,
            minimum,
            standard,
            address(marketplace),
            uint256(0),
            true
        );
    }

    function _nativeNftPolicy(address collection, uint8 standard, uint256 minimum, address receiver)
        private
        view
        returns (IntentTypesV2.Policy memory policy)
    {
        policy.module = IntentTypesV2.PolicyModule.NftPurchase;
        policy.nativeConstraint = IntentTypesV2.NativeConstraint({maxSpend: PRICE, minFinalBalance: 0});
        policy.moduleData = abi.encode(
            address(marketplace),
            collection,
            TOKEN_ID,
            keccak256(abi.encode(TOKEN_ID)),
            address(0),
            PRICE,
            receiver,
            minimum,
            standard,
            address(0),
            uint256(0),
            true
        );
    }

    function _nft721Calls(uint256 tokenId, uint256 price, address receiver)
        private
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(marketplace), PRICE)));
        calls[1] = _call(
            address(marketplace),
            0,
            abi.encodeCall(marketplace.buyERC721, (address(nft721), tokenId, address(usdc), price, receiver))
        );
    }

    function _nft1155Calls(uint256 tokenId, uint256 quantity, uint256 price)
        private
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        return _nft1155CallsFor(tokenId, quantity, price, address(account));
    }

    function _nft1155CallsFor(uint256 tokenId, uint256 quantity, uint256 price, address receiver)
        private
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(usdc), 0, abi.encodeCall(IERC20.approve, (address(marketplace), PRICE)));
        calls[1] = _call(
            address(marketplace),
            0,
            abi.encodeCall(
                marketplace.buyERC1155, (address(nft1155), tokenId, quantity, address(usdc), price, receiver)
            )
        );
    }

    function _nativeNft721Calls(uint256 tokenId, uint256 price, address receiver)
        private
        view
        returns (IntentTypesV2.ExecutionCall[] memory calls)
    {
        calls = _one(
            address(marketplace),
            price,
            abi.encodeCall(marketplace.buyERC721, (address(nft721), tokenId, address(0), price, receiver))
        );
    }

    function _adminPolicy(
        bytes4 selector,
        uint256 minimum,
        uint256 maximum,
        address approved,
        bytes32 role,
        uint48 validAfter
    ) private view returns (IntentTypesV2.Policy memory policy) {
        policy.module = IntentTypesV2.PolicyModule.Administration;
        policy.moduleData = abi.encode(address(admin), selector, minimum, maximum, approved, role, validAfter);
    }

    function _assertStructurallyInvalid(
        IntentTypesV2.ExecutionCall[] memory calls,
        IntentTypesV2.Policy memory policy,
        uint256 nonce
    ) private {
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nonce);
        bytes memory signature = _sign(manifest);
        vm.expectRevert(Phase4PolicyValidator.InvalidPolicy.selector);
        vm.prank(agent);
        account.executeIntent(manifest, calls, policy, signature);
        assertFalse(account.usedNonces(nonce));
    }
}
