import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authroute.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import pool from './config/db.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// PostgreSQL connection verification & schema ensure
pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('[Database Error] Unable to connect to PostgreSQL:', err);
  } else {
    console.log('[Database] PostgreSQL connection verified successfully.');
    // Ensure users table and tasks table exist with all required columns
    pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'Developer',
        status VARCHAR(50) DEFAULT 'ACTIVE',
        is_verified BOOLEAN DEFAULT FALSE,
        verification_code VARCHAR(20),
        reset_code VARCHAR(20),
        reset_code_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'Developer';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ACTIVE';

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) DEFAULT 'Backlog',
        priority VARCHAR(50) DEFAULT 'Medium',
        assignee VARCHAR(100),
        due_date VARCHAR(50),
        is_archived BOOLEAN DEFAULT FALSE,
        block_reason TEXT,
        tested_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS block_reason TEXT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tested_by VARCHAR(100);
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date VARCHAR(50);
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_date VARCHAR(50);
    `, (tableErr) => {
      if (tableErr) {
        console.error('[Database Error] Unable to initialize database schema:', tableErr);
      } else {
        console.log('[Database] Database tables and schema verified successfully.');
      }
    });
  }
});

app.listen(PORT, () => {
  console.log(`FlowBoard Backend running on port ${PORT}`);
});

export default app;