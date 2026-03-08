# AI Resume Builder - Backend

Node.js + TypeScript + Express backend with MySQL.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your real values. **Do not commit `.env`** (it is in `.gitignore`).

```bash
cp .env.example .env
```

**Required variables:**

| Variable | Description |
|----------|-------------|
| `MYSQL_HOST` | MySQL host |
| `MYSQL_PORT` | MySQL port |
| `MYSQL_USER` | MySQL user |
| `MYSQL_PASSWORD` | MySQL password |
| `MYSQL_DATABASE` | Database name |
| `JWT_SECRET` | Secret for JWT tokens |
| `OPENAI_API_KEY` | OpenAI API key |
| `FRONTEND_URL` | CORS origin (e.g. http://localhost:8080) |

**Optional:**

- **Job Match (AI-suggested jobs):** `RAPIDAPI_KEY` – from [RapidAPI Active Jobs DB](https://rapidapi.com/fantastic-jobs-fantastic-jobs-default/api/active-jobs-db). If not set, Job Match returns a friendly error.
- **Password reset:** `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- **Encryption at rest:** `ENCRYPTION_KEY` (32-byte hex) – for AES-256-GCM
  - Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 3. Run the server

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

Server runs on `http://localhost:3001`.

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | Health check |
| POST | `/api/auth/signup` | No | Sign up |
| POST | `/api/auth/login` | No | Login |
| POST | `/api/auth/forgot-password` | No | Request password reset |
| POST | `/api/auth/reset-password` | No | Reset password (with token) |
| POST | `/api/auth/change-password` | Yes | Change password |
| GET | `/api/users/me` | Yes | Get profile |
| PUT | `/api/users/me` | Yes | Update profile |
| PUT | `/api/users/me/avatar` | Yes | Upload profile photo |
| POST | `/api/generate/resume` | Optional | Generate resume + cover letter |
| GET | `/api/resumes` | Yes | List user's resumes |
| POST | `/api/resumes` | Yes | Save resume |
| GET | `/api/resumes/:id` | Yes | Get resume |
| POST | `/api/job-match` | Yes | AI-suggested jobs from saved resume (RapidAPI Active Jobs DB) |
| GET | `/api/admin/users` | Admin | List users |
| PUT | `/api/admin/users/:id` | Admin | Update user (enable/disable) |

## Database

Tables are created automatically on startup (`initSchema`):

- `users` – auth, profile, encryption
- `jobs` – job postings
- `resumes` – saved resumes
- `ai_suggestions` – ATS suggestions
- `file_exports` – export logs
- `feedback` – user feedback
- `password_reset_tokens` – password reset flow
