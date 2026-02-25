import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../config/database.js';
import { encrypt, decrypt } from '../lib/encryption.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      'SELECT id, email, name, desired_job_title, contact, career_objective, education, experience, skills, custom_sections, profile_image_url, is_admin, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    ) as [Array<{
      id: number;
      email: string;
      name: string;
      desired_job_title: string | null;
      contact: string | null;
      career_objective: string | null;
      education: string | null;
      experience: string | null;
      skills: string | null;
      custom_sections: string | null;
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
      desiredJobTitle: u.desired_job_title != null ? (decrypt(u.desired_job_title) || u.desired_job_title) : null,
      contact: u.contact ? parseJson(u.contact) : null,
      careerObjective: decrypt(u.career_objective) || u.career_objective,
      education: u.education ? parseJson(u.education) : null,
      experience: u.experience ? parseJson(u.experience) : null,
      skills: u.skills ? parseJson(u.skills) : null,
      customSections: u.custom_sections ? parseJson(u.custom_sections) : null,
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
    const { name, desiredJobTitle, contact, careerObjective, education, experience, skills, customSections } = req.body;

    const db = await getDb();

    const updates: string[] = [];
    const values: unknown[] = [];

    if (name != null) {
      updates.push('name = ?');
      values.push(encrypt(String(name)));
    }
    if (desiredJobTitle != null) {
      updates.push('desired_job_title = ?');
      values.push(desiredJobTitle === '' ? null : encrypt(String(desiredJobTitle)));
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
    if (customSections != null) {
      updates.push('custom_sections = ?');
      values.push(encrypt(JSON.stringify(customSections)));
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

userRoutes.post('/me/suggest-profile', authMiddleware, async (req, res, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }
    const { desiredJobTitle, name, education, experience, skills } = req.body;
    const jobTitle = typeof desiredJobTitle === 'string' ? desiredJobTitle.trim() : '';
    if (!jobTitle) {
      res.status(400).json({ error: 'desiredJobTitle is required' });
      return;
    }
    const edu = Array.isArray(education) ? education : [];
    const exp = Array.isArray(experience) ? experience : [];
    const sk = Array.isArray(skills) ? skills : [];
    const userContent = `Desired job title: ${jobTitle}
Name: ${name || 'Not provided'}
Education: ${JSON.stringify(edu)}
Experience: ${JSON.stringify(exp)}
Current skills: ${sk.join(', ') || 'None'}

Respond with JSON only: { "skills": ["skill1", "skill2", ...], "careerObjective": "2-4 sentence paragraph" }
Suggest relevant skills (technical and soft) and a concise career objective for this role.`;
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a career coach. Output valid JSON only, no markdown.' },
        { role: 'user', content: userContent },
      ],
      temperature: 0.6,
      max_tokens: 800,
    });
    const text = completion.choices[0]?.message?.content?.trim() || '{}';
    const jsonStr = text.replace(/^```json\s*|\s*```$/g, '').trim();
    const parsed = JSON.parse(jsonStr) as { skills?: string[]; careerObjective?: string };
    res.json({
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      careerObjective: typeof parsed.careerObjective === 'string' ? parsed.careerObjective : '',
    });
  } catch (error) {
    next(error);
  }
});

userRoutes.post('/me/suggest-job-description', authMiddleware, async (req, res, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }
    const { desiredJobTitle } = req.body;
    const jobTitle = typeof desiredJobTitle === 'string' ? desiredJobTitle.trim() : '';
    if (!jobTitle) {
      res.status(400).json({ error: 'desiredJobTitle is required' });
      return;
    }
    const userContent = `Generate a realistic job description for the role: "${jobTitle}".
Include: job title, company overview (generic), key responsibilities (5-7 bullets), required qualifications/skills, and preferred experience. Output plain text, no JSON.`;
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an HR specialist. Write a professional job description.' },
        { role: 'user', content: userContent },
      ],
      temperature: 0.6,
      max_tokens: 600,
    });
    const jobDescription = completion.choices[0]?.message?.content?.trim() || '';
    res.json({ jobDescription });
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
