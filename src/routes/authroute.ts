import { Router } from 'express';
import { 
  signup, 
  signin, 
  verifyCode, 
  verifyEmailCode, 
  resendVerificationCode,
  forgotPassword,
  resetPassword 
} from '../controllers/authController.js';

const router = Router();

router.post('/signup', signup);
router.post('/signin', signin);
router.post('/login', signin);
router.post('/verify-code', verifyCode);
router.post('/verify-email-code', verifyEmailCode);
router.post('/verify', verifyCode);
router.post('/resend-code', resendVerificationCode);
router.post('/resend-otp', resendVerificationCode);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;