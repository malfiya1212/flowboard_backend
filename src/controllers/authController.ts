import type { Request, Response } from 'express';
import { pool } from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { AuthRequest } from '../middleware/authMiddlware.ts';

const JWT_SECRET: string = process.env.JWT_SECRET || 'flowboard_enterprise_super_secret_key_2026';

export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body;

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      res.status(400).json({ error: 'User with this email already exists.' });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // SECURITY FIX: Always force 'Developer' (or 'Pending') upon public registration. 
    // Users cannot assign themselves 'Admin' or 'Scrum Master' during signup.
    const assignedRole = 'Developer'; 
    const initialStatus = 'Active'; // or 'Pending' if you want email/admin verification first

    const newUser = await pool.query(
      'INSERT INTO users (name, email, password, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, status, created_at',
      [name, email, hashedPassword, assignedRole, initialStatus]
    );

    res.status(201).json({
      message: 'Employee registered successfully. Awaiting Admin role assignment.',
      user: newUser.rows[0],
    });
  } catch (error) {
    console.error('[Signup Error]', error);
    res.status(500).json({ error: 'Server error during signup.' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const user = result.rows[0];

    if (user.status !== 'Active') {
      res.status(403).json({ error: 'This account has been deactivated by an Administrator.' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
};

export const getCurrentUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const result = await pool.query(
      'SELECT id, name, email, role, status, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.status(200).json({ user: result.rows[0] });
  } catch (error) {
    console.error('[Get Me Error]', error);
    res.status(500).json({ error: 'Server error fetching user profile.' });
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.status(200).json({ message: 'Logged out successfully.' });
  } catch (error) {
    console.error('[Logout Error]', error);
    res.status(500).json({ error: 'Server error during logout.' });
  }
};