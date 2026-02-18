import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export async function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.split('Bearer ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
    (req as Request & { uid?: string; userId?: number; email?: string }).uid = String(decoded.userId);
    (req as Request & { uid?: string; userId?: number; email?: string }).userId = decoded.userId;
    (req as Request & { uid?: string; userId?: number; email?: string }).email = decoded.email;
  } catch {
    // Invalid token - continue without auth
  }
  next();
}
