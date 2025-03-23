require('dotenv').config();
const express = require('express');
const Web3 = require('web3');
const { Pool } = require('pg');
const cron = require('node-cron');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const INFURA_URL = process.env.INFURA_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

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
            { "indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256" }
        ],
        "name": "ActivityUpdated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": false, "internalType": "address[]", "name": "nominees", "type": "address[]" },
            { "indexed": false, "internalType": "uint256", "name": "amountPerNominee", "type": "uint256" }
        ],
        "name": "FundsTransferred",
        "type": "event"
    },
    {
        "inputs": [
            { "internalType": "address[]", "name": "_nominees", "type": "address[]" },
            { "internalType": "uint256", "name": "_inactivityPeriod", "type": "uint256" }
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
    },
    {
        "inputs": [],
        "name": "getInactivityPeriod",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "checkAndTransfer",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];

const contract = new web3.eth.Contract(contractABI, CONTRACT_ADDRESS);

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ✅ Ensure Wallets & Nominees Tables Exist
(async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_wallets (
                id SERIAL PRIMARY KEY,
                wallet_address VARCHAR(42) UNIQUE NOT NULL,
                balance NUMERIC(18,8) NOT NULL DEFAULT 0.0,
                lower_limit NUMERIC(18,8) NOT NULL DEFAULT 0.0,
                upper_limit NUMERIC(18,8) NOT NULL DEFAULT 0.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS nominees (
                id SERIAL PRIMARY KEY,
                wallet_address VARCHAR(42) REFERENCES user_wallets(wallet_address) ON DELETE CASCADE,
                nominee_name VARCHAR(255) NOT NULL
            );
        `);
        console.log("Database tables ensured.");
    } finally {
        client.release();
    }
})();

// ✅ Save Wallet Address & Balance
app.post('/save-wallet', async (req, res) => {
    const { wallet_address, balance, lower_limit, upper_limit } = req.body;
    try {
        const query = `
            INSERT INTO user_wallets (wallet_address, balance, lower_limit, upper_limit)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (wallet_address) DO UPDATE 
            SET balance = EXCLUDED.balance, lower_limit = EXCLUDED.lower_limit, upper_limit = EXCLUDED.upper_limit
            RETURNING *;
        `;
        const result = await pool.query(query, [wallet_address, balance, lower_limit, upper_limit]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Database Error:", err);
        res.status(500).send("Database error");
    }
});

// ✅ Add Nominees (Max 5)
app.post('/add-nominee', async (req, res) => {
    const { wallet_address, nominee_name } = req.body;
    try {
        const countQuery = `SELECT COUNT(*) FROM nominees WHERE wallet_address = $1;`;
        const countResult = await pool.query(countQuery, [wallet_address]);

        if (parseInt(countResult.rows[0].count) >= 5) {
            return res.status(400).send("Maximum of 5 nominees allowed");
        }

        const query = `INSERT INTO nominees (wallet_address, nominee_name) VALUES ($1, $2) RETURNING *;`;
        const result = await pool.query(query, [wallet_address, nominee_name]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Database Error:", err);
        res.status(500).send("Database error");
    }
});

// ✅ Retrieve Wallet & Nominees
app.get('/wallet/:wallet_address', async (req, res) => {
    const { wallet_address } = req.params;
    try {
        const query = `
            SELECT uw.wallet_address, uw.balance, uw.lower_limit, uw.upper_limit, 
                   ARRAY_AGG(n.nominee_name) AS nominees
            FROM user_wallets uw
            LEFT JOIN nominees n ON uw.wallet_address = n.wallet_address
            WHERE uw.wallet_address = $1
            GROUP BY uw.wallet_address, uw.balance, uw.lower_limit, uw.upper_limit;
        `;
        const result = await pool.query(query, [wallet_address]);
        res.json(result.rows[0] || { message: "Wallet not found" });
    } catch (err) {
        console.error("Database Error:", err);
        res.status(500).send("Database error");
    }
});

// ✅ CRON Job to Check Inactivity & Transfer Funds
cron.schedule('0 0 * * *', async () => {
    console.log("CRON job started...");

    try {
        const inactivityPeriod = await contract.methods.getInactivityPeriod().call();
        const now = Math.floor(Date.now() / 1000);

        const result = await pool.query('SELECT * FROM user_wallets');
        for (const row of result.rows) {
            if (now - row.last_login >= inactivityPeriod) {
                try {
                    const estimatedGas = await contract.methods.checkAndTransfer().estimateGas({ from: account.address });

                    const tx = await contract.methods.checkAndTransfer().send({
                        from: account.address,
                        gas: estimatedGas + 20000
                    });

                    console.log(`Funds transferred for ${row.wallet_address}: ${tx.transactionHash}`);
                } catch (error) {
                    console.error(`Transfer failed for ${row.wallet_address}: ${error.message}`);
                }
            }
        }
    } catch (error) {
        console.error("CRON job error:", error.message);
    }
});

app.listen(5000, () => console.log('Server running on port 5000'));
