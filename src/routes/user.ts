import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../config/database.js';
import { encrypt, decrypt } from '../lib/encryption.js';

const uploadsDir = path.join(process.cwd(), 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const userId = (req as { userId?: number }).userId!;
    const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/gif' ? '.gif' : '.jpg';
    cb(null, `${userId}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'));
  },
});

export const userRoutes = Router();

userRoutes.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const db = await getDb();

    const [rows] = await db.execute(
      'SELECT id, email, name, contact, career_objective, education, experience, skills, profile_image_url, is_admin, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    ) as [Array<{
      id: number;
      email: string;
      name: string;
      contact: string | null;
      career_objective: string | null;
      education: string | null;
      experience: string | null;
      skills: string | null;
      profile_image_url: string | null;
      is_admin: number;
      created_at: Date;
      updated_at: Date;
    }>, unknown];

    if (!rows || rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const u = rows[0];
    const parseJson = (val: string | null) => {
      if (!val) return null;
      const s = decrypt(val);
      if (!s) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };
    res.json({
      uid: String(u.id),
      id: u.id,
      email: u.email,
      name: decrypt(u.name) || u.name,
      contact: u.contact ? parseJson(u.contact) : null,
      careerObjective: decrypt(u.career_objective) || u.career_objective,
      education: u.education ? parseJson(u.education) : null,
      experience: u.experience ? parseJson(u.experience) : null,
      skills: u.skills ? parseJson(u.skills) : null,
      profileImageUrl: u.profile_image_url || null,
      isAdmin: !!u.is_admin,
    });
  } catch (error) {
    next(error);
  }
});

userRoutes.put('/me', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const { name, contact, careerObjective, education, experience, skills } = req.body;

    const db = await getDb();

    const updates: string[] = [];
    const values: unknown[] = [];

    if (name != null) {
      updates.push('name = ?');
      values.push(encrypt(String(name)));
    }
    if (contact != null) {
      updates.push('contact = ?');
      values.push(encrypt(JSON.stringify(contact)));
    }
    if (careerObjective != null) {
      updates.push('career_objective = ?');
      values.push(encrypt(String(careerObjective)));
    }
    if (education != null) {
      updates.push('education = ?');
      values.push(encrypt(JSON.stringify(education)));
    }
    if (experience != null) {
      updates.push('experience = ?');
      values.push(encrypt(JSON.stringify(experience)));
    }
    if (skills != null) {
      updates.push('skills = ?');
      values.push(encrypt(JSON.stringify(skills)));
    }

    if (updates.length > 0) {
      values.push(userId);
      await db.execute(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    res.json({ message: 'Profile updated' });
  } catch (error) {
    next(error);
  }
});

userRoutes.put('/me/avatar', authMiddleware, upload.single('avatar'), async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No image file provided. Use form field "avatar".' });
      return;
    }

    const db = await getDb();
    const imagePath = `/uploads/avatars/${file.filename}`;
    await db.execute('UPDATE users SET profile_image_url = ? WHERE id = ?', [imagePath, userId]);

    res.json({ profileImageUrl: imagePath });
  } catch (error) {
    next(error);
  }
});

userRoutes.delete('/me', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const db = await getDb();

    await db.execute('DELETE FROM feedback WHERE user_id = ?', [userId]);
    await db.execute('DELETE FROM resumes WHERE user_id = ?', [userId]);
    await db.execute('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ message: 'Profile and data deleted' });
  } catch (error) {
    next(error);
  }
});
