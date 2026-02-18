import { Router } from 'express';
import OpenAI from 'openai';
import { logActivity } from '../lib/activityLog.js';
import { optionalAuthMiddleware } from '../middleware/optionalAuth.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const generateRoutes = Router();

generateRoutes.post('/resume', optionalAuthMiddleware, async (req, res, next) => {
  try {
    const { resumeText, jobDescription, tone, profileData } = req.body;

    const isBuilder = profileData && !resumeText;
    const isTailor = resumeText && !profileData;

    if (!tone) {
      res.status(400).json({ error: 'tone is required' });
      return;
    }
    if (!isTailor && !isBuilder) {
      res.status(400).json({
        error: 'Either resumeText (for tailoring) or profileData (for building) is required',
      });
      return;
    }
    if (isBuilder) {
      const p = profileData as { name?: string; education?: unknown[]; experience?: unknown[]; skills?: unknown[] };
      if (!p.name && (!p.education || p.education.length === 0) && (!p.experience || p.experience.length === 0) && (!p.skills || p.skills.length === 0)) {
        res.status(400).json({ error: 'Provide at least name, education, experience, or skills for resume building' });
        return;
      }
    }
    if (isTailor && !jobDescription) {
      res.status(400).json({ error: 'jobDescription is required for tailoring' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'OpenAI API key not configured on server' });
      return;
    }

    let userContent: string;

    if (isBuilder) {
      const p = profileData as {
        name?: string;
        contact?: { phone?: string; address?: string; linkedin?: string };
        careerObjective?: string;
        education?: Array<{ institution: string; degree: string; dates: string; grade?: string }>;
        experience?: Array<{ role: string; company: string; location: string; dates: string; achievements: string[] }>;
        skills?: string[];
      };
      const profileText = `PROFILE DATA:
Name: ${p.name || 'Not provided'}
Contact: ${JSON.stringify(p.contact || {})}
Career Objective: ${p.careerObjective || 'Not provided'}
Education: ${JSON.stringify(p.education || [])}
Experience: ${JSON.stringify(p.experience || [])}
Skills: ${Array.isArray(p.skills) ? p.skills.join(', ') : 'Not provided'}`;

      userContent = jobDescription
        ? `Create a professional resume and cover letter FROM SCRATCH using the profile data below. Tailor them for the job description. Use a ${tone} tone.

${profileText}

JOB DESCRIPTION:
${jobDescription}

TONE: ${tone}

IMPORTANT: Respond with TWO SEPARATE JSON objects, one after the other:

FIRST JSON (Resume) - Use this exact template structure, populate from profile:
{"resume": {
  "header": {"name": "...", "title": "...", "contact": {...}},
  "summary": "Professional summary paragraph",
  "skills": {"personalStrengths": [...], "technicalSkills": [...]},
  "experience": [...],
  "education": [...],
  "certifications": []
}}

SECOND JSON (Cover Letter):
{"coverLetter": "The cover letter text here"}

Respond with properly formatted JSON only.`
        : `Create a professional resume FROM SCRATCH using the profile data below. No job description - create a general professional resume. Use a ${tone} tone. Cover letter can be a generic template.

${profileText}

TONE: ${tone}

IMPORTANT: Respond with TWO SEPARATE JSON objects, one after the other:

FIRST JSON (Resume) - Use this exact template structure, populate from profile:
{"resume": {
  "header": {"name": "...", "title": "...", "contact": {"address": "", "email": "", "mobile": "", "linkedin": "", "github": ""}},
  "summary": "Professional summary paragraph",
  "skills": {"personalStrengths": [...], "technicalSkills": [...]},
  "experience": [{"role": "...", "company": "...", "location": "...", "dates": "...", "achievements": [...]}],
  "education": [{"institution": "...", "dates": "...", "degree": "...", "grade": ""}],
  "certifications": []
}}

SECOND JSON (Cover Letter):
{"coverLetter": "A general professional cover letter template the user can customize."}

Respond with properly formatted JSON only.`;
    } else {
      userContent = `Please tailor this resume for the job description below, and create a matching cover letter.

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

TONE: ${tone}

IMPORTANT: Please respond with TWO SEPARATE JSON objects, one after the other:

FIRST JSON (Resume) - Use this exact template structure and modify as needed:
{"resume": {
  "header": {
    "name": "Full Name",
    "title": "Job Title",
    "contact": {
      "address": "Location",
      "email": "email@example.com",
      "mobile": "Phone",
      "linkedin": "LinkedIn",
      "github": "GitHub"
    }
  },
  "summary": "Professional summary paragraph",
  "skills": {
    "personalStrengths": ["Skill 1", "Skill 2"],
    "technicalSkills": ["Skill 1", "Skill 2"]
  },
  "experience": [
    {
      "role": "Job Title",
      "company": "Company Name",
      "location": "Location",
      "dates": "Start - End",
      "achievements": ["Achievement 1", "Achievement 2"]
    }
  ],
  "education": [
    {
      "institution": "Institution Name",
      "dates": "Start - End",
      "degree": "Degree and Major",
      "grade": "Grade (if applicable)"
    }
  ],
  "certifications": [
    {
      "name": "Certification Name",
      "provider": "Provider",
      "date": "Date"
    }
  ]
}}

SECOND JSON (Cover Letter):
{"coverLetter": "The tailored cover letter text here"}

Respond with properly formatted JSON only.`;
    }

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an expert resume and cover letter writer. Use a ${tone} tone throughout. Respond with JSON containing "resume" and "coverLetter" fields.`,
        },
        { role: 'user', content: userContent },
      ],
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS || '4000', 10),
    });

    let content = response.choices[0]?.message?.content ?? '';
    if (!content) {
      res.status(500).json({ error: 'No response from AI' });
      return;
    }

    // Strip Markdown code fences if present (e.g. ```json ... ```)
    content = content
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    // Parse the response
    const resumeStart = content.indexOf('{"resume"');
    const coverLetterStart = content.indexOf('{"coverLetter"');

    let resume = '';
    let coverLetter = '';

    if (resumeStart !== -1 && coverLetterStart !== -1 && resumeStart < coverLetterStart) {
      const resumeEnd = content.lastIndexOf('}', coverLetterStart);
      const resumeJsonStr = content.substring(resumeStart, resumeEnd + 1);
      const resumeParsed = JSON.parse(resumeJsonStr);

      if (resumeParsed.resume) {
        resume =
          typeof resumeParsed.resume === 'string'
            ? resumeParsed.resume.trim()
            : JSON.stringify(resumeParsed.resume, null, 2);
      }

      const coverLetterEnd = content.lastIndexOf('}');
      const coverLetterJsonStr = content.substring(coverLetterStart, coverLetterEnd + 1);
      const coverLetterParsed = JSON.parse(coverLetterJsonStr);
      if (coverLetterParsed.coverLetter) {
        coverLetter = coverLetterParsed.coverLetter.trim();
      }
    } else {
      const parsed = JSON.parse(content);
      resume =
        typeof parsed.resume === 'string'
          ? parsed.resume
          : JSON.stringify(parsed.resume, null, 2);
      coverLetter = parsed.coverLetter ?? '';
    }

    const userId = (req as { uid?: string }).uid ?? 'anonymous';
    await logActivity('resume_generated', userId, { tone: req.body.tone, mode: isBuilder ? 'builder' : 'tailor' });

    res.json({ resume, coverLetter });
  } catch (error: unknown) {
    const err = error as { status?: number; code?: string; message?: string };
    if (err?.status === 429 || err?.code === 'insufficient_quota') {
      res.status(503).json({
        error: 'AI service is temporarily unavailable. Your OpenAI account has exceeded its quota—please check your plan and billing at platform.openai.com, or try again later.',
      });
      return;
    }
    if (err?.status === 401 || err?.code === 'invalid_api_key') {
      res.status(500).json({
        error: 'OpenAI API key is invalid or expired. Please contact the administrator.',
      });
      return;
    }
    next(error);
  }
});
