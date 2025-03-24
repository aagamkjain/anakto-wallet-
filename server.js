const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 5000;

app.use(bodyParser.json());

app.post('/setlimits', async (req, res) => {
  const { address, lowerLimit, upperLimit } = req.body;
  
  try {
    const db = new sqlite3.Database('wallet.db');
    
    // Create table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS limits (
      address TEXT PRIMARY KEY,
      lower_limit REAL,
      upper_limit REAL
    )`);

    // Insert or update limits for the address
    db.run(`INSERT OR REPLACE INTO limits (address, lower_limit, upper_limit)
      VALUES (?, ?, ?)`, [address, lowerLimit, upperLimit]);

    db.close();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});