import {
  createSessionToken,
  credentialsMatch,
  hasValidSession,
  sessionCookie,
} from '../lib/session.js';
import {
  clearLoginFailures,
  clientKey,
  loginAttemptAllowed,
  recordLoginFailure,
} from '../lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(hasValidSession(req) ? 200 : 401)
      .json({ authenticated: hasValidSession(req) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.APP_PASSWORD || !process.env.SESSION_SECRET) {
    console.error('[auth] Missing APP_PASSWORD or SESSION_SECRET');
    return res.status(503).json({ error: 'Authentication is temporarily unavailable' });
  }

  const key = clientKey(req);
  const limit = loginAttemptAllowed(key);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }

  const password = req.body && req.body.password;
  if (credentialsMatch(password, process.env.APP_PASSWORD)) {
    clearLoginFailures(key);
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken(process.env.SESSION_SECRET)));
    return res.status(200).json({ authenticated: true });
  }
  recordLoginFailure(key);
  return res.status(401).json({ error: 'Incorrect password' });
}
