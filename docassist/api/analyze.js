// DocAssist — /api/analyze  (Vercel serverless)
// FY2026 CDI + E&M analysis proxy to the Anthropic Messages API.
//
// Model is overridable at runtime via the ANTHROPIC_MODEL env var (Vercel →
// Project → Settings → Environment Variables). No code change needed to switch.
//   e.g. ANTHROPIC_MODEL = claude-sonnet-5   (default)
//        ANTHROPIC_MODEL = claude-opus-5
//        ANTHROPIC_MODEL = claude-haiku-4-5
//
// THINKING / EFFORT
// -----------------
// Claude Sonnet 5 and later use "adaptive thinking" and default to effort:high.
// max_tokens is a HARD CEILING on thinking + response text combined, so at high
// effort the model can spend the entire budget reasoning and return zero text
// (stop_reason: max_tokens, blocks: thinking). That is what broke this endpoint.
//
// These are structured extraction tasks against an explicit output schema, so
// thinking is disabled and effort is set low for speed. Both are env-overridable:
//   ANTHROPIC_THINKING = disabled | adaptive     (default: disabled)
//   ANTHROPIC_EFFORT   = low | medium | high | xhigh | max   (default: low)
//
// If the model returns no text, the error reports WHY (stop_reason + block types).

import { hasValidSession } from './session.js';

const DEFAULT_MODEL    = 'claude-sonnet-5';
const DEFAULT_THINKING = 'disabled';
const DEFAULT_EFFORT   = 'low';

const VALID_EFFORT   = ['low', 'medium', 'high', 'xhigh', 'max'];
const VALID_THINKING = ['disabled', 'adaptive'];

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

  if (!hasValidSession(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in Vercel project settings.' });
  }

  const MODEL = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const rawThinking = (process.env.ANTHROPIC_THINKING || DEFAULT_THINKING).toLowerCase().trim();
  const THINKING = VALID_THINKING.indexOf(rawThinking) !== -1 ? rawThinking : DEFAULT_THINKING;

  const rawEffort = (process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT).toLowerCase().trim();
  const EFFORT = VALID_EFFORT.indexOf(rawEffort) !== -1 ? rawEffort : DEFAULT_EFFORT;

  try {
    const { system, user, maxTokens } = req.body || {};
    if (!system || !user) {
      return res.status(400).json({ error: 'Missing system or user prompt' });
    }

    const outTokens = Math.max(parseInt(maxTokens, 10) || 2500, MIN_MAX_TOKENS);

    const payload = {
      model: MODEL,
      max_tokens: outTokens,
      // Large static system prompt sent as a cacheable block → faster/cheaper repeats.
      system: [
        { type: 'text', text: String(system), cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: String(user) }],
      // Effort governs ALL token spend (thinking + text). Low keeps these
      // schema-bound extraction calls fast and inside the max_tokens ceiling.
      output_config: { effort: EFFORT },
      thinking: { type: THINKING },
    };

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
        body: JSON.stringify(payload),
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
      // Surface model + thinking/effort so a bad combination is obvious.
      return res.status(response.status === 200 ? 500 : response.status)
                .json({ error: msg + ' [model: ' + MODEL + ', thinking: ' + THINKING + ', effort: ' + EFFORT + ']' });
    }

    // Robust extraction: concatenate every text block, ignore non-text blocks.
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .map(b => (b && typeof b.text === 'string') ? b.text : '')
      .join('')
      .trim();

    if (!text) {
      const blockTypes = blocks.map(b => (b && b.type) ? b.type : 'unknown').join(',') || 'none';
      const stop = data.stop_reason || 'unknown';
      console.warn('[analyze] empty text', { model: MODEL, thinking: THINKING, effort: EFFORT, stop_reason: stop, blocks: blockTypes, usage: data.usage });
      return res.status(502).json({
        error: 'Model returned no text [model: ' + MODEL + ', thinking: ' + THINKING + ', effort: ' + EFFORT +
               ', stop_reason: ' + stop + ', blocks: ' + blockTypes +
               ']. If blocks include thinking, lower ANTHROPIC_EFFORT or set ANTHROPIC_THINKING=disabled.'
      });
    }

    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
