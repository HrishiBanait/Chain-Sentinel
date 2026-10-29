// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title DemoGuardedToken
/// @notice TEST FIXTURE ONLY. A minimal ERC-20 subset (transfer only) with an owner and
///         a pause switch, used to produce real Transfer, OwnershipTransferred, Paused
///         and Unpaused events for testing ChainSentinel's detection rules. It is not part
///         of the product, has no economic purpose and is not intended for mainnet.
contract DemoGuardedToken {
    string public constant name = "ChainSentinel Demo Token";
    string public constant symbol = "CSDEMO";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    address public owner;
    bool public paused;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address account);
    event Unpaused(address account);

    error NotOwner();
    error TokenPaused();
    error TokenNotPaused();
    error ZeroAddress();
    error InsufficientBalance();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        totalSupply = initialSupply;
        balanceOf[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (paused) revert TokenPaused();
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[msg.sender] = bal - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function pause() external onlyOwner {
        if (paused) revert TokenPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert TokenNotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }
}
