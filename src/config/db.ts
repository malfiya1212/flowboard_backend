
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'flowboard_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
});

pool.on('connect', () => {
  console.log('[Database] PostgreSQL connected successfully');
});

pool.on('error', (err) => {
  console.error('[Database Error]', err.message);
});
