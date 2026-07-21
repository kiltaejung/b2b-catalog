const { Pool } = require('pg');

const needsSsl = /sslmode=require|neon\.tech|supabase\.co|render\.com/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
