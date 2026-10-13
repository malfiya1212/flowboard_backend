const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'flowboard_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Enate16@',
});

async function run() {
  try {
    // Current date is 2026-10-13
    // Set FB-16 to On Track (Ends Oct 20)
    await pool.query(
      "UPDATE tasks SET start_date = '2026-10-10', end_date = '2026-10-20', due_date = '2026-10-20' WHERE id = 16"
    );
    // Set FB-17 to Overdue by 1 day (Ended Oct 12)
    await pool.query(
      "UPDATE tasks SET start_date = '2026-10-01', end_date = '2026-10-12', due_date = '2026-10-12' WHERE id = 17"
    );
    // Set FB-14 to Due Today (Ends Oct 13)
    await pool.query(
      "UPDATE tasks SET start_date = '2026-10-05', end_date = '2026-10-13', due_date = '2026-10-13' WHERE id = 14"
    );
    // Set FB-12 to On Track (Ends Oct 18)
    await pool.query(
      "UPDATE tasks SET start_date = '2026-10-08', end_date = '2026-10-18', due_date = '2026-10-18' WHERE id = 12"
    );
    // Set FB-13 to On Track (Ends Oct 19)
    await pool.query(
      "UPDATE tasks SET start_date = '2026-10-09', end_date = '2026-10-19', due_date = '2026-10-19' WHERE id = 13"
    );
    // Set FB-15 to On Track (Ends Oct 22)
    await pool.query(
      "UPDATE tasks SET start_date = '2026-10-10', end_date = '2026-10-22', due_date = '2026-10-22' WHERE id = 15"
    );

    console.log('Successfully updated task dates in database to current sprint dates.');
    const res = await pool.query(
      "SELECT id, title, status, assignee, start_date, end_date FROM tasks ORDER BY id ASC"
    );
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Update error:', err);
  } finally {
    await pool.end();
  }
}

run();
