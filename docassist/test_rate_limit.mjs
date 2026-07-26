import assert from 'node:assert/strict';
import {
  acquireAnalysisSlot,
  analysisRequestAllowed,
  clearLoginFailures,
  clientKey,
  loginAttemptAllowed,
  recordLoginFailure,
  resetRateLimitStateForTests,
} from './api/rateLimit.js';

let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

resetRateLimitStateForTests();
check(clientKey({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } }), '203.0.113.5', 'uses first forwarded address');
check(clientKey({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1', 'falls back to socket address');

const loginKey = 'login-client';
for (let i = 0; i < 5; i += 1) {
  check(loginAttemptAllowed(loginKey, 1000).allowed, true, 'login attempt is initially allowed');
  recordLoginFailure(loginKey, 1000);
}
check(loginAttemptAllowed(loginKey, 1000), { allowed: false, retryAfter: 900 }, 'sixth login attempt is throttled');
check(loginAttemptAllowed(loginKey, 901001).allowed, true, 'login window expires');
recordLoginFailure(loginKey, 901001);
clearLoginFailures(loginKey);
check(loginAttemptAllowed(loginKey, 901001).allowed, true, 'successful login clears failures');

const analysisKey = 'analysis-client';
for (let i = 0; i < 20; i += 1) {
  check(analysisRequestAllowed(analysisKey, 2000).allowed, true, 'analysis request is within limit');
}
check(analysisRequestAllowed(analysisKey, 2000), { allowed: false, retryAfter: 60 }, 'twenty-first analysis is throttled');
check(analysisRequestAllowed(analysisKey, 62000).allowed, true, 'analysis window expires');

resetRateLimitStateForTests();
const releaseOne = acquireAnalysisSlot('client-a');
const releaseTwo = acquireAnalysisSlot('client-a');
check(typeof releaseOne, 'function', 'first client slot acquired');
check(typeof releaseTwo, 'function', 'second client slot acquired');
check(acquireAnalysisSlot('client-a'), null, 'third slot for same client rejected');
const releaseThree = acquireAnalysisSlot('client-b');
const releaseFour = acquireAnalysisSlot('client-c');
check(typeof releaseThree, 'function', 'third global slot acquired');
check(typeof releaseFour, 'function', 'fourth global slot acquired');
check(acquireAnalysisSlot('client-d'), null, 'fifth global slot rejected');
releaseOne();
releaseOne();
const releaseFive = acquireAnalysisSlot('client-d');
check(typeof releaseFive, 'function', 'released slot can be reacquired exactly once');

releaseTwo();
releaseThree();
releaseFour();
releaseFive();
console.log(`Rate-limit tests passed: ${assertions} assertions`);
