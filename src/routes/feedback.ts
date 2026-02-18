import { Router } from 'express';
import { getDb } from '../config/database.js';
import { logActivity } from '../lib/activityLog.js';
import { encrypt } from '../lib/encryption.js';
import { optionalAuthMiddleware } from '../middleware/optionalAuth.js';

export const feedbackRoutes = Router();

feedbackRoutes.post('/', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { resumeId, rating, comment } = req.body;
    const userId = (req as { userId?: number }).userId ?? null;

    if (!rating || !['positive', 'negative'].includes(rating)) {
      res.status(400).json({ error: 'rating must be "positive" or "negative"' });
      return;
    }

    const db = await getDb();
    await db.execute(
      'INSERT INTO feedback (user_id, resume_id, rating, comment) VALUES (?, ?, ?, ?)',
      [userId, resumeId ?? null, rating, encrypt(comment ?? '')]
    );

    await logActivity('feedback_submitted', userId ? String(userId) : 'anonymous', {
      rating,
      resumeId: resumeId ?? null,
    });

    res.status(201).json({ message: 'Feedback recorded' });
  } catch (error) {
    next(error);
  }
});
