// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DemoGuardedToken} from "../src/fixtures/DemoGuardedToken.sol";

contract DemoGuardedTokenTest is Test {
    DemoGuardedToken internal token;

    address internal deployer = makeAddr("deployer");
    address internal alice = makeAddr("alice");
    uint256 internal constant SUPPLY = 1_000_000e18;

    function setUp() public {
        vm.prank(deployer);
        token = new DemoGuardedToken(SUPPLY);
    }

    function test_constructor_mintsAndSetsOwner() public view {
        assertEq(token.owner(), deployer);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(deployer), SUPPLY);
        assertFalse(token.paused());
    }

    function test_constructor_emitsOwnershipAndMintTransfer() public {
        vm.expectEmit(true, true, false, true);
        emit DemoGuardedToken.OwnershipTransferred(address(0), deployer);
        vm.expectEmit(true, true, false, true);
        emit DemoGuardedToken.Transfer(address(0), deployer, SUPPLY);
        vm.prank(deployer);
        new DemoGuardedToken(SUPPLY);
    }

    function test_transfer_movesBalanceAndEmits() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit DemoGuardedToken.Transfer(deployer, alice, 5e18);
        vm.prank(deployer);
        assertTrue(token.transfer(alice, 5e18));

        assertEq(token.balanceOf(alice), 5e18);
        assertEq(token.balanceOf(deployer), SUPPLY - 5e18);
    }

    function test_transfer_revertsOnInsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert(DemoGuardedToken.InsufficientBalance.selector);
        token.transfer(deployer, 1);
    }

    function test_transfer_revertsOnZeroAddress() public {
        vm.prank(deployer);
        vm.expectRevert(DemoGuardedToken.ZeroAddress.selector);
        token.transfer(address(0), 1);
    }

    function test_pause_ownerPausesAndEmits() public {
        vm.expectEmit(false, false, false, true, address(token));
        emit DemoGuardedToken.Paused(deployer);
        vm.prank(deployer);
        token.pause();
        assertTrue(token.paused());
    }

    function test_pause_blocksTransfersUntilUnpaused() public {
        vm.prank(deployer);
        token.pause();

        vm.prank(deployer);
        vm.expectRevert(DemoGuardedToken.TokenPaused.selector);
        token.transfer(alice, 1);

        vm.expectEmit(false, false, false, true, address(token));
        emit DemoGuardedToken.Unpaused(deployer);
        vm.prank(deployer);
        token.unpause();

        vm.prank(deployer);
        assertTrue(token.transfer(alice, 1));
    }

    function test_pause_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(DemoGuardedToken.NotOwner.selector);
        token.pause();
    }

    function test_pause_doubleActionsRevert() public {
        vm.startPrank(deployer);
        vm.expectRevert(DemoGuardedToken.TokenNotPaused.selector);
        token.unpause();
        token.pause();
        vm.expectRevert(DemoGuardedToken.TokenPaused.selector);
        token.pause();
        vm.stopPrank();
    }

    function test_transferOwnership_updatesOwnerAndEmits() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit DemoGuardedToken.OwnershipTransferred(deployer, alice);
        vm.prank(deployer);
        token.transferOwnership(alice);
        assertEq(token.owner(), alice);
    }

    function test_transferOwnership_newOwnerGainsAndOldLosesControl() public {
        vm.prank(deployer);
        token.transferOwnership(alice);

        vm.prank(alice);
        token.pause();

        vm.prank(deployer);
        vm.expectRevert(DemoGuardedToken.NotOwner.selector);
        token.unpause();
    }

    function test_transferOwnership_revertsForNonOwnerAndZero() public {
        vm.prank(alice);
        vm.expectRevert(DemoGuardedToken.NotOwner.selector);
        token.transferOwnership(alice);

        vm.prank(deployer);
        vm.expectRevert(DemoGuardedToken.ZeroAddress.selector);
        token.transferOwnership(address(0));
    }
}
