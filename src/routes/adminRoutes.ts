import { Router } from 'express';
import { 
  getAllUsers, 
  getRoleStats, 
  updateUserRole, 
  assignRole,
  getProjects,
  createProject,
  deleteProject,
  assignTeamToProject,
  assignUserToProject,
  updateProjectMemberRole,
  removeProjectMember,
  getTeams,
  createTeam,
  deleteTeam,
  addTeamMember,
  removeTeamMember
} from '../controllers/adminController.js';
import { optionalToken } from '../middleware/authMiddlware.js';

const router = Router();

router.use(optionalToken);

// User & Role Governance
router.get('/users', getAllUsers);
router.get('/role-stats', getRoleStats);
router.put('/update-role', updateUserRole);
router.post('/assign-role', assignRole);

// Project Workspaces (Manual, Saves only project, Connects teams optionally, Assigns users & roles)
router.get('/projects', getProjects);
router.post('/projects', createProject);
router.delete('/projects/:id', deleteProject);
router.put('/projects/:id/assign-team', assignTeamToProject);
router.post('/projects/:id/members', assignUserToProject);
router.put('/projects/:id/members/:userId', updateProjectMemberRole);
router.delete('/projects/:id/members/:userId', removeProjectMember);

// Team Management (Manual & Optional team creation, team members)
router.get('/teams', getTeams);
router.post('/teams', createTeam);
router.delete('/teams/:id', deleteTeam);
router.post('/teams/:id/members', addTeamMember);
router.delete('/teams/:id/members/:userId', removeTeamMember);

export default router;