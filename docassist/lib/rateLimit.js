const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const ANALYSIS_WINDOW_MS = 60 * 1000;
const ANALYSIS_MAX_REQUESTS = 20;
const MAX_GLOBAL_ANALYSES = 4;
const MAX_CLIENT_ANALYSES = 2;

const loginFailures = new Map();
const analysisRequests = new Map();
const activeByClient = new Map();
let activeAnalyses = 0;

function firstHeaderValue(value) {
  return String(Array.isArray(value) ? value[0] : value || '')
    .split(',')[0]
    .trim();
}

export function clientKey(req) {
  const headers = req && req.headers ? req.headers : {};
  return firstHeaderValue(headers['x-vercel-forwarded-for'])
    || firstHeaderValue(headers['x-forwarded-for'])
    || firstHeaderValue(headers['x-real-ip'])
    || (req && req.socket && req.socket.remoteAddress)
    || 'unknown';
}

function currentWindow(store, key, windowMs, now) {
  const existing = store.get(key);
  if (!existing || now - existing.startedAt >= windowMs) {
    const fresh = { count: 0, startedAt: now };
    store.set(key, fresh);
    return fresh;
  }
  return existing;
}

function retryAfterSeconds(entry, windowMs, now) {
  return Math.max(1, Math.ceil((entry.startedAt + windowMs - now) / 1000));
}

export function loginAttemptAllowed(key, now = Date.now()) {
  const entry = currentWindow(loginFailures, key, LOGIN_WINDOW_MS, now);
  return entry.count < LOGIN_MAX_FAILURES
    ? { allowed: true }
    : { allowed: false, retryAfter: retryAfterSeconds(entry, LOGIN_WINDOW_MS, now) };
}

export function recordLoginFailure(key, now = Date.now()) {
  currentWindow(loginFailures, key, LOGIN_WINDOW_MS, now).count += 1;
}

export function clearLoginFailures(key) {
  loginFailures.delete(key);
}

export function analysisRequestAllowed(key, now = Date.now()) {
  const entry = currentWindow(analysisRequests, key, ANALYSIS_WINDOW_MS, now);
  if (entry.count >= ANALYSIS_MAX_REQUESTS) {
    return { allowed: false, retryAfter: retryAfterSeconds(entry, ANALYSIS_WINDOW_MS, now) };
  }
  entry.count += 1;
  return { allowed: true };
}

export function acquireAnalysisSlot(key) {
  const clientActive = activeByClient.get(key) || 0;
  if (activeAnalyses >= MAX_GLOBAL_ANALYSES || clientActive >= MAX_CLIENT_ANALYSES) {
    return null;
  }

  activeAnalyses += 1;
  activeByClient.set(key, clientActive + 1);
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    activeAnalyses = Math.max(0, activeAnalyses - 1);
    const remaining = Math.max(0, (activeByClient.get(key) || 1) - 1);
    if (remaining === 0) activeByClient.delete(key);
    else activeByClient.set(key, remaining);
  };
}

export function resetRateLimitStateForTests() {
  loginFailures.clear();
  analysisRequests.clear();
  activeByClient.clear();
  activeAnalyses = 0;
}
