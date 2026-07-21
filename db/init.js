require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.end();
  console.log('Database schema applied.');
}

main().catch((err) => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
