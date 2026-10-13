import nodemailer from 'nodemailer';
import 'dotenv/config';

// Clean password of any surrounding quotes if present
const emailUser = process.env.EMAIL_USER?.trim();
const emailPass = process.env.EMAIL_PASS ? process.env.EMAIL_PASS.replace(/^["']|["']$/g, '').trim() : undefined;

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false, // Port 587 uses STARTTLS
  auth: {
    user: emailUser,
    pass: emailPass,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 5000,
});

export default transporter;