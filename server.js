require('dotenv').config();
const Web3 = require('web3');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const INFURA_URL = process.env.INFURA_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Error handling for missing .env variables
if (!INFURA_URL || !CONTRACT_ADDRESS || !PRIVATE_KEY) {
    console.error("Missing environment variables. Ensure INFURA_URL, CONTRACT_ADDRESS, and PRIVATE_KEY are set.");
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

const db = new sqlite3.Database('./users.db');

// Endpoint to log user activity
app.post('/logActivity', (req, res) => {
    const { address, timestamp } = req.body;

    db.serialize(() => {
        db.run('INSERT OR REPLACE INTO users (address, lastLogin) VALUES (?, ?)',
            [address, timestamp],
            (err) => {
                if (err) {
                    console.error('DB Error:', err);
                    return res.status(500).send('Database error');
                }
                res.send('Activity logged successfully');
            }
        );
    });
});

// CRON job to check inactivity and transfer funds if needed
cron.schedule('0 0 * * *', async () => {
    console.log("CRON job started...");

    try {
        const inactivityPeriod = await contract.methods.getInactivityPeriod().call();
        const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds

        db.all('SELECT * FROM users', async (err, rows) => {
            if (err) {
                console.error('DB error:', err);
                return;
            }

            await Promise.all(rows.map(async (row) => {
                if (now - row.lastLogin >= inactivityPeriod) {
                    try {
                        const estimatedGas = await contract.methods.checkAndTransfer().estimateGas({ from: account.address });

                        const tx = await contract.methods.checkAndTransfer().send({
                            from: account.address,
                            gas: estimatedGas + 20000 // Adding buffer
                        });

                        console.log(`Funds transferred for ${row.address}: ${tx.transactionHash}`);
                    } catch (error) {
                        console.error(`Transfer failed for ${row.address}: ${error.message}`);
                    }
                }
            }));
        });
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

// Example usage of sendTransaction
// sendTransaction('0xRecipientAddressHere', 0.01);
