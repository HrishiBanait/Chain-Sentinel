// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChainSentinelRegistry} from "../src/ChainSentinelRegistry.sol";

contract ChainSentinelRegistryTest is Test {
    ChainSentinelRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal reporter = makeAddr("reporter");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    uint256 internal constant THRESHOLD = 1_000e18;
    bytes32 internal constant ALERT_ID = keccak256("alert-1");
    bytes32 internal constant EVIDENCE = keccak256("evidence-1");

    function setUp() public {
        registry = new ChainSentinelRegistry(admin, reporter);
    }

    function _register() internal returns (uint256 id) {
        vm.prank(alice);
        id = registry.registerTarget(treasury, THRESHOLD);
    }

    // ------------------------------------------------------------ constructor
    function test_constructor_setsAdminAndReporter() public view {
        assertEq(registry.admin(), admin);
        assertTrue(registry.isReporter(reporter));
        assertEq(registry.targetCount(), 0);
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(ChainSentinelRegistry.ZeroAddress.selector);
        new ChainSentinelRegistry(address(0), reporter);
    }

    function test_constructor_allowsNoInitialReporter() public {
        ChainSentinelRegistry r = new ChainSentinelRegistry(admin, address(0));
        assertFalse(r.isReporter(address(0)));
        assertFalse(r.isReporter(reporter));
    }

    // -------------------------------------------------------- registerTarget
    function test_registerTarget_storesAndEmits() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit ChainSentinelRegistry.TargetRegistered(1, alice, treasury, THRESHOLD);

        vm.prank(alice);
        uint256 id = registry.registerTarget(treasury, THRESHOLD);

        assertEq(id, 1);
        assertEq(registry.targetCount(), 1);
        ChainSentinelRegistry.Target memory t = registry.getTarget(id);
        assertEq(t.owner, alice);
        assertEq(t.target, treasury);
        assertEq(t.transferThreshold, THRESHOLD);
        assertTrue(t.enabled);
    }

    function test_registerTarget_incrementsIds() public {
        vm.startPrank(alice);
        assertEq(registry.registerTarget(treasury, 1), 1);
        assertEq(registry.registerTarget(makeAddr("other"), 2), 2);
        vm.stopPrank();
        assertEq(registry.targetCount(), 2);
    }

    function test_registerTarget_revertsOnZeroTarget() public {
        vm.prank(alice);
        vm.expectRevert(ChainSentinelRegistry.ZeroAddress.selector);
        registry.registerTarget(address(0), THRESHOLD);
    }

    function test_registerTarget_sameAddressByDifferentOwnersIsIndependent() public {
        vm.prank(alice);
        uint256 a = registry.registerTarget(treasury, 1);
        vm.prank(bob);
        uint256 b = registry.registerTarget(treasury, 2);

        assertTrue(a != b);
        assertEq(registry.getTarget(a).owner, alice);
        assertEq(registry.getTarget(b).owner, bob);
    }

    function testFuzz_registerTarget(address target, uint256 threshold) public {
        vm.assume(target != address(0));
        vm.prank(alice);
        uint256 id = registry.registerTarget(target, threshold);
        ChainSentinelRegistry.Target memory t = registry.getTarget(id);
        assertEq(t.target, target);
        assertEq(t.transferThreshold, threshold);
        assertTrue(t.enabled);
    }

    function test_getTarget_revertsForUnknownId() public {
        vm.expectRevert(ChainSentinelRegistry.TargetNotFound.selector);
        registry.getTarget(0);
        vm.expectRevert(ChainSentinelRegistry.TargetNotFound.selector);
        registry.getTarget(1);
    }

    // ------------------------------------------------------- setTargetEnabled
    function test_setTargetEnabled_ownerCanToggleAndEmits() public {
        uint256 id = _register();

        vm.expectEmit(true, false, false, true, address(registry));
        emit ChainSentinelRegistry.TargetEnabledChanged(id, false);
        vm.prank(alice);
        registry.setTargetEnabled(id, false);
        assertFalse(registry.getTarget(id).enabled);

        vm.expectEmit(true, false, false, true, address(registry));
        emit ChainSentinelRegistry.TargetEnabledChanged(id, true);
        vm.prank(alice);
        registry.setTargetEnabled(id, true);
        assertTrue(registry.getTarget(id).enabled);
    }

    function test_setTargetEnabled_revertsForNonOwner() public {
        uint256 id = _register();
        vm.prank(bob);
        vm.expectRevert(ChainSentinelRegistry.NotTargetOwner.selector);
        registry.setTargetEnabled(id, false);
    }

    function test_setTargetEnabled_adminIsNotTargetOwner() public {
        uint256 id = _register();
        vm.prank(admin);
        vm.expectRevert(ChainSentinelRegistry.NotTargetOwner.selector);
        registry.setTargetEnabled(id, false);
    }

    function test_setTargetEnabled_revertsForUnknownTarget() public {
        vm.prank(alice);
        vm.expectRevert(ChainSentinelRegistry.TargetNotFound.selector);
        registry.setTargetEnabled(99, false);
    }

    // ---------------------------------------------------- setTransferThreshold
    function test_setTransferThreshold_ownerCanUpdateAndEmits() public {
        uint256 id = _register();

        vm.expectEmit(true, false, false, true, address(registry));
        emit ChainSentinelRegistry.TransferThresholdChanged(id, THRESHOLD, 5);
        vm.prank(alice);
        registry.setTransferThreshold(id, 5);

        assertEq(registry.getTarget(id).transferThreshold, 5);
    }

    function test_setTransferThreshold_revertsForNonOwner() public {
        uint256 id = _register();
        vm.prank(bob);
        vm.expectRevert(ChainSentinelRegistry.NotTargetOwner.selector);
        registry.setTransferThreshold(id, 5);
    }

    function test_setTransferThreshold_revertsForUnknownTarget() public {
        vm.prank(alice);
        vm.expectRevert(ChainSentinelRegistry.TargetNotFound.selector);
        registry.setTransferThreshold(99, 5);
    }

    // ------------------------------------------------------ reporter admin
    function test_setReporter_adminCanAddAndEmits() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit ChainSentinelRegistry.ReporterUpdated(bob, true);
        vm.prank(admin);
        registry.setReporter(bob, true);
        assertTrue(registry.isReporter(bob));
    }

    function test_setReporter_revertsForNonAdmin() public {
        vm.prank(alice);
        vm.expectRevert(ChainSentinelRegistry.NotAdmin.selector);
        registry.setReporter(bob, true);
    }

    function test_setReporter_revertsOnZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ChainSentinelRegistry.ZeroAddress.selector);
        registry.setReporter(address(0), true);
    }

    function test_setReporter_revokedReporterCannotPublish() public {
        uint256 id = _register();
        vm.prank(admin);
        registry.setReporter(reporter, false);

        vm.prank(reporter);
        vm.expectRevert(ChainSentinelRegistry.NotReporter.selector);
        registry.publishAlert(ALERT_ID, id, EVIDENCE, ChainSentinelRegistry.Severity.High);
    }

    function test_admin_isNotAutomaticallyReporter() public {
        uint256 id = _register();
        vm.prank(admin);
        vm.expectRevert(ChainSentinelRegistry.NotReporter.selector);
        registry.publishAlert(ALERT_ID, id, EVIDENCE, ChainSentinelRegistry.Severity.High);
    }

    // ------------------------------------------------- two-step admin transfer
    function test_adminTransfer_twoStepFlow() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit ChainSentinelRegistry.AdminTransferStarted(admin, bob);
        vm.prank(admin);
        registry.transferAdmin(bob);
        assertEq(registry.admin(), admin); // unchanged until accepted
        assertEq(registry.pendingAdmin(), bob);

        vm.expectEmit(true, true, false, true, address(registry));
        emit ChainSentinelRegistry.AdminTransferred(admin, bob);
        vm.prank(bob);
        registry.acceptAdmin();

        assertEq(registry.admin(), bob);
        assertEq(registry.pendingAdmin(), address(0));

        vm.prank(admin); // old admin lost power
        vm.expectRevert(ChainSentinelRegistry.NotAdmin.selector);
        registry.setReporter(alice, true);
    }

    function test_adminTransfer_wrongAcceptorReverts() public {
        vm.prank(admin);
        registry.transferAdmin(bob);
        vm.prank(alice);
        vm.expectRevert(ChainSentinelRegistry.NotPendingAdmin.selector);
        registry.acceptAdmin();
    }

    function test_adminTransfer_nonAdminCannotStart() public {
        vm.prank(alice);
        vm.expectRevert(ChainSentinelRegistry.NotAdmin.selector);
        registry.transferAdmin(bob);
    }

    function test_adminTransfer_zeroAddressReverts() public {
        vm.prank(admin);
        vm.expectRevert(ChainSentinelRegistry.ZeroAddress.selector);
        registry.transferAdmin(address(0));
    }

    function test_acceptAdmin_revertsWhenNothingPending() public {
        vm.prank(alice);
        vm.expectRevert(ChainSentinelRegistry.NotPendingAdmin.selector);
        registry.acceptAdmin();
    }

    // -------------------------------------------------------- publishAlert
    function test_publishAlert_reporterStoresAndEmits() public {
        uint256 id = _register();
        vm.warp(1_700_000_000);

        vm.expectEmit(true, true, true, true, address(registry));
        emit ChainSentinelRegistry.AlertPublished(
            ALERT_ID, id, treasury, EVIDENCE, ChainSentinelRegistry.Severity.High, reporter
        );
        vm.prank(reporter);
        registry.publishAlert(ALERT_ID, id, EVIDENCE, ChainSentinelRegistry.Severity.High);

        assertTrue(registry.alertExists(ALERT_ID));
        ChainSentinelRegistry.AlertRecord memory a = registry.getAlert(ALERT_ID);
        assertEq(a.targetId, id);
        assertEq(a.evidenceHash, EVIDENCE);
        assertEq(uint8(a.severity), uint8(ChainSentinelRegistry.Severity.High));
        assertEq(a.reporter, reporter);
        assertEq(a.publishedAt, 1_700_000_000);
    }

    function test_publishAlert_revertsForUnauthorizedCallers() public {
        uint256 id = _register();

        vm.prank(alice); // the target owner is not a reporter
        vm.expectRevert(ChainSentinelRegistry.NotReporter.selector);
        registry.publishAlert(ALERT_ID, id, EVIDENCE, ChainSentinelRegistry.Severity.Low);

        vm.prank(bob);
        vm.expectRevert(ChainSentinelRegistry.NotReporter.selector);
        registry.publishAlert(ALERT_ID, id, EVIDENCE, ChainSentinelRegistry.Severity.Low);

        assertFalse(registry.alertExists(ALERT_ID));
    }

    function test_publishAlert_revertsOnDuplicateAlertId() public {
        uint256 id = _register();
        vm.startPrank(reporter);
        registry.publishAlert(ALERT_ID, id, EVIDENCE, ChainSentinelRegistry.Severity.Low);

        vm.expectRevert(ChainSentinelRegistry.AlertAlreadyPublished.selector);
        registry.publishAlert(ALERT_ID, id, keccak256("different"), ChainSentinelRegistry.Severity.Critical);
        vm.stopPrank();

        // The original record is untouched.
        assertEq(registry.getAlert(ALERT_ID).evidenceHash, EVIDENCE);
    }

    function test_publishAlert_revertsOnZeroAlertId() public {
        uint256 id = _register();
        vm.prank(reporter);
        vm.expectRevert(ChainSentinelRegistry.ZeroAlertId.selector);
        registry.publishAlert(bytes32(0), id, EVIDENCE, ChainSentinelRegistry.Severity.Low);
    }

    function test_publishAlert_revertsOnZeroEvidenceHash() public {
        uint256 id = _register();
        vm.prank(reporter);
        vm.expectRevert(ChainSentinelRegistry.ZeroEvidenceHash.selector);
        registry.publishAlert(ALERT_ID, id, bytes32(0), ChainSentinelRegistry.Severity.Low);
    }

    function test_publishAlert_revertsForUnknownTarget() public {
        vm.startPrank(reporter);
        vm.expectRevert(ChainSentinelRegistry.TargetNotFound.selector);
        registry.publishAlert(ALERT_ID, 0, EVIDENCE, ChainSentinelRegistry.Severity.Low);
        vm.expectRevert(ChainSentinelRegistry.TargetNotFound.selector);
        registry.publishAlert(ALERT_ID, 42, EVIDENCE, ChainSentinelRegistry.Severity.Low);
        vm.stopPrank();
    }

    function test_publishAlert_revertsForDisabledTarget() public {
        uint256 id = _register();
        vm.prank(alice);
        registry.setTargetEnabled(id, false);

        vm.prank(reporter);
        vm.expectRevert(ChainSentinelRegistry.TargetDisabled.selector);
        registry.publishAlert(ALERT_ID, id, EVIDENCE, ChainSentinelRegistry.Severity.Low);
    }

    function test_publishAlert_revertsOnOutOfRangeSeverity() public {
        uint256 id = _register();
        bytes memory data =
            abi.encodeWithSelector(ChainSentinelRegistry.publishAlert.selector, ALERT_ID, id, EVIDENCE, uint8(9));

        vm.prank(reporter);
        (bool ok,) = address(registry).call(data);

        assertFalse(ok);
        assertFalse(registry.alertExists(ALERT_ID));
    }

    function testFuzz_publishAlert_distinctIdsSucceedAndRepeatsRevert(bytes32 a, bytes32 b) public {
        vm.assume(a != bytes32(0) && b != bytes32(0) && a != b);
        uint256 id = _register();

        vm.startPrank(reporter);
        registry.publishAlert(a, id, EVIDENCE, ChainSentinelRegistry.Severity.Info);
        registry.publishAlert(b, id, EVIDENCE, ChainSentinelRegistry.Severity.Info);
        vm.expectRevert(ChainSentinelRegistry.AlertAlreadyPublished.selector);
        registry.publishAlert(a, id, EVIDENCE, ChainSentinelRegistry.Severity.Info);
        vm.stopPrank();
    }

    function test_getAlert_revertsForUnknownAlert() public {
        vm.expectRevert(ChainSentinelRegistry.AlertNotFound.selector);
        registry.getAlert(ALERT_ID);
        assertFalse(registry.alertExists(ALERT_ID));
    }
}
