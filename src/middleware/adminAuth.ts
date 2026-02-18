import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from './auth.js';
import { getDb } from '../config/database.js';

export function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  authMiddleware(req, res, async (err?: unknown) => {
    if (err) return next(err);
    const userId = (req as { userId?: number }).userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      const db = await getDb();
      const [rows] = await db.execute(
        'SELECT is_admin FROM users WHERE id = ?',
        [userId]
      ) as [Array<{ is_admin: number }>, unknown];
      const isAdmin = rows?.[0]?.is_admin === 1;
      if (!isAdmin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });
}
