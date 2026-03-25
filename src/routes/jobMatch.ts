import { Router } from 'express';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../config/database.js';
import { decrypt } from '../lib/encryption.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const RAPIDAPI_HOST = process.env.RAPIDAPI_JOBS_HOST || 'active-jobs-db.p.rapidapi.com';
const RAPIDAPI_JOBS_PATH = process.env.RAPIDAPI_JOBS_PATH || '/active-ats-7d';

export interface JobListing {
  id?: string;
  title: string;
  company: string;
  company_name?: string;
  location?: string;
  url?: string;
  apply_url?: string;
  description?: string;
  employment_type?: string[];
  [key: string]: unknown;
}

function normalizeJob(raw: Record<string, unknown>): JobListing {
  const loc = (raw.location as string) || (raw.job_location as string)
    || (Array.isArray(raw.locations_derived) && (raw.locations_derived as string[]).length > 0
      ? (raw.locations_derived as string[])[0]
      : Array.isArray(raw.locations_alt_raw) && (raw.locations_alt_raw as string[]).length > 0
        ? (raw.locations_alt_raw as string[])[0]
        : undefined);
  const company = (raw.company_name as string) || (raw.company as string) || (raw.organization as string) || '';
  const desc = (raw.description_text as string) || (raw.description as string);
  return {
    id: typeof raw.id === 'string' ? raw.id : raw.id != null ? String(raw.id) : undefined,
    title: (raw.title as string) || (raw.job_title as string) || 'Untitled',
    company,
    company_name: company,
    location: loc,
    url: (raw.url as string) || (raw.apply_url as string) || (raw.job_url as string),
    apply_url: (raw.apply_url as string) || (raw.url as string) || (raw.job_url as string),
    description: desc,
    employment_type: Array.isArray(raw.employment_type) ? (raw.employment_type as string[]) : undefined,
    ...raw,
  };
}

export const jobMatchRoutes = Router();

/**
 * Get resume content for the current user: by id or latest.
 */
async function getResumeContentForUser(userId: number, resumeId?: number): Promise<string | null> {
  const db = await getDb();
  if (resumeId != null) {
    const [rows] = await db.execute(
      'SELECT resume FROM resumes WHERE id = ? AND user_id = ?',
      [resumeId, userId]
    ) as [Array<{ resume: string }>, unknown];
    if (rows && rows.length > 0) {
      return decrypt(rows[0].resume);
    }
    return null;
  }
  const [rows] = await db.execute(
    'SELECT resume FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  ) as [Array<{ resume: string }>, unknown];
  if (rows && rows.length > 0) {
    return decrypt(rows[0].resume);
  }
  return null;
}

/**
 * Build a short text summary from resume JSON for AI to read (title, summary, skills, role names).
 */
function resumeToSearchContext(resumeJson: string): string {
  try {
    const parsed = JSON.parse(resumeJson);
    const resume = parsed?.resume && typeof parsed.resume === 'object' ? parsed.resume : parsed;
    if (!resume) return resumeJson.slice(0, 3000);

    const parts: string[] = [];
    if (resume.header?.title) parts.push(`Title: ${resume.header.title}`);
    if (resume.header?.name) parts.push(`Name: ${resume.header.name}`);
    if (resume.summary) parts.push(`Summary: ${resume.summary}`);
    if (resume.skills) {
      const all = [
        ...(resume.skills.personalStrengths || []),
        ...(resume.skills.technicalSkills || []),
      ];
      if (all.length) parts.push(`Skills: ${all.join(', ')}`);
    }
    if (Array.isArray(resume.experience) && resume.experience.length) {
      const roles = resume.experience.map((e: { role?: string }) => e.role).filter(Boolean);
      if (roles.length) parts.push(`Roles: ${roles.join(', ')}`);
    }
    if (Array.isArray(resume.education) && resume.education.length) {
      const degrees = resume.education.map((e: { degree?: string }) => e.degree).filter(Boolean);
      if (degrees.length) parts.push(`Education: ${degrees.join(', ')}`);
    }
    return parts.join('\n') || resumeJson.slice(0, 3000);
  } catch {
    return resumeJson.slice(0, 3000);
  }
}

/**
 * Use OpenAI to extract job search keyword and optional location from resume context.
 */
async function extractSearchParams(resumeContext: string): Promise<{ keyword: string; location?: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { keyword: 'software engineer', location: undefined };
  }
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You extract job search parameters from a resume. Reply with ONLY a JSON object, no markdown: { "keyword": "job title or main role to search for, 1-4 words", "location": "optional: city, state, country, or Remote" }. Use the resume title and experience to pick the best keyword. If location is unclear, omit it or use empty string.',
      },
      {
        role: 'user',
        content: resumeContext.slice(0, 2500),
      },
    ],
    temperature: 0.3,
    max_tokens: 150,
  });
  const content = response.choices[0]?.message?.content?.trim() || '{}';
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      keyword: typeof obj.keyword === 'string' ? obj.keyword.trim() || 'engineer' : 'engineer',
      location: typeof obj.location === 'string' ? obj.location.trim() || undefined : undefined,
    };
  } catch {
    return { keyword: 'engineer', location: undefined };
  }
}

/**
 * Fetch jobs from RapidAPI Active Jobs DB (active-ats-7d endpoint).
 * See: https://rapidapi.com/fantastic-jobs-fantastic-jobs-default/api/active-jobs-db
 * Query params: title_filter, location_filter, limit, offset, description_type
 */
async function fetchJobsFromApi(keyword: string, location?: string): Promise<JobListing[]> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    throw new Error('RAPIDAPI_KEY is not configured. Add it in backend .env to enable Job Match.');
  }
  const path = RAPIDAPI_JOBS_PATH.startsWith('/') ? RAPIDAPI_JOBS_PATH : `/${RAPIDAPI_JOBS_PATH}`;
  const url = new URL(`https://${RAPIDAPI_HOST}${path}`);
  url.searchParams.set('limit', String(process.env.RAPIDAPI_JOBS_LIMIT || '15'));
  url.searchParams.set('offset', String(process.env.RAPIDAPI_JOBS_OFFSET || '0'));
  url.searchParams.set('title_filter', `"${keyword.replace(/"/g, '')}"`);
  if (location && location.trim()) {
    url.searchParams.set('location_filter', `"${location.trim().replace(/"/g, '')}"`);
  }
  url.searchParams.set('description_type', process.env.RAPIDAPI_JOBS_DESCRIPTION_TYPE || 'text');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': RAPIDAPI_HOST,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jobs API error: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  // API may return { data: [...], jobs: [...], results: [...] } or direct array
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data.jobs)
      ? data.jobs
      : Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.results)
          ? data.results
          : [];
  return list.map((item: Record<string, unknown>) => normalizeJob(item));
}

const DEFAULT_LOCATION = 'Nigeria';

/**
 * POST /api/job-match
 * Body: { resumeId?: number, title?: string, location?: string }
 * Returns: { jobs: JobListing[], keyword: string, location?: string }
 * If title is provided, uses it as the job search keyword (no resume needed).
 * Otherwise uses saved resume (or latest) to derive keyword/location via AI.
 * location: optional; when searching by title it defaults to Nigeria if not provided.
 */
jobMatchRoutes.post('/', authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as { userId?: number }).userId!;
    const titleParam = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const resumeId = typeof req.body?.resumeId === 'number' ? req.body.resumeId : undefined;
    const locationParam = typeof req.body?.location === 'string' ? req.body.location.trim() : undefined;

    let keyword: string;
    let location: string | undefined;

    if (titleParam) {
      keyword = titleParam;
      location = locationParam || DEFAULT_LOCATION;
    } else {
      const resumeContent = await getResumeContentForUser(userId, resumeId);
      if (!resumeContent || !resumeContent.trim()) {
        res.status(400).json({
          error: 'No resume found and no job title provided. Enter a job title above, or save a resume first (My Resumes).',
        });
        return;
      }
      const context = resumeToSearchContext(resumeContent);
      const extracted = await extractSearchParams(context);
      keyword = extracted.keyword;
      location = locationParam || extracted.location || DEFAULT_LOCATION;
    }

    const jobs = await fetchJobsFromApi(keyword, location);

    res.json({
      jobs,
      keyword,
      location: location || undefined,
    });
  } catch (error) {
    const err = error as Error;
    if (err.message?.includes('RAPIDAPI_KEY')) {
      res.status(503).json({ error: err.message });
      return;
    }
    if (err.message?.includes('Jobs API error')) {
      const statusMatch = err.message.match(/Jobs API error:\s*(\d+)/);
      const httpStatus = statusMatch?.[1] ?? 'unknown';
      const hints: Record<string, string> = {
        '401': 'RapidAPI rejected the key—use the Application key from RapidAPI in backend .env and restart the server.',
        '403': 'Forbidden—subscribe to “Active Jobs DB” on RapidAPI for this key, then retry.',
        '429': 'Rate limit or quota exceeded for this RapidAPI app—wait, reduce calls, or upgrade.',
      };
      const hint = hints[httpStatus] ?? 'Check RAPIDAPI_KEY in backend/.env (not .env.redacted), restart the API server, and verify quota.';
      res.status(502).json({ error: `Jobs API error (${httpStatus}). ${hint}` });
      return;
    }
    next(error);
  }
});
