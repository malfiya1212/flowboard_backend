const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'flowboard_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Enate16@',
});

async function run() {
  try {
    const passwordHash = await bcrypt.hash('admin123', 10);
    const targetAccounts = [
      { email: 'admindashiord@gmail.com', name: 'System Admin' },
      { email: 'admindashboard@gmail.com', name: 'System Admin' },
      { email: 'admin@flowboard.com', name: 'System Admin' }
    ];

    for (const acc of targetAccounts) {
      const cleanEmail = acc.email.trim().toLowerCase();
      const existing = await pool.query(
        'SELECT id, email, role FROM users WHERE LOWER(TRIM(email)) = $1',
        [cleanEmail]
      );

      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO users (name, email, password, role, status, is_verified)
           VALUES ($1, $2, $3, 'Admin', 'ACTIVE', true)`,
          [acc.name, cleanEmail, passwordHash]
        );
        console.log(`[CREATED] Admin account created for: ${cleanEmail}`);
      } else {
        await pool.query(
          `UPDATE users 
           SET password = $1, role = 'Admin', status = 'ACTIVE', is_verified = true 
           WHERE id = $2`,
          [passwordHash, existing.rows[0].id]
        );
        console.log(`[UPDATED] Admin account updated for: ${cleanEmail}`);
      }
    }

    const res = await pool.query(
      `SELECT id, name, email, role, status, is_verified FROM users WHERE role = 'Admin'`
    );
    console.log('\n--- ACTIVE ADMIN USERS IN DATABASE ---');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await pool.end();
  }
}

run();
