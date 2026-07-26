import {
  createSessionToken,
  credentialsMatch,
  hasValidSession,
  sessionCookie,
} from './session.js';

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

  const password = req.body && req.body.password;
  if (credentialsMatch(password, process.env.APP_PASSWORD)) {
    res.setHeader('Set-Cookie', sessionCookie(createSessionToken(process.env.SESSION_SECRET)));
    return res.status(200).json({ authenticated: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
}
