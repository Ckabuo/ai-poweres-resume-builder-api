import { Router } from 'express';
import OpenAI from 'openai';
import { getDb } from '../config/database.js';
import { optionalAuthMiddleware } from '../middleware/optionalAuth.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const atsRoutes = Router();

atsRoutes.post('/suggestions', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { resumeText, jobDescription, resumeId } = req.body;
    const jobDesc = typeof jobDescription === 'string' ? jobDescription.trim() : '';

    if (!resumeText) {
      res.status(400).json({ error: 'resumeText is required' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    const hasJobDescription = jobDesc.length > 0;
    const systemContent = hasJobDescription
      ? 'You are an ATS (Applicant Tracking System) optimization expert. Analyze resumes and job descriptions to provide keyword suggestions and improvement tips. Respond with JSON: { "missingKeywords": ["keyword1", "keyword2"], "suggestions": ["suggestion1", "suggestion2"], "matchScore": 75 }'
      : 'You are an ATS (Applicant Tracking System) optimization expert. Analyze the resume and provide general ATS-friendly improvement tips and commonly recommended keywords to include. Do not include matchScore when no job description is provided. Respond with JSON: { "missingKeywords": ["keyword1", "keyword2"], "suggestions": ["suggestion1", "suggestion2"] }';
    const userContent = hasJobDescription
      ? `Resume:\n${resumeText}\n\nJob Description:\n${jobDesc}\n\nProvide ATS optimization suggestions as JSON.`
      : `Resume:\n${resumeText}\n\nNo job description provided. Give general ATS optimization suggestions and recommended keywords for a strong resume. Respond with JSON only (no matchScore).`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: 'No response from AI' });
      return;
    }

    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, '').trim());

    if (resumeId && typeof resumeId === 'number') {
      try {
        const db = await getDb();
        await db.execute(
          'INSERT INTO ai_suggestions (resume_id, suggestion_type, details) VALUES (?, ?, ?)',
          [resumeId, 'ats_optimization', JSON.stringify(parsed)]
        );
      } catch {
        // Ignore storage errors
      }
    }

    res.json(parsed);
  } catch (error) {
    next(error);
  }
});
