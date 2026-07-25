// DocAssist — /api/analyze  (Vercel serverless)
// FY2026 CDI + E&M analysis proxy to the Anthropic Messages API.
//
// Model is overridable at runtime via the ANTHROPIC_MODEL env var (Vercel →
// Project → Settings → Environment Variables). No code change needed to switch.
//   e.g. ANTHROPIC_MODEL = claude-sonnet-5   (default)
//        ANTHROPIC_MODEL = claude-opus-4-8
//        ANTHROPIC_MODEL = claude-haiku-4-5
//
// If the model returns no text, the error now reports WHY (stop_reason + the
// block types that came back) so the cause is visible instead of generic.

const DEFAULT_MODEL = 'claude-sonnet-5';
const ANTHROPIC_TIMEOUT_MS = 55000; // just under Vercel's 60s function ceiling
const MIN_MAX_TOKENS = 4096;        // floor so a verbose model can't truncate to empty

export const config = {
  maxDuration: 60, // see vercel.json note
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookies = req.headers.cookie || '';
  const authenticated = cookies.split(';').some(c => c.trim() === 'da_session=authenticated');
  if (!authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in Vercel project settings.' });
  }

  const MODEL = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  try {
    const { system, user, maxTokens } = req.body || {};
    if (!system || !user) {
      return res.status(400).json({ error: 'Missing system or user prompt' });
    }

    const outTokens = Math.max(parseInt(maxTokens, 10) || 2500, MIN_MAX_TOKENS);

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
          max_tokens: outTokens,
          // Large static system prompt sent as a cacheable block → faster/cheaper repeats.
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
      return res.status(502).json({ error: 'Unexpected upstream response (HTTP ' + response.status + '): ' + raw.slice(0, 200) });
    }

    if (!response.ok || data.error) {
      const msg = (data.error && (data.error.message || data.error.type)) || ('Upstream error HTTP ' + response.status);
      // Surface the model name so a bad/unavailable model ID is obvious.
      return res.status(response.status === 200 ? 500 : response.status)
                .json({ error: msg + ' [model: ' + MODEL + ']' });
    }

    // Robust extraction: concatenate every text block, ignore non-text blocks.
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .map(b => (b && typeof b.text === 'string') ? b.text : '')
      .join('')
      .trim();

    if (!text) {
      // Report exactly why nothing came back, so it can be diagnosed at a glance.
      const blockTypes = blocks.map(b => (b && b.type) ? b.type : 'unknown').join(',') || 'none';
      const stop = data.stop_reason || 'unknown';
      console.warn('[analyze] empty text', { model: MODEL, stop_reason: stop, blocks: blockTypes, usage: data.usage });
      return res.status(502).json({
        error: 'Model returned no text [model: ' + MODEL + ', stop_reason: ' + stop + ', blocks: ' + blockTypes + ']. If stop_reason is max_tokens, the note may be too long; try again or shorten it.'
      });
    }

    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
