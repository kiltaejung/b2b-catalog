require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../server/config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Database schema applied.');
}

main().catch((err) => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
