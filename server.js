require('dotenv').config();
const Web3 = require('web3');
const mongoose = require('mongoose');
const cron = require('node-cron');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const INFURA_URL = process.env.INFURA_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MONGO_URI = process.env.MONGO_URI;

// Error handling for missing .env variables
if (!INFURA_URL || !CONTRACT_ADDRESS || !PRIVATE_KEY || !MONGO_URI) {
    console.error("Missing environment variables. Ensure INFURA_URL, CONTRACT_ADDRESS, PRIVATE_KEY, and MONGO_URI are set.");
    process.exit(1);
}

// Connect to MongoDB
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    });

// Define Mongoose schema for user activity tracking
const userSchema = new mongoose.Schema({
    address: { type: String, unique: true, required: true },
    lastLogin: { type: Number, required: true } // Timestamp in seconds
});
const User = mongoose.model('User', userSchema);

// Setup Web3 and Smart Contract
const web3 = new Web3(new Web3.providers.HttpProvider(INFURA_URL));
const account = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
web3.eth.accounts.wallet.add(account);
web3.eth.defaultAccount = account.address;

const contractABI = [
    {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            }
        ],
        "name": "ActivityUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "address[]",
                "name": "nominees",
                "type": "address[]"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "amountPerNominee",
                "type": "uint256"
            }
        ],
        "name": "FundsTransferred",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "address[]",
                "name": "_nominees",
                "type": "address[]"
            },
            {
                "internalType": "uint256",
                "name": "_inactivityPeriod",
                "type": "uint256"
            }
        ],
        "name": "setNomineesAndPeriod",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "updateActivity",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];
const contract = new web3.eth.Contract(contractABI, CONTRACT_ADDRESS);

// Endpoint to log user activity
app.post('/logActivity', async (req, res) => {
    try {
        const { address, timestamp } = req.body;
        if (!address || !timestamp) {
            return res.status(400).send("Invalid input");
        }

        // Upsert user record (update if exists, insert if not)
        await User.findOneAndUpdate(
            { address },
            { lastLogin: timestamp },
            { upsert: true, new: true }
        );

        res.send('Activity logged successfully');
    } catch (err) {
        console.error("DB Error:", err);
        res.status(500).send("Database error");
    }
});

// CRON job to check inactivity and transfer funds if needed
cron.schedule('0 0 * * *', async () => {
    console.log("CRON job started...");

    try {
        const inactivityPeriod = await contract.methods.getInactivityPeriod().call();
        const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds

        const inactiveUsers = await User.find({
            lastLogin: { $lt: now - inactivityPeriod }
        });

        for (const user of inactiveUsers) {
            try {
                const estimatedGas = await contract.methods.checkAndTransfer().estimateGas({ from: account.address });

                const tx = await contract.methods.checkAndTransfer().send({
                    from: account.address,
                    gas: estimatedGas + 20000 // Adding buffer
                });

                console.log(`Funds transferred for ${user.address}: ${tx.transactionHash}`);

                // Remove user after funds are transferred
                await User.deleteOne({ address: user.address });

            } catch (error) {
                console.error(`Transfer failed for ${user.address}: ${error.message}`);
            }
        }
    } catch (error) {
        console.error("CRON job error:", error.message);
    }
});

// Send Transaction Example
async function sendTransaction(toAddress, amount) {
    try {
        const tx = await web3.eth.sendTransaction({
            from: account.address,
            to: toAddress,
            value: web3.utils.toWei(amount.toString(), 'ether'),
            gas: 21000 // Standard for ETH transfers
        });

        console.log(`Transaction successful: ${tx.transactionHash}`);
    } catch (error) {
        console.error(`Transaction failed: ${error.message}`);
    }
}

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
