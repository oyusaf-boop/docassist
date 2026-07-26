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
import { validateAnalysisRequest } from './requestValidation.js';
import { ModelOutputError, validateModelOutput } from './outputValidation.js';
import {
  acquireAnalysisSlot,
  analysisRequestAllowed,
  clientKey,
} from './rateLimit.js';

const DEFAULT_MODEL    = 'claude-sonnet-5';
const DEFAULT_THINKING = 'disabled';
const DEFAULT_EFFORT   = 'low';

const VALID_EFFORT   = ['low', 'medium', 'high', 'xhigh', 'max'];
const VALID_THINKING = ['disabled', 'adaptive'];

const ANTHROPIC_TIMEOUT_MS = 55000; // just under Vercel's 60s function ceiling
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

  const key = clientKey(req);
  const limit = analysisRequestAllowed(key);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: 'Too many analysis requests. Try again shortly.' });
  }

  const releaseAnalysisSlot = acquireAnalysisSlot(key);
  if (!releaseAnalysisSlot) {
    res.setHeader('Retry-After', '2');
    return res.status(429).json({ error: 'Analysis capacity is busy. Try again shortly.' });
  }

  try {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in Vercel project settings.' });
  }

  const MODEL = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  const rawThinking = (process.env.ANTHROPIC_THINKING || DEFAULT_THINKING).toLowerCase().trim();
  const THINKING = VALID_THINKING.indexOf(rawThinking) !== -1 ? rawThinking : DEFAULT_THINKING;

  const rawEffort = (process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT).toLowerCase().trim();
  const EFFORT = VALID_EFFORT.indexOf(rawEffort) !== -1 ? rawEffort : DEFAULT_EFFORT;

    const validated = validateAnalysisRequest(req);
    if (validated.error) {
      return res.status(validated.status).json({ error: validated.error });
    }
    const { task, taskId, encounter } = validated;
    const system = task.buildSystem ? task.buildSystem(encounter) : task.system;

    const payload = {
      model: MODEL,
      max_tokens: task.maxTokens,
      // Large static system prompt sent as a cacheable block → faster/cheaper repeats.
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: encounter }],
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
      console.error('[analyze] upstream request failed', {
        taskId,
        model: MODEL,
        reason: err && err.message ? err.message : 'network error',
      });
      return res.status(502).json({ error: 'The analysis service is temporarily unavailable. Please retry.' });
    }
    clearTimeout(timer);

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn('[analyze] non-JSON upstream response', {
        taskId,
        model: MODEL,
        status: response.status,
        responseHead: raw.slice(0, 200),
      });
      return res.status(502).json({ error: 'The analysis service returned an invalid response. Please retry.' });
    }

    if (!response.ok || data.error) {
      const msg = (data.error && (data.error.message || data.error.type)) || ('Upstream error HTTP ' + response.status);
      console.warn('[analyze] upstream error', {
        taskId,
        model: MODEL,
        thinking: THINKING,
        effort: EFFORT,
        status: response.status,
        reason: msg,
      });
      return res.status(502).json({ error: 'The analysis service could not complete this section. Please retry.' });
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
      console.warn('[analyze] empty text', { taskId, model: MODEL, thinking: THINKING, effort: EFFORT, stop_reason: stop, blocks: blockTypes, usage: data.usage });
      return res.status(502).json({ error: 'The analysis service returned an incomplete result. Please retry.' });
    }

    let validatedText;
    try {
      validatedText = validateModelOutput(taskId, text);
    } catch (err) {
      if (!(err instanceof ModelOutputError)) throw err;
      console.warn('[analyze] invalid model output', {
        taskId,
        model: MODEL,
        reason: err.message,
      });
      return res.status(502).json({
        error: 'The analysis service returned an incomplete or invalid result. Please retry.',
      });
    }

    return res.status(200).json({ text: validatedText });

  } catch (err) {
    console.error('[analyze] unexpected error', {
      reason: err && err.message ? err.message : 'unknown error',
    });
    return res.status(500).json({ error: 'The analysis could not be completed. Please retry.' });
  } finally {
    releaseAnalysisSlot();
  }
}
