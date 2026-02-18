import { Router } from 'express';
import { getDb } from '../config/database.js';
import { optionalAuthMiddleware } from '../middleware/optionalAuth.js';

export const exportRoutes = Router();

exportRoutes.post('/log', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { resumeId, format } = req.body;
    const userId = (req as { userId?: number }).userId ?? null;

    if (!format || !['pdf', 'docx', 'txt'].includes(String(format).toLowerCase())) {
      res.status(400).json({ error: 'format must be pdf, docx, or txt' });
      return;
    }

    const db = await getDb();
    await db.execute(
      'INSERT INTO file_exports (resume_id, user_id, export_format) VALUES (?, ?, ?)',
      [resumeId ?? null, userId, String(format).toLowerCase()]
    );

    res.status(201).json({ message: 'Export logged' });
  } catch (error) {
    next(error);
  }
});
