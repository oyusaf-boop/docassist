import crypto from 'node:crypto';

export const SESSION_COOKIE = 'da_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function credentialsMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  return safeEqual(actual, expected);
}

export function createSessionToken(secret, now = Date.now()) {
  if (!secret) throw new Error('SESSION_SECRET is required');
  const payload = encode(JSON.stringify({
    version: 1,
    issuedAt: Math.floor(now / 1000),
    expiresAt: Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS,
  }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !safeEqual(parts[1], sign(parts[0], secret))) return false;

  try {
    const payload = JSON.parse(decode(parts[0]));
    const currentTime = Math.floor(now / 1000);
    return payload.version === 1
      && Number.isInteger(payload.issuedAt)
      && Number.isInteger(payload.expiresAt)
      && payload.issuedAt <= currentTime
      && payload.expiresAt > currentTime;
  } catch {
    return false;
  }
}

export function getCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function hasValidSession(req, secret = process.env.SESSION_SECRET) {
  return verifySessionToken(getCookie(req.headers.cookie, SESSION_COOKIE), secret);
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}
