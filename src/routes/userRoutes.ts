import express from 'express';
import { 
  getUserProfile, 
  getUserTasks, 
  createTask, 
  updateTask, 
  deleteTask, 
  getTeamMembers 
} from '../controllers/userController.js';
import { optionalToken } from '../middleware/authMiddlware.js';

const router = express.Router();

router.use(optionalToken);

// Profile
router.get('/profile', getUserProfile);

// Real Database Tasks API
router.get('/tasks', getUserTasks);
router.post('/tasks', createTask);
router.put('/tasks/:id', updateTask);
router.delete('/tasks/:id', deleteTask);

// Team API
router.get('/team', getTeamMembers);

export default router;