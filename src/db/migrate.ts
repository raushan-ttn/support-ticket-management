import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import pool, { disconnectPostgres } from '../config/postgres';

async function migrate(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  console.log('[Migrate] Running schema against', process.env.PG_DATABASE);
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('[Migrate] All statements applied successfully');
  } finally {
    client.release();
    await disconnectPostgres();
  }
}

migrate().catch((err: Error) => {
  console.error('[Migrate] Failed:', err.message);
  process.exit(1);
});
