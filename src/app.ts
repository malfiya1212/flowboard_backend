import express, { type Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';



import adminRoutes from './routes/adminRoutes.js'; // <-- Added
import { pool } from './config/db.js';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// API Endpoints

app.use('/api/admin', adminRoutes); // <-- Added: Protected Admin user management

pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('[Database Error] Unable to connect to PostgreSQL:', err);
  } else {
    console.log('[Database] PostgreSQL connection verified successfully.');
  }
});

app.listen(PORT, () => {
  console.log(`[Server] FlowBoard Enterprise Backend running on port ${PORT}`);
});


export default app;