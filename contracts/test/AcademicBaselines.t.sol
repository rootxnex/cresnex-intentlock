// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SignatureOnlyAccount} from "../src/baselines/SignatureOnlyAccount.sol";
import {SpendLimitGuardAccount} from "../src/baselines/SpendLimitGuardAccount.sol";
import {PathAndSpendGuardAccount} from "../src/baselines/PathAndSpendGuardAccount.sol";
import {CresnexIntentLockAccountV2} from "../src/CresnexIntentLockAccountV2.sol";
import {IntentTypesV2} from "../src/IntentTypesV2.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract AcademicBaselinesTest is Test {
    uint256 private constant OWNER_KEY = 0xA11CE;
    address private owner;
    address private agent = address(0xB0B);
    address private intended = address(0xCAFE);
    address private thief = address(0xBAD);
    MockERC20 private token;
    SignatureOnlyAccount private baselineA;
    SpendLimitGuardAccount private baselineB;
    PathAndSpendGuardAccount private baselineC;
    CresnexIntentLockAccountV2 private intentLock;

    function setUp() public {
        vm.warp(1_700_000_000);
        owner = vm.addr(OWNER_KEY);
        token = new MockERC20("Experiment Token", "EXP", 18);
        baselineA = new SignatureOnlyAccount(owner);
        baselineB = new SpendLimitGuardAccount(owner);
        baselineC = new PathAndSpendGuardAccount(owner);
        intentLock = new CresnexIntentLockAccountV2(owner);
        token.mint(address(baselineA), 100 ether);
        token.mint(address(baselineB), 100 ether);
        token.mint(address(baselineC), 100 ether);
        token.mint(address(intentLock), 100 ether);
        vm.prank(owner);
        intentLock.registerAgent(agent);
    }

    function testA_WrongRecipientHarmSurvivesWithoutEvidence() public {
        _executeA(thief, 1 ether, 1);
        assertEq(token.balanceOf(thief), 1 ether);
    }

    function testB_WrongRecipientHarmSurvivesSpendLimit() public {
        _executeB(thief, 1 ether, 1 ether, 2);
        assertEq(token.balanceOf(thief), 1 ether);
    }

    function testB_OverspendIsBlocked() public {
        bytes memory signature = _sign(baselineB.authorizationHash(agent, address(token), 1 ether, 3, _deadline()));
        vm.expectRevert(SpendLimitGuardAccount.SpendExceeded.selector);
        vm.prank(agent);
        baselineB.transfer(address(token), thief, 1 ether + 1, 1 ether, 3, _deadline(), signature);
        assertEq(token.balanceOf(thief), 0);
    }

    function testC_WrongRecipientHarmSurvivesApprovedPath() public {
        _executeC(thief, 1 ether, 4);
        assertEq(token.balanceOf(thief), 1 ether);
    }

    function testD_WrongRecipientRollsBackAndPersistsEvidenceAndStrike() public {
        (bool ok, bytes32 evidence) = _executeD(thief, intended, 5);
        assertFalse(ok);
        assertNotEq(evidence, bytes32(0));
        assertEq(token.balanceOf(thief), 0);
        (,, uint64 strikes) = intentLock.agents(agent);
        assertEq(strikes, 1);
    }

    function testGas_A_SignatureOnlyTransfer() public {
        _executeA(intended, 1 ether, 10);
    }

    function testGas_B_SpendLimitTransfer() public {
        _executeB(intended, 1 ether, 1 ether, 11);
    }

    function testGas_C_PathAndSpendTransfer() public {
        _executeC(intended, 1 ether, 12);
    }

    function testGas_D_IntentLockTransfer() public {
        (bool ok,) = _executeD(intended, intended, 13);
        assertTrue(ok);
    }

    function testFuzzGas_A_Benign(uint64 rawNonce) public {
        _executeA(intended, 1 ether, _nonce(rawNonce));
    }

    function testFuzzGas_B_Benign(uint64 rawNonce) public {
        _executeB(intended, 1 ether, 1 ether, _nonce(rawNonce));
    }

    function testFuzzGas_C_Benign(uint64 rawNonce) public {
        _executeC(intended, 1 ether, _nonce(rawNonce));
    }

    function testFuzzGas_D_Benign(uint64 rawNonce) public {
        (bool ok,) = _executeD(intended, intended, _nonce(rawNonce));
        assertTrue(ok);
    }

    function testFuzzGas_A_WrongRecipient(uint64 rawNonce) public {
        _executeA(thief, 1 ether, _nonce(rawNonce));
        assertEq(token.balanceOf(thief), 1 ether);
    }

    function testFuzzGas_B_WrongRecipient(uint64 rawNonce) public {
        _executeB(thief, 1 ether, 1 ether, _nonce(rawNonce));
        assertEq(token.balanceOf(thief), 1 ether);
    }

    function testFuzzGas_C_WrongRecipient(uint64 rawNonce) public {
        _executeC(thief, 1 ether, _nonce(rawNonce));
        assertEq(token.balanceOf(thief), 1 ether);
    }

    function testFuzzGas_D_WrongRecipient(uint64 rawNonce) public {
        (bool ok, bytes32 evidence) = _executeD(thief, intended, _nonce(rawNonce));
        assertFalse(ok);
        assertNotEq(evidence, bytes32(0));
        assertEq(token.balanceOf(thief), 0);
    }

    function _executeA(address recipient, uint256 amount, uint256 nonce) private {
        bytes memory signature = _sign(baselineA.authorizationHash(agent, nonce, _deadline()));
        vm.prank(agent);
        baselineA.execute(
            address(token), 0, abi.encodeCall(IERC20.transfer, (recipient, amount)), nonce, _deadline(), signature
        );
    }

    function _executeB(address recipient, uint256 amount, uint256 maximum, uint256 nonce) private {
        bytes memory signature = _sign(baselineB.authorizationHash(agent, address(token), maximum, nonce, _deadline()));
        vm.prank(agent);
        baselineB.transfer(address(token), recipient, amount, maximum, nonce, _deadline(), signature);
    }

    function _executeC(address recipient, uint256 amount, uint256 nonce) private {
        bytes memory signature = _sign(
            baselineC.authorizationHash(agent, address(token), IERC20.transfer.selector, 1 ether, nonce, _deadline())
        );
        vm.prank(agent);
        baselineC.execute(
            address(token),
            abi.encodeCall(IERC20.transfer, (recipient, amount)),
            IERC20.transfer.selector,
            1 ether,
            nonce,
            _deadline(),
            signature
        );
    }

    function _executeD(address actualRecipient, address policyRecipient, uint256 nonce)
        private
        returns (bool, bytes32)
    {
        IntentTypesV2.ExecutionCall[] memory calls = new IntentTypesV2.ExecutionCall[](1);
        calls[0] = IntentTypesV2.ExecutionCall(
            address(token), 0, abi.encodeCall(IERC20.transfer, (actualRecipient, 1 ether)), IntentTypesV2.Operation.Call
        );
        IntentTypesV2.Policy memory policy;
        policy.module = IntentTypesV2.PolicyModule.Transfer;
        policy.assets = new IntentTypesV2.AssetConstraint[](1);
        policy.assets[0] = IntentTypesV2.AssetConstraint(address(token), 1 ether, policyRecipient, 0, 0);
        policy.moduleData =
            abi.encode(address(token), policyRecipient, 1 ether, false, address(token), IERC20.transfer.selector);
        IntentTypesV2.IntentManifest memory manifest = IntentTypesV2.IntentManifest(
            2,
            address(intentLock),
            owner,
            agent,
            block.chainid,
            intentLock.hashCalls(calls),
            intentLock.hashPolicy(policy),
            nonce,
            uint48(block.timestamp),
            _deadline(),
            false,
            1
        );
        bytes memory signature = _sign(intentLock.hashIntent(manifest));
        vm.prank(agent);
        return intentLock.executeIntent(manifest, calls, policy, signature);
    }

    function _deadline() private view returns (uint48) {
        return uint48(block.timestamp + 1 hours);
    }

    function _nonce(uint64 rawNonce) private pure returns (uint256) {
        return uint256(rawNonce) + 100;
    }

    function _sign(bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
