// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Base contract: Spending Limit functionality
contract SpendingLimitWallet {
    address public owner;
    uint256 public spendingLimit;
    mapping(address => uint256) public spentAmount;

    event SpendingLimitUpdated(uint256 newLimit);
    event FundsSpent(address spender, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    constructor() {
        owner = msg.sender;
        spendingLimit = 1 ether; // Default spending limit
    }

    function setSpendingLimit(uint256 _limit) external onlyOwner {
        require(_limit > 0, "Spending limit must be positive");
        spendingLimit = _limit;
        emit SpendingLimitUpdated(_limit);
    }

    function spend(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Amount must be greater than zero");
        require(spentAmount[msg.sender] + _amount <= spendingLimit, "Exceeds spending limit");
        require(address(this).balance >= _amount, "Insufficient funds");

        spentAmount[msg.sender] += _amount;
        payable(msg.sender).transfer(_amount);

        emit FundsSpent(msg.sender, _amount);
    }
}

// Child contract: Dead Man’s Switch with Increment Function
contract DeadMansSwitchWallet is SpendingLimitWallet {
    address[] public nominees;
    uint256 public inactivityPeriod;
    uint256 public lastActivity;
    mapping(address => bool) public isNominee;
    uint public count;

    event NomineesUpdated(address[] nominees);
    event FundsTransferred(address[] nominees, uint256 amountPerNominee);
    event ActivityUpdated(uint256 timestamp);
    event CountIncremented(uint count);

    constructor() {
        inactivityPeriod = 6 * 30 * 24 * 60 * 60; // Default: 6 months in seconds
        lastActivity = block.timestamp;
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

    function increment() public onlyOwner {
        count += 1;
        emit CountIncremented(count);
    }

    receive() external payable {}

    function getNominees() external view returns (address[] memory) {
        return nominees;
    }

    function getInactivityPeriod() external view returns (uint256) {
        return inactivityPeriod;
    }
}
