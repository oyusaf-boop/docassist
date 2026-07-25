// DocAssist — /api/analyze  (Vercel serverless)
// FY2026 CDI + E&M analysis proxy to the Anthropic Messages API.
//
// Changes vs prior build:
//  - Model updated to claude-sonnet-5 (claude-sonnet-4-6 is now legacy)
//  - Prompt caching (cache_control) on the large static system prompt → faster/cheaper repeats
//  - Hard timeout (AbortController) so a slow upstream call fails cleanly instead of hanging
//  - Honest error surfacing (never returns a silent/ambiguous body)

const MODEL = 'claude-sonnet-5';
const ANTHROPIC_TIMEOUT_MS = 55000; // stay just under Vercel's 60s function ceiling

export const config = {
  maxDuration: 60, // ask Vercel for the full 60s window (see vercel.json note)
};

export default async function handler(req, res) {
  // CORS (same-origin in practice, harmless here)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Session cookie check
  const cookies = req.headers.cookie || '';
  const authenticated = cookies.split(';').some(c => c.trim() === 'da_session=authenticated');
  if (!authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in Vercel project settings.' });
  }

  try {
    const { system, user, maxTokens } = req.body || {};
    if (!system || !user) {
      return res.status(400).json({ error: 'Missing system or user prompt' });
    }

    // Timeout guard so the browser never waits forever on a stalled upstream call.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens || 2500,
          // System prompt sent as a cacheable block. It is large and static per
          // analysis type, so caching cuts latency + cost on repeat analyses.
          system: [
            { type: 'text', text: String(system), cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: String(user) }],
        }),
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        return res.status(504).json({ error: 'The analysis timed out upstream. Try again, or shorten the note.' });
      }
      return res.status(502).json({ error: 'Could not reach the analysis service: ' + (err.message || 'network error') });
    }
    clearTimeout(timer);

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: 'Unexpected upstream response (HTTP ' + response.status + ').' });
    }

    if (!response.ok || data.error) {
      const msg = (data.error && (data.error.message || data.error.type)) || ('Upstream error HTTP ' + response.status);
      return res.status(response.status === 200 ? 500 : response.status).json({ error: msg });
    }

    const text = (data.content || []).map(b => b.text || '').join('').trim();
    if (!text) {
      return res.status(502).json({ error: 'Model returned an empty response. Try again.' });
    }
    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
