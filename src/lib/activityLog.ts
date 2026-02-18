import { getDb } from '../config/database.js';

export async function logActivity(
  action: string,
  userId: string,
  details?: Record<string, unknown>
) {
  try {
    const db = await getDb();
    await db.execute(
      'INSERT INTO activity_logs (action, user_id, details) VALUES (?, ?, ?)',
      [action, userId, JSON.stringify(details ?? {})]
    );
  } catch {
    // Silently fail - don't block main flow
  }
}
