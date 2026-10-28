// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChainSentinelRegistry
/// @notice Registry of monitored targets plus an append-only log of alert
///         records (alert id + evidence hash) published by an authorized reporter.
/// @dev A published record proves only that the reporter submitted it and that it
///      was included on-chain. It does NOT prove the alert is correct or that an
///      attack occurred. Detailed alert data stays off-chain.
contract ChainSentinelRegistry {
    enum Severity {
        Info,
        Low,
        Medium,
        High,
        Critical
    }

    struct Target {
        address owner; // who registered and manages this entry
        address target; // monitored contract or treasury address
        uint256 transferThreshold; // raw ERC-20 base units; 0 = large-transfer rule off
        bool enabled;
    }

    struct AlertRecord {
        uint256 targetId;
        bytes32 evidenceHash;
        Severity severity;
        address reporter;
        uint64 publishedAt;
    }

    // ---------------------------------------------------------------- errors
    error ZeroAddress();
    error NotAdmin();
    error NotPendingAdmin();
    error NotReporter();
    error NotTargetOwner();
    error TargetNotFound();
    error TargetDisabled();
    error ZeroAlertId();
    error ZeroEvidenceHash();
    error AlertAlreadyPublished();
    error AlertNotFound();

    // ---------------------------------------------------------------- events
    event TargetRegistered(
        uint256 indexed targetId, address indexed owner, address indexed target, uint256 transferThreshold
    );
    event TargetEnabledChanged(uint256 indexed targetId, bool enabled);
    event TransferThresholdChanged(uint256 indexed targetId, uint256 oldThreshold, uint256 newThreshold);
    event ReporterUpdated(address indexed reporter, bool authorized);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event AlertPublished(
        bytes32 indexed alertId,
        uint256 indexed targetId,
        address indexed target,
        bytes32 evidenceHash,
        Severity severity,
        address reporter
    );

    // --------------------------------------------------------------- storage
    address public admin;
    address public pendingAdmin;
    mapping(address => bool) public isReporter;

    uint256 public targetCount; // ids start at 1
    mapping(uint256 => Target) private _targets;
    mapping(bytes32 => AlertRecord) private _alerts;

    // ------------------------------------------------------------- modifiers
    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyReporter() {
        if (!isReporter[msg.sender]) revert NotReporter();
        _;
    }

    constructor(address initialAdmin, address initialReporter) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        admin = initialAdmin;
        emit AdminTransferred(address(0), initialAdmin);

        if (initialReporter != address(0)) {
            isReporter[initialReporter] = true;
            emit ReporterUpdated(initialReporter, true);
        }
    }

    // ------------------------------------------------------ admin management
    function setReporter(address reporter, bool authorized) external onlyAdmin {
        if (reporter == address(0)) revert ZeroAddress();
        isReporter[reporter] = authorized;
        emit ReporterUpdated(reporter, authorized);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        address previous = admin;
        admin = msg.sender;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, msg.sender);
    }

    // ----------------------------------------------------- target management
    function registerTarget(address target, uint256 transferThreshold) external returns (uint256 targetId) {
        if (target == address(0)) revert ZeroAddress();
        targetId = ++targetCount;
        _targets[targetId] =
            Target({owner: msg.sender, target: target, transferThreshold: transferThreshold, enabled: true});
        emit TargetRegistered(targetId, msg.sender, target, transferThreshold);
    }

    function setTargetEnabled(uint256 targetId, bool enabled) external {
        Target storage t = _ownedTarget(targetId);
        t.enabled = enabled;
        emit TargetEnabledChanged(targetId, enabled);
    }

    function setTransferThreshold(uint256 targetId, uint256 newThreshold) external {
        Target storage t = _ownedTarget(targetId);
        uint256 old = t.transferThreshold;
        t.transferThreshold = newThreshold;
        emit TransferThresholdChanged(targetId, old, newThreshold);
    }

    // ------------------------------------------------------- alert records
    function publishAlert(bytes32 alertId, uint256 targetId, bytes32 evidenceHash, Severity severity)
        external
        onlyReporter
    {
        if (alertId == bytes32(0)) revert ZeroAlertId();
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceHash();
        if (_alerts[alertId].reporter != address(0)) revert AlertAlreadyPublished();

        Target storage t = _targets[targetId];
        if (t.owner == address(0)) revert TargetNotFound();
        if (!t.enabled) revert TargetDisabled();

        _alerts[alertId] = AlertRecord({
            targetId: targetId,
            evidenceHash: evidenceHash,
            severity: severity,
            reporter: msg.sender,
            publishedAt: uint64(block.timestamp)
        });

        emit AlertPublished(alertId, targetId, t.target, evidenceHash, severity, msg.sender);
    }

    // ----------------------------------------------------------------- views
    function getTarget(uint256 targetId) external view returns (Target memory) {
        Target memory t = _targets[targetId];
        if (t.owner == address(0)) revert TargetNotFound();
        return t;
    }

    function getAlert(bytes32 alertId) external view returns (AlertRecord memory) {
        AlertRecord memory a = _alerts[alertId];
        if (a.reporter == address(0)) revert AlertNotFound();
        return a;
    }

    function alertExists(bytes32 alertId) external view returns (bool) {
        return _alerts[alertId].reporter != address(0);
    }

    // -------------------------------------------------------------- internal
    function _ownedTarget(uint256 targetId) internal view returns (Target storage t) {
        t = _targets[targetId];
        if (t.owner == address(0)) revert TargetNotFound();
        if (t.owner != msg.sender) revert NotTargetOwner();
    }
}
