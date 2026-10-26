/**
 * Applies every SQL file in src/db/migrations, in name order.
 * Migrations are written to be idempotent, so this is safe to run on every start.
 *
 * Usage: node src/db/migrate.js
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`[Migrate] Applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

migrate()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[Migrate] Failed:', err.message);
    process.exit(1);
  });
