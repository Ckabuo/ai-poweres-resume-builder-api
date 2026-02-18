import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';

import { initSchema } from './lib/schema.js';
import { authRoutes } from './routes/auth.js';
import { resumeRoutes } from './routes/resume.js';
import { userRoutes } from './routes/user.js';
import { generateRoutes } from './routes/generate.js';
import { atsRoutes } from './routes/ats.js';
import { feedbackRoutes } from './routes/feedback.js';
import { exportRoutes } from './routes/export.js';
import { adminRoutes } from './routes/admin.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:8080' }));
app.use(express.json({ limit: '10mb' }));

// Ensure uploads directory exists and serve static files
const uploadsDir = path.join(process.cwd(), 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/resumes', resumeRoutes);
app.use('/api/users', userRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/ats', atsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/admin', adminRoutes);

// Error handling
app.use(errorHandler);

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.warn('Database unavailable:', err.message || err);
    console.warn('Server starting without DB. Auth, profile, and resume save will not work.');
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
