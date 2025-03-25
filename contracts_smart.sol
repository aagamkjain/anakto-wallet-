// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract DeadMansSwitchWallet {
    address public owner;
    address[] public nominees;
    uint256 public inactivityPeriod;
    uint256 public lastActivity;
    mapping(address => bool) public isNominee;

    event NomineesUpdated(address[] nominees);
    event FundsTransferred(address[] nominees, uint256 amountPerNominee);
    event ActivityUpdated(uint256 timestamp);

    constructor() {
        owner = msg.sender;
        inactivityPeriod = 6 * 30 * 24 * 60 * 60; // Default: 6 months in seconds
        lastActivity = block.timestamp;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    function setNomineesAndPeriod(address[] memory _nominees, uint256 _inactivityPeriod) external onlyOwner {
        require(_nominees.length >= 1 && _nominees.length <= 5, "Nominees must be 1-5");
        require(_inactivityPeriod > 0, "Inactivity period must be positive");
        
        for (uint i = 0; i < nominees.length; i++) {
            isNominee[nominees[i]] = false;
        }
        
        nominees = _nominees;
        inactivityPeriod = _inactivityPeriod;
        
        for (uint i = 0; i < _nominees.length; i++) {
            isNominee[_nominees[i]] = true;
        }
        
        emit NomineesUpdated(_nominees);
        updateActivity();
    }

    function updateActivity() public onlyOwner {
        lastActivity = block.timestamp;
        emit ActivityUpdated(lastActivity);
    }

    function checkAndTransfer() external {
        require(block.timestamp >= lastActivity + inactivityPeriod, "User still active");
        require(address(this).balance > 0, "No funds to transfer");
        
        uint256 amountPerNominee = address(this).balance / nominees.length;
        for (uint i = 0; i < nominees.length; i++) {
            payable(nominees[i]).transfer(amountPerNominee);
        }
        
        emit FundsTransferred(nominees, amountPerNominee);
    }

    receive() external payable {}

    function getNominees() external view returns (address[] memory) {
        return nominees;
    }

    function getInactivityPeriod() external view returns (uint256) {
        return inactivityPeriod;
    }
}