import type { Request, Response } from 'express';
import pool from '../config/db.js'; 
import transporter from '../utils/emailService.js';

// GET /api/admin/users
export const getAllUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, status, is_verified, created_at 
       FROM users 
       ORDER BY created_at DESC, id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'Server error fetching users' });
  }
};

// GET /api/admin/role-stats
export const getRoleStats = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT role, COUNT(*)::int AS count 
       FROM users 
       WHERE role IS NOT NULL 
       GROUP BY role`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching role stats:', error);
    res.status(500).json({ message: 'Server error fetching role stats' });
  }
};

// PUT /api/admin/update-role or POST /api/admin/assign-role
export const assignRole = async (req: Request, res: Response): Promise<void> => {
  const { userId, email, role } = req.body; 

  if (!role || (!userId && !email)) {
    res.status(400).json({ message: "Role and userId or email are required." });
    return;
  }

  try {
    // Determine user query condition
    let result;
    if (userId && !isNaN(Number(userId))) {
      result = await pool.query(
        "UPDATE users SET role = $1, status = 'ACTIVE' WHERE id = $2 RETURNING id, email, name, role, status",
        [role, Number(userId)]
      );
    } else if (email) {
      result = await pool.query(
        "UPDATE users SET role = $1, status = 'ACTIVE' WHERE email = $2 RETURNING id, email, name, role, status",
        [role, email]
      );
    } else {
      result = await pool.query(
        "UPDATE users SET role = $1, status = 'ACTIVE' WHERE id::text = $2 OR email = $3 RETURNING id, email, name, role, status",
        [role, String(userId), String(email || '')]
      );
    }

    if (!result || result.rows.length === 0) {
      res.status(404).json({ message: "User not found." });
      return;
    }

    const user = result.rows[0];

    // Send Notification Email to User's Gmail
    const loginLink = `http://localhost:5173/login`;
    
    try {
      await transporter.sendMail({
        from: `"FlowBoard Admin" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: `FlowBoard Account Approved: ${role} Role Assigned`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #ffffff;">
            <h2 style="color: #065f46; margin-top: 0;">Hello ${user.name || 'User'}, great news!</h2>
            <p style="color: #374151; font-size: 15px; line-height: 1.5;">
              Your FlowBoard account registration has been verified and approved by the system administrator.
            </p>
            <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-size: 16px; color: #065f46;">
                <strong>Assigned Role:</strong> <span style="font-size: 18px; font-weight: bold; color: #047857;">${role}</span>
              </p>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #047857;">
                Account Status: Active
              </p>
            </div>
            <p style="color: #374151; font-size: 15px;">
              You can now sign in using your registered credentials. You will be automatically routed to your <strong>${role}</strong> workspace.
            </p>
            <br>
            <div style="text-align: center; margin: 25px 0;">
              <a href="${loginLink}" style="padding: 12px 28px; background-color: #059669; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 15px; display: inline-block;">
                Log In to FlowBoard
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; text-align: center;">
              FlowBoard Team • Automated Account Notification
            </p>
          </div>
        `
      });
      console.log(`Notification email sent successfully to ${user.email} for role ${role}`);
    } catch (mailErr: any) {
      console.warn('Notification email could not be sent (check SMTP settings):', mailErr?.message || mailErr);
    }

    res.status(200).json({ 
      message: `Role '${role}' assigned to ${user.email} and notification email sent.`,
      user 
    });
  } catch (error) {
    console.error('Role assignment error:', error);
    res.status(500).json({ message: "Server error during role assignment." });
  }
};

export const updateUserRole = assignRole;

// ============================================================================
// PROJECT MANAGEMENT CONTROLLERS
// ============================================================================

// GET /api/admin/projects
export const getProjects = async (_req: Request, res: Response): Promise<void> => {
  try {
    // If table is completely empty, optionally seed 2 default projects
    const countCheck = await pool.query('SELECT COUNT(*)::int as count FROM projects');
    if (countCheck.rows[0].count === 0) {
      await pool.query(`
        INSERT INTO projects (name, workspace, status) VALUES 
        ('FlowBoard Core Engine', 'Enterprise Workspace', 'Active'),
        ('Design System & Tokens', 'Design System', 'Active')
      `);
    }

    const result = await pool.query(`
      SELECT 
        p.id, 
        p.name, 
        p.workspace, 
        p.status, 
        p.team_id,
        t.name as team_name,
        p.created_at,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'user_id', u.id,
                'name', u.name,
                'email', u.email,
                'role', pm.role
              )
            )
            FROM project_members pm
            JOIN users u ON pm.user_id = u.id
            WHERE pm.project_id = p.id
          ),
          '[]'::json
        ) as members
      FROM projects p
      LEFT JOIN teams t ON p.team_id = t.id
      ORDER BY p.id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ message: 'Server error fetching projects' });
  }
};

// POST /api/admin/projects
// Action: Create project -> Expected behavior: Saves ONLY the project (no team created)
export const createProject = async (req: Request, res: Response): Promise<void> => {
  const { name, workspace } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ message: 'Project name is required' });
    return;
  }

  try {
    // Saves ONLY the project. Team creation is NOT triggered.
    const result = await pool.query(
      `INSERT INTO projects (name, workspace, status) 
       VALUES ($1, $2, 'Active') 
       RETURNING id, name, workspace, status, team_id, created_at`,
      [name.trim(), (workspace || 'Enterprise Workspace').trim()]
    );
    const project = result.rows[0];
    res.status(201).json({ ...project, team_name: null, members: [] });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ message: 'Server error creating project' });
  }
};

// DELETE /api/admin/projects/:id
export const deleteProject = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [Number(id)]);
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ message: 'Server error deleting project' });
  }
};

// PUT /api/admin/projects/:id/assign-team
// Action: Assign team to project -> Expected behavior: Connects an existing team to the project (manual & optional)
export const assignTeamToProject = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { teamId } = req.body; // number or null to disconnect

  try {
    const targetTeamId = teamId ? Number(teamId) : null;
    const result = await pool.query(
      `UPDATE projects 
       SET team_id = $1 
       WHERE id = $2 
       RETURNING id, name, workspace, status, team_id`,
      [targetTeamId, Number(id)]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Project not found' });
      return;
    }

    let teamName: string | null = null;
    if (targetTeamId) {
      const tRes = await pool.query('SELECT name FROM teams WHERE id = $1', [targetTeamId]);
      if (tRes.rows.length > 0) teamName = tRes.rows[0].name;
    }

    res.json({
      message: targetTeamId ? `Team connected to project successfully.` : `Team disconnected from project.`,
      project: { ...result.rows[0], team_name: teamName }
    });
  } catch (error) {
    console.error('Error assigning team to project:', error);
    res.status(500).json({ message: 'Server error assigning team to project' });
  }
};

// POST /api/admin/projects/:id/members
// Action: Assign users to project -> Expected behavior: Adds selected users to the project
// Action: Assign project roles -> Expected behavior: Controls each member's responsibilities within that project
export const assignUserToProject = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { userId, role } = req.body;

  if (!userId) {
    res.status(400).json({ message: 'User ID is required' });
    return;
  }

  const projectRole = (role || 'Developer').trim();

  try {
    await pool.query(
      `INSERT INTO project_members (project_id, user_id, role) 
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) 
       DO UPDATE SET role = EXCLUDED.role`,
      [Number(id), Number(userId), projectRole]
    );

    const userRes = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [Number(userId)]);
    const userData = userRes.rows[0] || {};

    res.json({
      message: `User assigned to project with role '${projectRole}'.`,
      member: {
        user_id: Number(userId),
        name: userData.name || 'User',
        email: userData.email,
        role: projectRole
      }
    });
  } catch (error) {
    console.error('Error assigning user to project:', error);
    res.status(500).json({ message: 'Server error assigning user to project' });
  }
};

// PUT /api/admin/projects/:id/members/:userId
// Action: Assign project roles -> Expected behavior: Controls each member's responsibilities within that project
export const updateProjectMemberRole = async (req: Request, res: Response): Promise<void> => {
  const { id, userId } = req.params;
  const { role } = req.body;

  if (!role || !role.trim()) {
    res.status(400).json({ message: 'Project role is required' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE project_members 
       SET role = $1 
       WHERE project_id = $2 AND user_id = $3 
       RETURNING project_id, user_id, role`,
      [role.trim(), Number(id), Number(userId)]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'Project member not found' });
      return;
    }

    res.json({
      message: `Project role updated to '${role.trim()}'.`,
      member: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating project member role:', error);
    res.status(500).json({ message: 'Server error updating project role' });
  }
};

// DELETE /api/admin/projects/:id/members/:userId
// Action: Remove a project member -> Expected behavior: Revokes that person's project access without automatically deleting their account
export const removeProjectMember = async (req: Request, res: Response): Promise<void> => {
  const { id, userId } = req.params;

  try {
    // Revokes access from project_members table ONLY. The user's account in users table is NOT touched.
    await pool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [Number(id), Number(userId)]
    );

    res.json({
      message: `User access to project revoked successfully. User account remains intact.`
    });
  } catch (error) {
    console.error('Error removing project member:', error);
    res.status(500).json({ message: 'Server error removing project member' });
  }
};

// ============================================================================
// TEAM MANAGEMENT CONTROLLERS
// ============================================================================

// GET /api/admin/teams
export const getTeams = async (_req: Request, res: Response): Promise<void> => {
  try {
    // If table is empty, seed 2 default teams
    const countCheck = await pool.query('SELECT COUNT(*)::int as count FROM teams');
    if (countCheck.rows[0].count === 0) {
      await pool.query(`
        INSERT INTO teams (name) VALUES 
        ('Core Engineering'),
        ('UI/UX Design Systems')
      `);
    }

    const result = await pool.query(`
      SELECT 
        t.id, 
        t.name, 
        t.lead_id, 
        COALESCE(u.name, 'System Admin') as lead_name,
        t.created_at,
        COALESCE(
          (SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = t.id),
          0
        ) as members_count,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'user_id', mu.id,
                'name', mu.name,
                'email', mu.email,
                'role', mu.role
              )
            )
            FROM team_members tm
            JOIN users mu ON tm.user_id = mu.id
            WHERE tm.team_id = t.id
          ),
          '[]'::json
        ) as members
      FROM teams t
      LEFT JOIN users u ON t.lead_id = u.id
      ORDER BY t.id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ message: 'Server error fetching teams' });
  }
};

// POST /api/admin/teams
// Action: Create team -> Expected behavior: Creates a team ONLY when Admin requests it (manual & optional)
export const createTeam = async (req: Request, res: Response): Promise<void> => {
  const { name, leadId } = req.body;
  if (!name || !name.trim()) {
    res.status(400).json({ message: 'Team name is required' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO teams (name, lead_id) 
       VALUES ($1, $2) 
       RETURNING id, name, lead_id, created_at`,
      [name.trim(), leadId ? Number(leadId) : null]
    );

    const team = result.rows[0];
    let leadName = 'System Admin';
    if (leadId) {
      const uRes = await pool.query('SELECT name FROM users WHERE id = $1', [Number(leadId)]);
      if (uRes.rows.length > 0) leadName = uRes.rows[0].name;
    }

    res.status(201).json({
      ...team,
      lead_name: leadName,
      members_count: 0,
      members: []
    });
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ message: 'Server error creating team' });
  }
};

// DELETE /api/admin/teams/:id
export const deleteTeam = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM teams WHERE id = $1', [Number(id)]);
    res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    console.error('Error deleting team:', error);
    res.status(500).json({ message: 'Server error deleting team' });
  }
};

// POST /api/admin/teams/:id/members
export const addTeamMember = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { userId } = req.body;

  if (!userId) {
    res.status(400).json({ message: 'User ID is required' });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO team_members (team_id, user_id) 
       VALUES ($1, $2) 
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [Number(id), Number(userId)]
    );

    res.json({ message: 'Member added to team successfully' });
  } catch (error) {
    console.error('Error adding team member:', error);
    res.status(500).json({ message: 'Server error adding team member' });
  }
};

// DELETE /api/admin/teams/:id/members/:userId
export const removeTeamMember = async (req: Request, res: Response): Promise<void> => {
  const { id, userId } = req.params;
  try {
    await pool.query(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [Number(id), Number(userId)]
    );
    res.json({ message: 'Member removed from team' });
  } catch (error) {
    console.error('Error removing team member:', error);
    res.status(500).json({ message: 'Server error removing team member' });
  }
};