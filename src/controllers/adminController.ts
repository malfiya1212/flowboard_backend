import type { Request, Response } from 'express';
import { pool } from '../config/db.js';

// GET /api/admin/users - Admin views all registered users for management
export const getAllUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC'
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('[Admin Get Users Error]', error);
    res.status(500).json({ error: 'Server error fetching users.' });
  }
};

// PATCH /api/admin/users/:id/role - Admin assigns or changes a user's role
export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role, status } = req.body; // e.g. role: 'Scrum Master' or 'Developer', status: 'Active'

    const updatedUser = await pool.query(
      `UPDATE users SET 
        role = COALESCE($1, role), 
        status = COALESCE($2, status) 
      WHERE id = $3 RETURNING id, name, email, role, status`,
      [role, status, id]
    );

    if (updatedUser.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.status(200).json({
      message: 'User role and status updated successfully by Admin.',
      user: updatedUser.rows[0],
    });
  } catch (error) {
    console.error('[Update User Role Error]', error);
    res.status(500).json({ error: 'Server error updating user role.' });
  }
};