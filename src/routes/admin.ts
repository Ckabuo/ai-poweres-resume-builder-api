import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import { getDb } from '../config/database.js';
import { decrypt } from '../lib/encryption.js';

export const adminRoutes = Router();

adminRoutes.get('/check', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId;
    if (!userId) {
      res.json({ isAdmin: false });
      return;
    }
    const db = await getDb();
    const [rows] = await db.execute(
      'SELECT is_admin FROM users WHERE id = ?',
      [userId]
    ) as [Array<{ is_admin: number }>, unknown];
    res.json({ isAdmin: rows?.[0]?.is_admin === 1 });
  } catch (error) {
    next(error);
  }
});

adminRoutes.use(adminAuthMiddleware);

adminRoutes.get('/users', async (req, res, next) => {
  try {
    const db = await getDb();
    const [rows] = await db.execute(
      'SELECT id, email, name, is_admin, disabled, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 100'
    ) as [Array<{ id: number; email: string; name: string; is_admin: number; disabled?: number; created_at: Date; updated_at: Date }>, unknown];

    const users = (rows || []).map((u) => ({
      id: u.id,
      email: u.email,
      name: decrypt(u.name) || u.name,
      isAdmin: !!u.is_admin,
      disabled: !!(u.disabled ?? 0),
      createdAt: u.created_at instanceof Date ? u.created_at.toISOString() : u.created_at,
      updatedAt: u.updated_at instanceof Date ? u.updated_at.toISOString() : u.updated_at,
    }));

    res.json(users);
  } catch (error) {
    next(error);
  }
});

adminRoutes.delete('/users/:id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const adminId = (req as { userId?: number }).userId;

    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    if (targetId === adminId) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    const db = await getDb();
    await db.execute('DELETE FROM feedback WHERE user_id = ?', [targetId]);
    const [resumeRows] = await db.execute('SELECT id FROM resumes WHERE user_id = ?', [targetId]) as [Array<{ id: number }>, unknown];
    const resumeIds = (resumeRows || []).map((r) => r.id);
    if (resumeIds.length > 0) {
      const placeholders = resumeIds.map(() => '?').join(',');
      await db.execute(`DELETE FROM file_exports WHERE resume_id IN (${placeholders})`, resumeIds);
    }
    await db.execute('DELETE FROM resumes WHERE user_id = ?', [targetId]);
    await db.execute('DELETE FROM activity_logs WHERE user_id = ?', [String(targetId)]);
    const [result] = await db.execute('DELETE FROM users WHERE id = ?', [targetId]) as [{ affectedRows: number }, unknown];

    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    next(error);
  }
});

adminRoutes.patch('/users/:id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const adminId = (req as { userId?: number }).userId;
    const { isAdmin, disabled } = req.body;

    if (isNaN(targetId)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    if (targetId === adminId && disabled === true) {
      res.status(400).json({ error: 'Cannot disable your own account' });
      return;
    }

    const db = await getDb();
    const updates: string[] = [];
    const values: (number | boolean)[] = [];

    if (typeof isAdmin === 'boolean') {
      updates.push('is_admin = ?');
      values.push(isAdmin ? 1 : 0);
    }
    if (typeof disabled === 'boolean') {
      updates.push('disabled = ?');
      values.push(disabled ? 1 : 0);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'Provide isAdmin and/or disabled' });
      return;
    }

    values.push(targetId);
    const [result] = await db.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    ) as [{ affectedRows: number }, unknown];

    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ message: 'User updated' });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get('/activity', async (req, res, next) => {
  try {
    const db = await getDb();
    const [rows] = await db.execute(
      `SELECT l.id, l.action, l.user_id, l.details, l.created_at, u.name AS user_name
       FROM activity_logs l
       LEFT JOIN users u ON u.id = l.user_id AND l.user_id REGEXP '^[0-9]+$'
       ORDER BY l.created_at DESC LIMIT 200`
    ) as [Array<{ id: number; action: string; user_id: string; details: string | object; created_at: Date; user_name: string | null }>, unknown];

    const logs = (rows || []).map((l) => {
      const isAnonymous = l.user_id === 'anonymous' || l.user_id == null;
      let userName: string | null = null;
      if (l.user_name != null) {
        try {
          userName = (decrypt(l.user_name) || l.user_name).trim();
        } catch {
          userName = String(l.user_name).trim();
        }
        if (!userName) userName = null;
      }
      const userDisplay = isAnonymous ? 'anonymous' : (userName || `User ${l.user_id}`);

      return {
        id: l.id,
        action: l.action,
        userId: l.user_id,
        userDisplay,
        details: l.details != null
          ? (typeof l.details === 'string' ? JSON.parse(l.details) : l.details)
          : null,
        createdAt: l.created_at instanceof Date ? l.created_at.toISOString() : l.created_at,
      };
    });

    res.json(logs);
  } catch (error) {
    next(error);
  }
});

adminRoutes.get('/templates', async (req, res, next) => {
  try {
    const db = await getDb();
    const [rows] = await db.execute(
      "SELECT value FROM config WHERE `key` = 'templates'"
    ) as [Array<{ value: string | object }>, unknown];

    const raw = rows?.[0]?.value;
    if (raw != null) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      res.json(Array.isArray(parsed) ? parsed : []);
    } else {
      res.json([
        { value: 'professional', label: 'Professional', description: 'Classic layout with blue accents' },
        { value: 'modern', label: 'Modern', description: 'Contemporary design with purple accents' },
        { value: 'minimal', label: 'Minimal', description: 'Clean, minimal layout with gray accents' },
      ]);
    }
  } catch (error) {
    next(error);
  }
});

adminRoutes.put('/templates', async (req, res, next) => {
  try {
    const { templates } = req.body;
    if (!Array.isArray(templates)) {
      res.status(400).json({ error: 'templates must be an array' });
      return;
    }
    const db = await getDb();
    await db.execute(
      "INSERT INTO config (`key`, value) VALUES ('templates', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [JSON.stringify(templates)]
    );
    res.json({ message: 'Templates updated' });
  } catch (error) {
    next(error);
  }
});

adminRoutes.get('/stats', async (req, res, next) => {
  try {
    const db = await getDb();
    const [[usersCount], [resumesCount], [feedbackCount]] = await Promise.all([
      db.execute('SELECT COUNT(*) as c FROM users') as Promise<[[{ c: number }], unknown]>,
      db.execute('SELECT COUNT(*) as c FROM resumes') as Promise<[[{ c: number }], unknown]>,
      db.execute('SELECT COUNT(*) as c FROM feedback') as Promise<[[{ c: number }], unknown]>,
    ]);

    res.json({
      users: usersCount?.[0]?.c ?? 0,
      resumes: resumesCount?.[0]?.c ?? 0,
      feedback: feedbackCount?.[0]?.c ?? 0,
    });
  } catch (error) {
    next(error);
  }
});
