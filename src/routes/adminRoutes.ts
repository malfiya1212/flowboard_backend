import { Router } from 'express';
import { getAllUsers, updateUserRole } from '../controllers/adminController.js';
import { verifyToken } from '../middleware/authMiddlware.js';
import { verifyAdmin } from '../middleware/adminMiddleware.js';

const router = Router();

// All routes here require valid token AND Admin role
router.use(verifyToken, verifyAdmin);

router.get('/users', getAllUsers);
router.patch('/users/:id/role', updateUserRole);

export default router;