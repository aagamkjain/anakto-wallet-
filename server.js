require('dotenv').config();
const Web3 = require('web3');
const { Pool } = require('pg');
const cron = require('node-cron');
const express = require('express');
const app = express();

app.use(express.json());

const INFURA_URL = process.env.INFURA_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// Error handling for missing environment variables
if (!INFURA_URL || !CONTRACT_ADDRESS || !PRIVATE_KEY || !DATABASE_URL) {
    console.error("Missing environment variables. Ensure all required values are set.");
    process.exit(1);
}

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

// Set up PostgreSQL database connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Create the users table if not exists
(async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                address TEXT PRIMARY KEY,
                last_login BIGINT NOT NULL
            );
        `);
        console.log("Users table ensured.");
    } finally {
        client.release();
    }
})();

// Endpoint to log user activity
app.post('/logActivity', async (req, res) => {
    const { address, timestamp } = req.body;

    try {
        await pool.query(
            `INSERT INTO users (address, last_login) VALUES ($1, $2)
             ON CONFLICT (address) DO UPDATE SET last_login = EXCLUDED.last_login;`,
            [address, timestamp]
        );
        res.send('Activity logged successfully');
    } catch (err) {
        console.error('DB Error:', err);
        res.status(500).send('Database error');
    }
});

// CRON job to check inactivity and transfer funds if needed
cron.schedule('0 0 * * *', async () => {
    console.log("CRON job started...");

    try {
        const inactivityPeriod = await contract.methods.getInactivityPeriod().call();
        const now = Math.floor(Date.now() / 1000);

        const result = await pool.query('SELECT * FROM users');
        for (const row of result.rows) {
            if (now - row.last_login >= inactivityPeriod) {
                try {
                    const estimatedGas = await contract.methods.checkAndTransfer().estimateGas({ from: account.address });

                    const tx = await contract.methods.checkAndTransfer().send({
                        from: account.address,
                        gas: estimatedGas + 20000
                    });

                    console.log(`Funds transferred for ${row.address}: ${tx.transactionHash}`);
                } catch (error) {
                    console.error(`Transfer failed for ${row.address}: ${error.message}`);
                }
            }
        }
    } catch (error) {
        console.error("CRON job error:", error.message);
    }
});

app.listen(3000, () => console.log('Server running on port 3000'));
