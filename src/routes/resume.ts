import { Router } from 'express';
import { getDb } from '../config/database.js';
import { logActivity } from '../lib/activityLog.js';
import { encrypt, decrypt } from '../lib/encryption.js';
import { authMiddleware } from '../middleware/auth.js';
import { optionalAuthMiddleware } from '../middleware/optionalAuth.js';

export const resumeRoutes = Router();

resumeRoutes.post('/', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { resume, coverLetter, jobDescription, tone } = req.body;
    const userId = (req as { userId?: number }).userId ?? null;

    if (!resume || !coverLetter) {
      res.status(400).json({ error: 'resume and coverLetter are required' });
      return;
    }

    const db = await getDb();
    let jobId: number | null = null;

    if (jobDescription && String(jobDescription).trim()) {
      const desc = String(jobDescription).trim();
      const jobTitle = desc.split('\n')[0]?.slice(0, 255) || null;
      const [jobResult] = await db.execute(
        'INSERT INTO jobs (job_title, job_description, company_name) VALUES (?, ?, ?)',
        [jobTitle, desc, null]
      ) as [{ insertId: number }, unknown];
      jobId = jobResult.insertId;
    }

    const [result] = await db.execute(
      'INSERT INTO resumes (user_id, job_id, resume, cover_letter, job_description, tone) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, jobId, encrypt(resume), encrypt(coverLetter), encrypt(jobDescription ?? ''), tone ?? 'formal']
    ) as [{ insertId: number }, unknown];

    const resumeId = result.insertId;

    if (userId) {
      await db.execute(
        'UPDATE users SET updated_at = NOW() WHERE id = ?',
        [userId]
      );
    }

    await logActivity('resume_saved', userId ? String(userId) : 'anonymous', { resumeId });

    res.status(201).json({ id: resumeId, message: 'Resume saved successfully' });
  } catch (error) {
    next(error);
  }
});

resumeRoutes.get('/', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const db = await getDb();

    const [rows] = await db.execute(
      'SELECT id, user_id, resume, cover_letter, job_description, tone, created_at, updated_at FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [userId]
    ) as [Array<{
      id: number;
      user_id: number | null;
      resume: string;
      cover_letter: string;
      job_description: string;
      tone: string;
      created_at: Date;
      updated_at: Date;
    }>, unknown];

    const resumes = (rows || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      resume: decrypt(r.resume),
      coverLetter: decrypt(r.cover_letter),
      jobDescription: decrypt(r.job_description),
      tone: r.tone,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    }));

    res.json(resumes);
  } catch (error) {
    next(error);
  }
});

resumeRoutes.delete('/:id', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid resume id' });
      return;
    }

    const db = await getDb();
    const [rows] = await db.execute(
      'SELECT id FROM resumes WHERE id = ? AND user_id = ?',
      [id, userId]
    ) as [Array<{ id: number }>, unknown];

    if (!rows || rows.length === 0) {
      res.status(404).json({ error: 'Resume not found' });
      return;
    }

    await db.execute('DELETE FROM file_exports WHERE resume_id = ?', [id]);
    await db.execute('DELETE FROM ai_suggestions WHERE resume_id = ?', [id]);
    await db.execute('DELETE FROM resumes WHERE id = ? AND user_id = ?', [id, userId]);

    await logActivity('resume_deleted', String(userId), { resumeId: id });
    res.json({ message: 'Resume deleted' });
  } catch (error) {
    next(error);
  }
});

resumeRoutes.get('/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid resume id' });
      return;
    }

    const [rows] = await db.execute(
      'SELECT id, user_id, resume, cover_letter, job_description, tone, created_at, updated_at FROM resumes WHERE id = ?',
      [id]
    ) as [Array<{
      id: number;
      user_id: number | null;
      resume: string;
      cover_letter: string;
      job_description: string;
      tone: string;
      created_at: Date;
      updated_at: Date;
    }>, unknown];

    if (!rows || rows.length === 0) {
      res.status(404).json({ error: 'Resume not found' });
      return;
    }

    const r = rows[0];
    res.json({
      id: r.id,
      userId: r.user_id,
      resume: decrypt(r.resume),
      coverLetter: decrypt(r.cover_letter),
      jobDescription: decrypt(r.job_description),
      tone: r.tone,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    });
  } catch (error) {
    next(error);
  }
});
