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
