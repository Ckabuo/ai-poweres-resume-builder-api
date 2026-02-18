import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendPasswordResetEmail, isEmailConfigured } from '../lib/email.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { validatePassword } from '../lib/password.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8080';
const SALT_ROUNDS = 10;
const RESET_TOKEN_EXPIRY_HOURS = 1;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export const authRoutes = Router();

authRoutes.post('/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      res.status(400).json({ error: pwCheck.error });
      return;
    }

    const db = await getDb();
    const [existing] = await db.execute(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    ) as [unknown[], unknown];
    if (Array.isArray(existing) && existing.length > 0) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await db.execute(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
      [email.toLowerCase(), hash, encrypt(name || '')]
    ) as [{ insertId: number }, unknown];

    const userId = result.insertId;
    const token = jwt.sign(
      { userId, email: email.toLowerCase() },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: userId,
        email: email.toLowerCase(),
        name: name || '',
      },
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'email and password are required' });
      return;
    }

    const db = await getDb();
    const [rows] = await db.execute(
      'SELECT id, email, name, password_hash, is_admin, disabled FROM users WHERE email = ?',
      [email.toLowerCase()]
    ) as [Array<{ id: number; email: string; name: string; password_hash: string; is_admin: number; disabled?: number }>, unknown];

    if (!rows || rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const user = rows[0];
    if (user.disabled === 1) {
      res.status(403).json({ error: 'Account has been disabled. Contact support.' });
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: decrypt(user.name) || user.name,
        isAdmin: !!user.is_admin,
      },
    });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    if (!isEmailConfigured()) {
      res.status(503).json({ error: 'Password reset is not configured. Contact support.' });
      return;
    }

    const db = await getDb();
    const [rows] = await db.execute(
      'SELECT id FROM users WHERE email = ? AND disabled = 0',
      [email.toLowerCase()]
    ) as [Array<{ id: number }>, unknown];

    // Always return same message (don't reveal if email exists)
    const successMessage = 'If an account exists with that email, you will receive a reset link shortly.';

    if (!rows || rows.length === 0) {
      res.json({ message: successMessage });
      return;
    }

    const userId = rows[0].id;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await db.execute(
      'DELETE FROM password_reset_tokens WHERE user_id = ?',
      [userId]
    );
    await db.execute(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [userId, tokenHash, expiresAt]
    );

    const resetLink = `${FRONTEND_URL}/reset-password?token=${token}`;

    try {
      await sendPasswordResetEmail(email.toLowerCase(), resetLink);
    } catch (err) {
      console.error('Failed to send password reset email:', err);
      await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
      res.status(500).json({ error: 'Failed to send reset email. Please try again later.' });
      return;
    }

    res.json({ message: successMessage });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'Reset token is required' });
      return;
    }
    if (!newPassword || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'New password is required' });
      return;
    }
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      res.status(400).json({ error: pwCheck.error });
      return;
    }

    const db = await getDb();
    const tokenHash = hashToken(token);

    const [rows] = await db.execute(
      `SELECT prt.user_id FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = ? AND prt.expires_at > NOW() AND u.disabled = 0`,
      [tokenHash]
    ) as [Array<{ user_id: number }>, unknown];

    if (!rows || rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      return;
    }

    const userId = rows[0].user_id;
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);

    res.json({ message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

authRoutes.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || typeof currentPassword !== 'string') {
      res.status(400).json({ error: 'Current password is required' });
      return;
    }
    if (!newPassword || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'New password is required' });
      return;
    }
    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      res.status(400).json({ error: pwCheck.error });
      return;
    }

    const db = await getDb();
    const [rows] = await db.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [userId]
    ) as [Array<{ password_hash: string }>, unknown];

    if (!rows || rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});
