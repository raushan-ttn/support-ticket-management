import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import config from './index';

const pool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  user: config.postgres.user,
  password: config.postgres.password,
  database: config.postgres.database,
  min: config.postgres.poolMin,
  max: config.postgres.poolMax,
  idleTimeoutMillis: config.postgres.idleTimeoutMs,
  connectionTimeoutMillis: config.postgres.connectionTimeoutMs,
  ssl: config.postgres.ssl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[Postgres] Unexpected pool error:', err.message);
});

export async function connectPostgres(): Promise<void> {
  const client = await pool.connect();
  const result = await client.query<{ now: Date }>('SELECT NOW() as now');
  client.release();
  console.log(`[Postgres] Connected — server time: ${result.rows[0].now}`);
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(sql, params);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function disconnectPostgres(): Promise<void> {
  await pool.end();
  console.log('[Postgres] Pool closed');
}

export default pool;
