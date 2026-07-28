// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CresnexIntentLockAccountV2} from "../../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../../src/IntentTypesV2.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockERC721} from "../../src/mocks/MockERC721.sol";
import {MockNftMarketplace} from "../../src/mocks/MockNftMarketplace.sol";
import {MockAdminProtocol} from "../../src/mocks/MockAdminProtocol.sol";

contract IntentLockV2Phase4Handler is Test {
    CresnexIntentLockAccountV2 public immutable account;
    MockERC20 public immutable payment;
    MockERC721 public immutable nft;
    MockNftMarketplace public immutable marketplace;
    MockAdminProtocol public immutable admin;
    address public immutable agent;
    uint256 internal immutable ownerKey;
    uint256 public nextNonce = 1;
    uint256 public authenticatedViolations;
    bool public unsafeEffectSurvived;
    bool public evidenceMissing;
    bool public authenticationChangedState;

    constructor(
        CresnexIntentLockAccountV2 account_,
        MockERC20 payment_,
        MockERC721 nft_,
        MockNftMarketplace marketplace_,
        MockAdminProtocol admin_,
        uint256 ownerKey_,
        address agent_
    ) {
        account = account_;
        payment = payment_;
        nft = nft_;
        marketplace = marketplace_;
        admin = admin_;
        ownerKey = ownerKey_;
        agent = agent_;
    }

    function paymentWithoutNft(uint96 rawPrice, uint128 tokenId) external {
        uint256 price = bound(rawPrice, 1, 1_000e6);
        marketplace.setBehavior(MockNftMarketplace.Behavior.NoDelivery);
        IntentTypesV2.Policy memory policy = _nftPolicy(price, tokenId);
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](2);
        calls[0] = _call(address(payment), abi.encodeCall(IERC20.approve, (address(marketplace), price)));
        calls[1] = _call(
            address(marketplace),
            abi.encodeCall(marketplace.buyERC721, (address(nft), tokenId, address(payment), price, address(account)))
        );
        uint256 accountBefore = payment.balanceOf(address(account));
        uint256 marketBefore = payment.balanceOf(address(marketplace));
        (bool ok, bytes32 evidence) = _execute(calls, policy);
        if (
            ok || payment.balanceOf(address(account)) != accountBefore
                || payment.balanceOf(address(marketplace)) != marketBefore
        ) unsafeEffectSurvived = true;
        if (evidence == bytes32(0)) evidenceMissing = true;
        authenticatedViolations++;
    }

    function administrationAboveBound(uint96 maximumSeed, uint96 excessSeed) external {
        uint256 maximum = bound(maximumSeed, 0, type(uint96).max - 1);
        uint256 actual = maximum + bound(excessSeed, 1, type(uint96).max - maximum);
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Administration;
        policy.moduleData = abi.encode(
            address(admin),
            MockAdminProtocol.setParameter.selector,
            uint256(0),
            maximum,
            address(0),
            bytes32(0),
            uint48(0)
        );
        IntentTypesV2.ExecutionCall[] memory calls = _one(address(admin), abi.encodeCall(admin.setParameter, (actual)));
        uint256 beforeValue = admin.parameter();
        (bool ok, bytes32 evidence) = _execute(calls, policy);
        if (ok || admin.parameter() != beforeValue) unsafeEffectSurvived = true;
        if (evidence == bytes32(0)) evidenceMissing = true;
        authenticatedViolations++;
    }

    function dangerousAdministrationSelector(address nextOwner) external {
        if (nextOwner == address(0)) nextOwner = address(1);
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Administration;
        policy.moduleData = abi.encode(
            address(admin),
            MockAdminProtocol.transferOwnership.selector,
            uint256(0),
            uint256(0),
            nextOwner,
            bytes32(0),
            uint48(0)
        );
        IntentTypesV2.ExecutionCall[] memory calls =
            _one(address(admin), abi.encodeCall(admin.transferOwnership, (nextOwner)));
        uint256 nonce = nextNonce++;
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nonce);
        bytes memory signature = _sign(manifest);
        (,, uint64 strikesBefore) = account.agents(agent);
        vm.prank(agent);
        (bool accepted,) =
            address(account).call(abi.encodeCall(account.executeIntent, (manifest, calls, policy, signature)));
        (,, uint64 strikesAfter) = account.agents(agent);
        if (accepted || account.usedNonces(nonce) || strikesAfter != strikesBefore || admin.dangerousCallCount() != 0) {
            authenticationChangedState = true;
        }
    }

    function _execute(IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy)
        private
        returns (bool, bytes32)
    {
        IntentTypesV2.IntentManifest memory manifest = _manifest(calls, policy, nextNonce++);
        bytes memory signature = _sign(manifest);
        vm.prank(agent);
        return account.executeIntent(manifest, calls, policy, signature);
    }

    function _nftPolicy(uint256 price, uint256 tokenId) private view returns (IntentTypesV2.Policy memory policy) {
        policy.module = IntentTypesV2.PolicyModule.NftPurchase;
        policy.assets = new IntentTypesV2.AssetConstraint[](1);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(payment), price, address(account), 0, 0);
        policy.allowances = new IntentTypesV2.AllowanceConstraint[](1);
        policy.allowances[0] = IntentTypesV2.AllowanceConstraint(address(payment), address(marketplace), 0);
        policy.moduleData = abi.encode(
            address(marketplace),
            address(nft),
            tokenId,
            keccak256(abi.encode(tokenId)),
            address(payment),
            price,
            address(account),
            uint256(1),
            uint8(1),
            address(marketplace),
            uint256(0),
            true
        );
    }

    function _manifest(IntentTypesV2.ExecutionCall[] memory calls, IntentTypesV2.Policy memory policy, uint256 nonce)
        private
        view
        returns (IntentTypesV2.IntentManifest memory)
    {
        return IntentTypesV2.IntentManifest(
            2,
            address(account),
            account.owner(),
            agent,
            block.chainid,
            account.hashCalls(calls),
            account.hashPolicy(policy),
            nonce,
            uint48(block.timestamp),
            uint48(block.timestamp + 1 days),
            calls.length > 1,
            1
        );
    }

    function _sign(IntentTypesV2.IntentManifest memory manifest) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, account.hashIntent(manifest));
        return abi.encodePacked(r, s, v);
    }

    function _one(address target, bytes memory data) private pure returns (IntentTypesV2.ExecutionCall[] memory calls) {
        calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = _call(target, data);
    }

    function _call(address target, bytes memory data) private pure returns (IntentTypesV2.ExecutionCall memory) {
        return IntentTypesV2.ExecutionCall(target, 0, data, IntentTypesV2.Operation.Call);
    }
}

contract IntentLockV2Phase4InvariantTest is StdInvariant, Test {
    uint256 private constant OWNER_KEY = 0xA11CE;
    CresnexIntentLockAccountV2 private account;
    MockERC20 private payment;
    IntentLockV2Phase4Handler private handler;
    address private agent = address(0xB0B);

    function setUp() public {
        vm.warp(1_700_000_000);
        address owner = vm.addr(OWNER_KEY);
        account = new CresnexIntentLockAccountV2(owner);
        payment = new MockERC20("Phase 4 payment", "P4", 6);
        MockERC721 nft = new MockERC721();
        MockNftMarketplace marketplace = new MockNftMarketplace();
        MockAdminProtocol admin = new MockAdminProtocol();
        payment.mint(address(account), type(uint128).max);
        vm.startPrank(owner);
        account.registerAgent(agent);
        account.setQuarantineThreshold(type(uint64).max);
        vm.stopPrank();
        handler = new IntentLockV2Phase4Handler(account, payment, nft, marketplace, admin, OWNER_KEY, agent);
        targetContract(address(handler));
    }

    function invariant_NftAndAdministrationEffectsRemainBounded() public view {
        assertFalse(handler.unsafeEffectSurvived());
    }

    function invariant_Phase4ViolationsStrikeOnceAndPersistEvidence() public view {
        (,, uint64 strikes) = account.agents(agent);
        assertEq(uint256(strikes), handler.authenticatedViolations());
        assertFalse(handler.evidenceMissing());
    }

    function invariant_DangerousOrStructuralFailuresDoNotChangeAccountState() public view {
        assertFalse(handler.authenticationChangedState());
    }
}
