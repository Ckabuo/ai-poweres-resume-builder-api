import { getDb } from '../config/database.js';

export async function initSchema() {
  const db = await getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) DEFAULT '',
      contact LONGTEXT DEFAULT NULL,
      career_objective TEXT DEFAULT NULL,
      education LONGTEXT DEFAULT NULL,
      experience LONGTEXT DEFAULT NULL,
      skills LONGTEXT DEFAULT NULL,
      is_admin TINYINT(1) DEFAULT 0,
      disabled TINYINT(1) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Migrate existing JSON columns to LONGTEXT so encrypted values can be stored
  try {
    await db.execute(`
      ALTER TABLE users
        MODIFY contact LONGTEXT DEFAULT NULL,
        MODIFY education LONGTEXT DEFAULT NULL,
        MODIFY experience LONGTEXT DEFAULT NULL,
        MODIFY skills LONGTEXT DEFAULT NULL
    `);
  } catch {
    // Ignore if columns are already LONGTEXT or table just created with LONGTEXT
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      job_title VARCHAR(255) DEFAULT NULL,
      job_description TEXT,
      company_name VARCHAR(255) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created_at (created_at)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS resumes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      job_id INT DEFAULT NULL,
      resume LONGTEXT NOT NULL,
      cover_letter LONGTEXT NOT NULL,
      job_description TEXT,
      tone VARCHAR(50) DEFAULT 'formal',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_job_id (job_id),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      resume_id INT NOT NULL,
      suggestion_type VARCHAR(50) DEFAULT 'ats_optimization',
      suggestion_text TEXT,
      details JSON DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_resume_id (resume_id),
      FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS file_exports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      resume_id INT DEFAULT NULL,
      user_id INT DEFAULT NULL,
      export_format VARCHAR(20) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_resume_id (resume_id),
      INDEX idx_created_at (created_at)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      resume_id INT DEFAULT NULL,
      rating VARCHAR(20) NOT NULL,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      action VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      details JSON DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_created_at (created_at)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_token_hash (token_hash),
      INDEX idx_expires_at (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS config (
      \`key\` VARCHAR(100) PRIMARY KEY,
      value JSON NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // Insert default templates if not exists
  const defaultTemplates = JSON.stringify([
    { value: 'professional', label: 'Professional', description: 'Classic layout with blue accents' },
    { value: 'modern', label: 'Modern', description: 'Contemporary design with purple accents' },
    { value: 'minimal', label: 'Minimal', description: 'Clean, minimal layout with gray accents' },
  ]);
  await db.execute(
    "INSERT IGNORE INTO config (`key`, value) VALUES ('templates', ?)",
    [defaultTemplates]
  );

  // Migration: add disabled column to existing users table
  try {
    await db.execute('ALTER TABLE users ADD COLUMN disabled TINYINT(1) DEFAULT 0 AFTER is_admin');
  } catch {
    // Column already exists
  }

  // Migration: add job_id to existing resumes table
  try {
    await db.execute('ALTER TABLE resumes ADD COLUMN job_id INT DEFAULT NULL AFTER user_id');
  } catch {
    // Column already exists
  }
  try {
    await db.execute('ALTER TABLE resumes ADD INDEX idx_job_id (job_id)');
  } catch {
    // Index already exists
  }

  // Migration: add profile_image_url to users table
  try {
    await db.execute('ALTER TABLE users ADD COLUMN profile_image_url VARCHAR(500) DEFAULT NULL AFTER skills');
  } catch {
    // Column already exists
  }

  // Migration: add desired_job_title and custom_sections
  try {
    await db.execute('ALTER TABLE users ADD COLUMN desired_job_title VARCHAR(255) DEFAULT NULL AFTER name');
  } catch {
    /* already exists */
  }
  try {
    await db.execute('ALTER TABLE users ADD COLUMN custom_sections LONGTEXT DEFAULT NULL AFTER skills');
  } catch {
    /* already exists */
  }

  // Seed default admin: set is_admin=1 for the email in SEED_ADMIN_EMAIL (user must already exist)
  const seedEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  if (seedEmail) {
    try {
      const [result] = await db.execute(
        'UPDATE users SET is_admin = 1 WHERE LOWER(email) = LOWER(?) LIMIT 1',
        [seedEmail]
      ) as [{ affectedRows: number }, unknown];
      if (result.affectedRows > 0) {
        console.log(`[seed] Admin granted to: ${seedEmail}`);
      } else {
        console.warn(`[seed] SEED_ADMIN_EMAIL="${seedEmail}" — no user found. Sign up with that email first, then restart.`);
      }
    } catch (err) {
      console.warn('[seed] Could not seed admin:', (err as Error).message);
    }
  }
}
