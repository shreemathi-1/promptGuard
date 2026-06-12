/**
 * One-time seed script.
 * Run with: node src/patterns/seedPatterns.js
 * Safe to re-run — skips patterns that already exist by name.
 */

require('dotenv').config();
const { pool } = require('../config/db');
const BUILTIN_PATTERNS = require('./builtinPatterns');

async function seedPatterns() {
  console.log('[Seed] Starting pattern seed...');

  let inserted = 0;
  let skipped = 0;

  for (const p of BUILTIN_PATTERNS) {
    try {
      // Check if already exists by name
      const exists = await pool.query(
        'SELECT id FROM scan_patterns WHERE name = $1',
        [p.name]
      );

      if (exists.rowCount > 0) {
        console.log(`[Seed] Skipped (exists): ${p.name}`);
        skipped++;
        continue;
      }

      await pool.query(
        `INSERT INTO scan_patterns
          (name, description, pattern, category, severity, is_active, is_builtin)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
        [
          p.name,
          p.description,
          p.pattern,
          p.category,
          p.severity,
          p.is_builtin,
        ]
      );

      console.log(`[Seed] Inserted: ${p.name}`);
      inserted++;
    } catch (err) {
      console.error(`[Seed] Failed on "${p.name}":`, err.message);
      process.exit(1);
    }
  }

  console.log(`\n[Seed] Done. Inserted: ${inserted} | Skipped: ${skipped}`);
  await pool.end();
}

seedPatterns();