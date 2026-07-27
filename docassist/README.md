# DocAssist CDI & E&M Companion

AI-powered Clinical Documentation Integrity and E&M coding assistant for hospitalist physicians.

## Project Structure

```
docassist/
├── index.html        ← Frontend app (no API key needed by users)
├── api/
│   └── analyze.js    ← Serverless function (holds API key securely)
├── vercel.json       ← Vercel routing config
└── README.md
```

## Deploy to Vercel (One Time Setup)

### Step 1 — Push to GitHub

1. Go to github.com → New repository → name it `docassist`
2. Upload all files (index.html, api/analyze.js, vercel.json, README.md)
   - Drag and drop works fine

### Step 2 — Deploy on Vercel

1. Go to vercel.com → Sign up free (use your GitHub account)
2. Click **Add New Project**
3. Import your `docassist` GitHub repository
4. Click **Deploy** — leave all settings as default

### Step 3 — Add Your API Key (Secret)

1. In Vercel dashboard → your project → **Settings** → **Environment Variables**
2. Add:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your Anthropic API key (sk-ant-...)
   - **Environment:** Production, Preview, Development (check all)
   - **Name:** `APP_PASSWORD`
   - **Value:** the password used to access DocAssist
   - **Environment:** Production, Preview, Development (check all)
   - **Name:** `SESSION_SECRET`
   - **Value:** a randomly generated secret of at least 32 bytes
   - **Environment:** Production, Preview, Development (check all)
3. Click **Save**
4. Go to **Deployments** → click the 3 dots → **Redeploy**

### Step 4 — Done

Your app is live at `https://docassist.vercel.app` (or similar).
Users visit the URL and use it — no API key, no setup.

## Adding a Custom Domain (Optional)

1. Vercel dashboard → your project → **Settings** → **Domains**
2. Add your domain (e.g. docassist.ai)
3. Follow DNS instructions (takes 5 minutes)

## Updating the App

Any time you push changes to GitHub, Vercel auto-deploys within 30 seconds.

## API Key Security

- The API key lives ONLY in Vercel's environment variables
- It is never sent to the browser or visible to users
- All Anthropic API calls happen server-side via `/api/analyze`

## Abuse Controls

- Authentication failures: 5 attempts per client in 15 minutes
- Authenticated analysis: 20 requests per client per minute
- Concurrent analysis: 2 requests per client and 4 per warm serverless instance

These in-memory controls protect each active function instance. Add a shared,
durable rate-limit store before a multi-region or horizontally scaled production
rollout.

## Clinical Scoring Boundaries

- E&M codes are calculated on the server from validated model-extracted facts.
- SIRS and all six SOFA organ components are calculated deterministically. Sepsis-3 requires documented infection plus a known acute SOFA increase; absent baseline data remains indeterminate.
- CMS SEP-1 evidence is displayed separately as a quality-measure screen, not a diagnostic definition.
- CDI alerts require note-grounded evidence, missing-evidence disclosure for queries, a support state, and M.E.A.T. status.

## Local Regression Tests

Run the security, request-boundary, model-output, API integration, and
deterministic E&M checks before publishing:

```bash
node test_session.mjs
node test_request_validation.mjs
node test_rate_limit.mjs
node test_output_validation.mjs
node test_analyze_integration.mjs
node test_em.js
node test_sepsis.js
```
