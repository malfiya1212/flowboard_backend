import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import transporter from '../utils/emailService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// Helper to send OTP verification email with logging and error handling
const sendOtpEmail = async (email: string, name: string, verificationCode: string): Promise<boolean> => {
  console.log(`\n========================================\n[VERIFICATION CODE for ${email}]: ${verificationCode}\n========================================\n`);

  try {
    await transporter.sendMail({
      from: `"FlowBoard" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your FlowBoard Verification Code',
      html: `
        <h2>Welcome to FlowBoard, ${name || 'User'}!</h2>
        <p>Your 6-digit email verification code is:</p>
        <div style="font-size: 26px; font-weight: bold; letter-spacing: 5px; padding: 12px 20px; background: #e5e7eb; color: #111827; border-radius: 6px; display: inline-block;">
          ${verificationCode}
        </div>
        <br><br>
        <p>Please enter this code on the verification page to confirm your account.</p>
        <p><em>Note: An Admin must assign your role before you can log in to your dashboard.</em></p>
      `,
    });
    console.log(`[EMAIL SUCCESS] OTP email sent successfully to ${email}`);
    return true;
  } catch (err: any) {
    console.warn(`[EMAIL WARNING] Could not deliver email to ${email}: ${err?.message || err}`);
    console.warn(`[EMAIL HINT] If using Gmail, ensure 2-Step Verification is active and use a 16-character App Password (https://myaccount.google.com/apppasswords).`);
    return false;
  }
};

// Signup function: Saves user directly to database as Member with ACTIVE status (no verification code required)
export const signup = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, role } = req.body;
  try {
    if (!name || !email || !password) {
      res.status(400).json({ message: 'All fields are required.' });
      return;
    }

    // Default to 'Member' if no role provided
    const userRole = role || 'Member';
    const userStatus = 'ACTIVE';

    // Check if user already exists
    const existing = await pool.query('SELECT id, name, status, role, is_verified FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(400).json({ message: 'An account with this email already exists. Please log in.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Save user directly as verified and ACTIVE member
    const insertResult = await pool.query(
      "INSERT INTO users (name, email, password, status, role, is_verified, verification_code) VALUES ($1, $2, $3, $4, $5, true, NULL) RETURNING id, name, email, role, status, is_verified",
      [name, email, hashedPassword, userStatus, userRole]
    );

    const newUser = insertResult.rows[0];

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ 
      message: 'Account created successfully! You can now log in.',
      token,
      user: newUser
    });
  } catch (error: any) {
    console.error('Signup error:', error);
    if (error?.code === '23505') {
      res.status(400).json({ message: 'An account with this email already exists.' });
      return;
    }
    res.status(500).json({ message: 'Server error during signup.' });
  }
};

// Resend verification code function
export const resendVerificationCode = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  try {
    if (!email) {
      res.status(400).json({ message: 'Email is required.' });
      return;
    }

    const result = await pool.query('SELECT id, name, is_verified FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      res.status(404).json({ message: 'No account found with this email.' });
      return;
    }

    const user = result.rows[0];
    if (user.is_verified) {
      res.status(400).json({ message: 'This account is already verified. You can log in.' });
      return;
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query('UPDATE users SET verification_code = $1 WHERE id = $2', [verificationCode, user.id]);

    const emailSent = await sendOtpEmail(email, user.name, verificationCode);

    if (!emailSent) {
      res.status(502).json({
        message: `Could not send verification email to ${email}. Google rejected SMTP credentials. A 16-character Gmail App Password is required in .env.`,
        email,
        emailSent: false
      });
      return;
    }

    res.status(200).json({
      message: 'A new 6-digit verification code has been sent to your email.',
      email,
      emailSent: true
    });
  } catch (error: any) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ message: 'Server error while resending verification code.' });
  }
};

// Verification function: Verifies the code provided by the user, updates status to PENDING_APPROVAL, and emails the Admin
export const verifyEmailCode = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  const code = req.body.code || req.body.verificationCode;

  try {
    if (!email || !code) {
      res.status(400).json({ message: 'Email and verification code are required.' });
      return;
    }

    const result = await pool.query(
      'SELECT id, name, email, verification_code, is_verified, status, role FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const user = result.rows[0];

    if (user.is_verified) {
      res.status(200).json({ 
        message: 'Account is already verified. Awaiting Admin approval and role assignment.',
        isVerified: true,
        status: user.status
      });
      return;
    }

    if (user.verification_code !== code.toString().trim()) {
      res.status(400).json({ message: 'Invalid or expired verification code.' });
      return;
    }

    // Update status to PENDING_APPROVAL (or preserve ACTIVE if role was already assigned), set verification_code to NULL, and mark is_verified = true
    const nextStatus = user.role ? (user.status || 'ACTIVE') : 'PENDING_APPROVAL';
    await pool.query(
      "UPDATE users SET is_verified = true, status = $1, verification_code = NULL WHERE id = $2",
      [nextStatus, user.id]
    );

    // Automatically notify the Admin via email
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
    const adminDashboardLink = 'http://localhost:5173/admin';

    if (adminEmail) {
      transporter.sendMail({
        from: `"FlowBoard System" <${process.env.EMAIL_USER}>`,
        to: adminEmail,
        subject: `New User Verified - Action Required: Approve Role for ${user.name || user.email}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #ffffff;">
            <h2 style="color: #dc2626; margin-top: 0;">Admin Action Required: User Verified & Awaiting Approval</h2>
            <p style="color: #374151; font-size: 15px; line-height: 1.5;">
              A user has verified their email address and is now awaiting administrator approval and role assignment.
            </p>
            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-size: 14px; color: #991b1b; line-height: 1.6;">
                <strong>Name:</strong> ${user.name || 'N/A'}<br/>
                <strong>Email:</strong> ${user.email}<br/>
                <strong>Status:</strong> <span style="font-weight: bold; color: #dc2626;">PENDING_APPROVAL</span><br/>
                <strong>Email Verified:</strong> Completed
              </p>
            </div>
            <p style="color: #374151; font-size: 14px;">
              Please log in to your Admin Control Center to review this user and assign their role (Admin, Scrum Master, or Developer).
            </p>
            <div style="text-align: center; margin: 25px 0;">
              <a href="${adminDashboardLink}" style="padding: 12px 28px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
                Review in Admin Control Center
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 25px; text-align: center;">
              FlowBoard Identity & Access Management System
            </p>
          </div>
        `,
      }).catch((mailErr: any) => {
        console.warn('Admin notification email could not be sent (check SMTP settings):', mailErr?.message || mailErr);
      });
    }

    res.status(200).json({ 
      message: `Email verified successfully as ${user.role || 'Member'}! You can now log in to your workspace.`,
      isVerified: true,
      status: nextStatus,
      role: user.role
    });
  } catch (error) {
    console.error('Code verification error:', error);
    res.status(500).json({ message: 'Server error during code verification.' });
  }
};

export const verifyCode = verifyEmailCode;

// Signin function
export const signin = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required.' });
      return;
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    const result = await pool.query('SELECT * FROM users WHERE LOWER(TRIM(email)) = $1', [cleanEmail]);
    if (result.rows.length === 0) {
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ message: 'Invalid email or password.' });
      return;
    }

    if (!user.is_verified) {
      // Auto-verify if user exists
      await pool.query('UPDATE users SET is_verified = true WHERE id = $1', [user.id]);
      user.is_verified = true;
    }

    // Default to 'Member' if role is empty or missing
    const assignedRole = user.role || 'Member';

    const token = jwt.sign(
      { id: user.id, email: user.email, role: assignedRole },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: assignedRole,
        status: user.status || 'ACTIVE',
        is_verified: user.is_verified
      }
    });
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({ message: 'Server error during signin.' });
  }
};

// Forgot Password: Generates a 6-digit code, saves to DB (valid 15 mins), and sends via email
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  try {
    if (!email) {
      res.status(400).json({ message: 'Email address is required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Look up user case-insensitively
    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE LOWER(TRIM(email)) = $1',
      [cleanEmail]
    );

    let user = result.rows[0];

    // If account doesn't exist, check if it's the configured system admin email
    if (!user) {
      const systemAdmin = (process.env.EMAIL_USER || '').trim().toLowerCase();
      if (cleanEmail === systemAdmin) {
        const dummyHash = await bcrypt.hash('Admin@12345', 10);
        const insertRes = await pool.query(
          "INSERT INTO users (name, email, password, role, status, is_verified) VALUES ($1, $2, $3, 'Admin', 'ACTIVE', true) RETURNING id, name, email",
          ['System Administrator', cleanEmail, dummyHash]
        );
        user = insertRes.rows[0];
      } else {
        res.status(404).json({ message: `No registered account found with ${cleanEmail}. Please verify your email or sign up first.` });
        return;
      }
    }

    // Generate random 6-digit verification code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    // Valid for 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Save reset_code to database (auto-add columns if missing)
    try {
      await pool.query(
        'UPDATE users SET reset_code = $1, reset_code_expires = $2 WHERE id = $3',
        [resetCode, expiresAt, user.id]
      );
    } catch (_colErr) {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code VARCHAR(20);');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_expires TIMESTAMP;');
      await pool.query(
        'UPDATE users SET reset_code = $1, reset_code_expires = $2 WHERE id = $3',
        [resetCode, expiresAt, user.id]
      );
    }

    console.log(`\n========================================\n[PASSWORD RESET CODE for ${cleanEmail}]: ${resetCode} (Expires in 15m)\n========================================\n`);

    // Send email using Nodemailer
    let emailSent = false;
    try {
      await transporter.sendMail({
        from: `"FlowBoard Security" <${process.env.EMAIL_USER}>`,
        to: cleanEmail,
        subject: 'FlowBoard Password Reset Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #ffffff;">
            <h2 style="color: #0F766E; margin-top: 0;">Password Reset Request</h2>
            <p style="color: #4b5563; font-size: 14px;">Hello ${user.name || 'User'},</p>
            <p style="color: #4b5563; font-size: 14px;">We received a request to reset your FlowBoard password. Please use the following 6-digit verification code:</p>
            <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; padding: 14px 24px; background: #f3f4f6; color: #0F766E; border-radius: 8px; display: inline-block; margin: 16px 0;">
              ${resetCode}
            </div>
            <p style="color: #6b7280; font-size: 12px; margin-top: 10px;">This code is valid for <strong>15 minutes</strong>.</p>
            <p style="color: #9ca3af; font-size: 12px;">If you did not request a password reset, you can safely ignore this email.</p>
          </div>
        `,
      });
      emailSent = true;
      console.log(`[EMAIL SUCCESS] Password reset code sent to ${cleanEmail}`);
    } catch (mailErr: any) {
      console.warn(`[EMAIL WARNING] Could not deliver reset email to ${cleanEmail}:`, mailErr.message);
    }

    res.status(200).json({
      message: emailSent
        ? 'Password reset code has been sent to your email.'
        : `Reset code: ${resetCode}. Enter it below along with your new password.`,
      email: cleanEmail,
      emailSent,
      devCode: resetCode,
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: error?.message || 'Server error processing password reset request.' });
  }
};

// Reset Password: Validates 6-digit code and updates password
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { email, code, newPassword } = req.body;
  try {
    if (!email || !code || !newPassword) {
      res.status(400).json({ message: 'Email, 6-digit code, and new password are required.' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ message: 'Password must be at least 6 characters long.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const result = await pool.query(
      'SELECT id, name, reset_code, reset_code_expires FROM users WHERE LOWER(TRIM(email)) = $1',
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const user = result.rows[0];

    if (!user.reset_code || user.reset_code.toString().trim() !== code.toString().trim()) {
      res.status(400).json({ message: 'Invalid or expired verification code.' });
      return;
    }

    if (user.reset_code_expires && new Date() > new Date(user.reset_code_expires)) {
      res.status(400).json({ message: 'Verification code has expired. Please request a new code.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      'UPDATE users SET password = $1, reset_code = NULL, reset_code_expires = NULL WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.status(200).json({
      message: 'Password has been reset successfully! You can now log in with your new password.',
    });
  } catch (error: any) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: error?.message || 'Server error resetting password.' });
  }
};