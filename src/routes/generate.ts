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
        customSections?: Array<{ title: string; content: string }>;
      };
      const customSectionsText = Array.isArray(p.customSections) && p.customSections.length > 0
        ? `\nCustom sections (include these in the resume): ${JSON.stringify(p.customSections)}`
        : '';
      const profileText = `PROFILE DATA:
Name: ${p.name || 'Not provided'}
Contact: ${JSON.stringify(p.contact || {})}
Career Objective: ${p.careerObjective || 'Not provided'}
Education: ${JSON.stringify(p.education || [])}
Experience: ${JSON.stringify(p.experience || [])}
Skills: ${Array.isArray(p.skills) ? p.skills.join(', ') : 'Not provided'}${customSectionsText}`;

      userContent = jobDescription
        ? `Create a professional resume and cover letter FROM SCRATCH using the profile data below. Tailor them for the job description. Use a ${tone} tone.

STRICT: Use ONLY the data provided in the profile. Do not add any schools, institutions, degrees, employers, or roles that are not listed in the profile. Education and experience entries must come exclusively from the profile data—no invented or inferred entries.

${profileText}

JOB DESCRIPTION:
${jobDescription}

TONE: ${tone}

IMPORTANT: Respond with TWO SEPARATE JSON objects, one after the other:

FIRST JSON (Resume) - Populate ONLY from the profile data above. Include ONLY sections that have content in the profile. For education and experience, list ONLY the entries provided—do not add any new institutions or employers. Omit or use [] for empty sections. Do not add placeholder or fake content. Structure when present: header (required), summary, skills (personalStrengths, technicalSkills), experience, education, certifications, customSections (only if profile has custom sections).
{"resume": {
  "header": {"name": "...", "title": "...", "contact": {...}},
  "summary": "...",
  "skills": {"personalStrengths": [...], "technicalSkills": [...]},
  "experience": [...],
  "education": [...],
  "certifications": [],
  "customSections": []
}}

SECOND JSON (Cover Letter):
{"coverLetter": "The cover letter text here"}

Respond with properly formatted JSON only.`
        : `Create a professional resume FROM SCRATCH using the profile data below. No job description - create a general professional resume. Use a ${tone} tone. Cover letter can be a generic template.

STRICT: Use ONLY the data provided in the profile. Do not add any schools, institutions, degrees, employers, or roles that are not listed in the profile.

${profileText}

TONE: ${tone}

IMPORTANT: Respond with TWO SEPARATE JSON objects, one after the other:

FIRST JSON (Resume) - Populate ONLY from the profile data above. For education and experience, list ONLY the entries provided—do not add any new institutions or employers. Omit or leave empty any section not in the profile. Do not add placeholder or fake content. Structure when present: header (required), summary, skills, experience, education, certifications, customSections (only if profile has them).
{"resume": {
  "header": {"name": "...", "title": "...", "contact": {"address": "", "email": "", "mobile": "", "linkedin": "", "github": ""}},
  "summary": "...",
  "skills": {"personalStrengths": [...], "technicalSkills": [...]},
  "experience": [...],
  "education": [...],
  "certifications": [],
  "customSections": []
}}

SECOND JSON (Cover Letter):
{"coverLetter": "A general professional cover letter template the user can customize."}

Respond with properly formatted JSON only.`;
    } else {
      userContent = `Please tailor this resume for the job description below, and create a matching cover letter.

STRICT RULES — YOU MUST FOLLOW:
- Use ONLY information that appears in the ORIGINAL RESUME below. Do not add any schools, universities, colleges, degrees, certifications, employers, or roles that are not explicitly mentioned in the original.
- For education: list ONLY the institutions and degrees that appear in the original resume. Do not infer, assume, or invent any education entries.
- For experience: list ONLY the companies, roles, and details from the original. Do not add jobs or employers not in the resume.
- You may rephrase and tailor wording for the job description, but the factual content (names of schools, employers, dates, etc.) must come exclusively from the original.

ORIGINAL RESUME (this is the only source of facts):
${resumeText}

JOB DESCRIPTION:
${jobDescription}

TONE: ${tone}

IMPORTANT: Please respond with TWO SEPARATE JSON objects, one after the other:

FIRST JSON (Resume) - Tailor the resume from the original. Include ONLY sections that have content in the original. For education and experience, include ONLY entries that appear in the ORIGINAL RESUME above—do not add any new institutions or employers. Omit or use empty arrays for sections with no content in the original. Do not add placeholder or fake content.
{"resume": {
  "header": {...},
  "summary": "...",
  "skills": {"personalStrengths": [...], "technicalSkills": [...]},
  "experience": [...],
  "education": [...],
  "certifications": []
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
          content: `You are an expert resume and cover letter writer. Use a ${tone} tone throughout. Respond with JSON containing "resume" and "coverLetter" fields. CRITICAL: Only include factual content (schools, employers, degrees, roles, dates) that appears in the user's provided resume or profile—never invent or add institutions, companies, or education entries that are not in the source.`,
        },
        { role: 'user', content: userContent },
      ],
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.5'),
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
        const resumeObj = typeof resumeParsed.resume === 'string' ? null : resumeParsed.resume;
        if (resumeObj && isBuilder && Array.isArray((profileData as { customSections?: unknown[] })?.customSections) && (profileData as { customSections: unknown[] }).customSections.length > 0) {
          resumeObj.customSections = (profileData as { customSections: Array<{ title: string; content: string }> }).customSections;
        }
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
      const resumeObj = typeof parsed.resume === 'string' ? null : parsed.resume;
      if (resumeObj && isBuilder && Array.isArray((profileData as { customSections?: unknown[] })?.customSections) && (profileData as { customSections: unknown[] }).customSections.length > 0) {
        resumeObj.customSections = (profileData as { customSections: Array<{ title: string; content: string }> }).customSections;
      }
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
