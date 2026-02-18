import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
    const db = await getDb();
    const [rows] = await db.execute(
      'SELECT disabled FROM users WHERE id = ?',
      [decoded.userId]
    ) as [Array<{ disabled?: number }>, unknown];
    if (rows?.[0]?.disabled === 1) {
      res.status(403).json({ error: 'Account has been disabled. Contact support.' });
      return;
    }
    (req as Request & { uid?: string; userId?: number; email?: string }).uid = String(decoded.userId);
    (req as Request & { uid?: string; userId?: number; email?: string }).userId = decoded.userId;
    (req as Request & { uid?: string; userId?: number; email?: string }).email = decoded.email;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
