import type { Request, Response } from 'express';
import pool from '../config/db.js';

interface AuthRequest extends Request {
  user?: { id: number; email?: string; role?: string }; 
}

// GET /api/user/profile
export const getUserProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (userId || userEmail) {
      const result = await pool.query(
        `SELECT id, name, email, role, status, created_at 
         FROM users 
         WHERE id = $1 OR email = $2`,
        [userId || null, userEmail || null]
      );

      if (result.rows.length > 0) {
        res.json(result.rows[0]);
        return;
      }
    }

    res.status(401).json({ message: 'User not authenticated' });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
};

// GET /api/user/tasks
export const getUserTasks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = (req.query.scope as string || '').toLowerCase();
    const queryAssignee = (req.query.assignee as string || '').trim();
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    // Filter by assignee query param if provided
    if (queryAssignee) {
      const result = await pool.query(
        `SELECT id, title, description, status, priority, assignee, due_date, start_date, end_date, is_archived, block_reason, tested_by, created_at 
         FROM tasks 
         WHERE LOWER(COALESCE(assignee, '')) = LOWER($1) 
            OR LOWER(COALESCE(assignee, '')) LIKE '%' || LOWER($1) || '%'
         ORDER BY id ASC`,
        [queryAssignee]
      );
      res.json(result.rows);
      return;
    }

    // Filter by logged-in user identity if scope=mine
    if (scope === 'mine' && (userId || userEmail)) {
      const userRes = await pool.query(
        'SELECT id, name, email FROM users WHERE id = $1 OR email = $2',
        [userId || null, userEmail || null]
      );

      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        const uName = (u.name || '').trim();
        const uEmail = (u.email || '').trim();

        const result = await pool.query(
          `SELECT id, title, description, status, priority, assignee, due_date, start_date, end_date, is_archived, block_reason, tested_by, created_at 
           FROM tasks 
           WHERE (
             ($1 <> '' AND (LOWER(COALESCE(assignee, '')) = LOWER($1) OR LOWER(COALESCE(assignee, '')) LIKE '%' || LOWER($1) || '%'))
             OR ($2 <> '' AND (LOWER(COALESCE(assignee, '')) = LOWER($2) OR LOWER(COALESCE(assignee, '')) LIKE '%' || LOWER($2) || '%'))
           )
           ORDER BY id ASC`,
          [uName, uEmail]
        );
        res.json(result.rows);
        return;
      }
    }

    // Default: Fetch all active tasks from database (Scrum Master, Admin, QA overview, etc.)
    const result = await pool.query(
      `SELECT id, title, description, status, priority, assignee, due_date, start_date, end_date, is_archived, block_reason, tested_by, created_at 
       FROM tasks 
       ORDER BY id ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user tasks:', error);
    res.status(500).json({ message: 'Server error fetching tasks' });
  }
};

// POST /api/user/tasks - Save new task to PostgreSQL
export const createTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      title, description, status, priority, assignee, 
      due_date, dueDate, start_date, startDate, end_date, endDate,
      block_reason, blockReason, tested_by, testedBy 
    } = req.body;
    if (!title) {
      res.status(400).json({ message: 'Title is required' });
      return;
    }
    const finalStartDate = start_date || startDate || null;
    const finalEndDate = end_date || endDate || due_date || dueDate || null;
    const finalDueDate = finalEndDate;
    const finalBlockReason = block_reason !== undefined ? block_reason : (blockReason || null);
    const finalTestedBy = tested_by !== undefined ? tested_by : (testedBy || null);

    const result = await pool.query(
      `INSERT INTO tasks (title, description, status, priority, assignee, due_date, start_date, end_date, is_archived, block_reason, tested_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10)
       RETURNING id, title, description, status, priority, assignee, due_date, start_date, end_date, is_archived, block_reason, tested_by, created_at`,
      [
        title, 
        description || '', 
        status || 'Backlog', 
        priority || 'Medium', 
        assignee || 'Unassigned', 
        finalDueDate,
        finalStartDate,
        finalEndDate,
        finalBlockReason,
        finalTestedBy
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating task in database:', error);
    res.status(500).json({ message: 'Server error creating task' });
  }
};

// PUT /api/user/tasks/:id - Update task in PostgreSQL
export const updateTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id || '';
    const numericId = parseInt(rawId.replace(/^FB-/, ''), 10);
    const { 
      title, description, status, priority, assignee, 
      due_date, dueDate, start_date, startDate, end_date, endDate,
      is_archived, isArchived,
      block_reason, blockReason, tested_by, testedBy 
    } = req.body;

    const finalStartDate = start_date !== undefined ? start_date : (startDate !== undefined ? startDate : null);
    const finalEndDate = end_date !== undefined ? end_date : (endDate !== undefined ? endDate : (due_date !== undefined ? due_date : (dueDate !== undefined ? dueDate : null)));
    const finalDueDate = finalEndDate;
    const finalArchived = is_archived !== undefined ? is_archived : isArchived;
    const finalBlockReason = block_reason !== undefined ? block_reason : blockReason;
    const finalTestedBy = tested_by !== undefined ? tested_by : testedBy;

    // Enforce strict role-based workflow permissions
    const authReq = req as AuthRequest;
    const authRole = (authReq.user?.role || (req.headers['x-user-role'] as string) || '').toLowerCase();
    if (status && authRole) {
      const currentTaskRes = await pool.query('SELECT status FROM tasks WHERE id = $1', [numericId]);
      if (currentTaskRes.rows.length > 0) {
        const curStatus = (currentTaskRes.rows[0].status || '').trim();
        const newStatus = (status || '').trim();

        if (curStatus !== newStatus) {
          const isDeveloper = authRole.includes('dev');
          const isTester = authRole.includes('test');

          if (isDeveloper) {
            // Developers cannot move tasks out of Review Queue
            if (curStatus === 'Review Queue') {
              res.status(403).json({
                message: 'Forbidden: Developers are locked out of tasks in the Review Queue. Only QA Testers can verify and move them.'
              });
              return;
            }
            // Developers cannot mark tasks as Completed directly
            if (newStatus === 'Completed') {
              res.status(403).json({
                message: 'Forbidden: Developers cannot move tasks directly to Completed. Tasks must pass QA verification.'
              });
              return;
            }
          } else if (isTester) {
            // QA Testers only manage tasks in the Review Queue
            if (curStatus !== 'Review Queue') {
              res.status(403).json({
                message: 'Forbidden: QA Testers only manage tasks in the Review Queue.'
              });
              return;
            }
          }
        }
      }
    }

    const result = await pool.query(
      `UPDATE tasks 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           priority = COALESCE($4, priority),
           assignee = COALESCE($5, assignee),
           due_date = COALESCE($6, due_date),
           start_date = COALESCE($7, start_date),
           end_date = COALESCE($8, end_date),
           is_archived = COALESCE($9, is_archived),
           block_reason = COALESCE($10, block_reason),
           tested_by = COALESCE($11, tested_by)
       WHERE id = $12
       RETURNING id, title, description, status, priority, assignee, due_date, start_date, end_date, is_archived, block_reason, tested_by, created_at`,
      [title, description, status, priority, assignee, finalDueDate, finalStartDate, finalEndDate, finalArchived, finalBlockReason, finalTestedBy, numericId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Task not found in database' });
      return;
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task in database:', error);
    res.status(500).json({ message: 'Server error updating task' });
  }
};

// DELETE /api/user/tasks/:id - Permanently delete task from PostgreSQL
export const deleteTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id || '';
    const numericId = parseInt(rawId.replace(/^FB-/, ''), 10);
    await pool.query('DELETE FROM tasks WHERE id = $1', [numericId]);
    res.json({ message: 'Task deleted successfully', id: numericId });
  } catch (error) {
    console.error('Error deleting task from database:', error);
    res.status(500).json({ message: 'Server error deleting task' });
  }
};

// GET /api/user/team - Fetch only Developer and Tester team members (excluding Admin and Scrum Master)
export const getTeamMembers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, status, created_at 
       FROM users 
       WHERE LOWER(COALESCE(role, '')) NOT LIKE '%admin%'
         AND LOWER(COALESCE(role, '')) NOT LIKE '%scrum%'
         AND status = 'ACTIVE'
         AND role IS NOT NULL
       ORDER BY name ASC, email ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching team members:', error);
    res.status(500).json({ message: 'Server error fetching team members' });
  }
};