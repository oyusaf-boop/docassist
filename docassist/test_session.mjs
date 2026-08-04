import assert from 'node:assert/strict';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  credentialsMatch,
  getCookie,
  hasValidSession,
  sessionCookie,
  verifySessionToken,
} from './api/session.js';

const secret = 'test-secret-with-enough-entropy';
const now = Date.UTC(2026, 6, 26);
const token = createSessionToken(secret, now);

assert.equal(verifySessionToken(token, secret, now), true);
assert.equal(verifySessionToken(token, 'wrong-secret', now), false);
assert.equal(verifySessionToken(`${token}changed`, secret, now), false);
assert.equal(verifySessionToken('authenticated', secret, now), false);
assert.equal(verifySessionToken('', secret, now), false);
assert.equal(
  verifySessionToken(token, secret, now + (SESSION_MAX_AGE_SECONDS + 1) * 1000),
  false,
);
assert.equal(credentialsMatch('correct', 'correct'), true);
assert.equal(credentialsMatch('wrong', 'correct'), false);
assert.equal(getCookie('theme=dark; da_session=abc.def', SESSION_COOKIE), 'abc.def');
const currentToken = createSessionToken(secret);
assert.equal(
  hasValidSession({ headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${currentToken}` } }, secret),
  true,
);
assert.match(sessionCookie(token), /HttpOnly; Secure; SameSite=Strict/);

console.log('session security: 11 assertions passed');
