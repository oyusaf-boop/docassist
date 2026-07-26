import assert from 'node:assert/strict';
import handler from './api/analyze.js';
import { createSessionToken, SESSION_COOKIE } from './api/session.js';

const originalFetch = global.fetch;
const originalEnv = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  SESSION_SECRET: process.env.SESSION_SECRET,
};
const secret = 'integration-test-session-secret-with-enough-entropy';
process.env.ANTHROPIC_API_KEY = 'test-key';
process.env.SESSION_SECRET = secret;

let assertions = 0;

function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function request(taskId = 'discharge_course') {
  const token = createSessionToken(secret);
  return {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      'content-type': 'application/json',
    },
    body: { taskId, encounter: 'Hospital course source note.' },
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function runWithUpstream(upstream, taskId) {
  global.fetch = async () => upstream;
  const res = response();
  await handler(request(taskId), res);
  return res;
}

function anthropicResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

try {
  const valid = await runWithUpstream(anthropicResponse({
    content: [{ type: 'text', text: '{"hospital_course":"Patient improved and was discharged."}' }],
    stop_reason: 'end_turn',
  }));
  equal(valid.statusCode, 200, 'valid model output succeeds');
  equal(
    JSON.parse(valid.body.text).hospital_course,
    'Patient improved and was discharged.',
    'validated output reaches the client',
  );

  const malformedUpstream = await runWithUpstream(anthropicResponse('<html>bad gateway</html>'));
  equal(malformedUpstream.statusCode, 502, 'non-JSON upstream response is rejected');
  equal(
    malformedUpstream.body.error,
    'The analysis service returned an invalid response. Please retry.',
    'upstream body details are not exposed',
  );

  const malformedModel = await runWithUpstream(anthropicResponse({
    content: [{ type: 'text', text: '{"hospital_course":' }],
    stop_reason: 'end_turn',
  }));
  equal(malformedModel.statusCode, 502, 'malformed model JSON is rejected');
  equal(
    malformedModel.body.error,
    'The analysis service returned an incomplete or invalid result. Please retry.',
    'schema failure is generic and retryable',
  );

  const missingField = await runWithUpstream(anthropicResponse({
    content: [{ type: 'text', text: '{"unexpected":"value"}' }],
    stop_reason: 'end_turn',
  }));
  equal(missingField.statusCode, 502, 'schema-incomplete output is rejected');

  const empty = await runWithUpstream(anthropicResponse({
    content: [{ type: 'thinking', thinking: 'internal' }],
    stop_reason: 'max_tokens',
  }));
  equal(empty.statusCode, 502, 'empty text output is rejected');
  equal(
    empty.body.error,
    'The analysis service returned an incomplete result. Please retry.',
    'thinking and model settings are not exposed',
  );

  const upstreamError = await runWithUpstream(anthropicResponse({
    error: { type: 'overloaded_error', message: 'provider detail' },
  }, false, 529));
  equal(upstreamError.statusCode, 502, 'upstream status is normalized');
  equal(
    upstreamError.body.error,
    'The analysis service could not complete this section. Please retry.',
    'provider details are not exposed',
  );

  global.fetch = async () => {
    throw new Error('socket detail');
  };
  const unavailable = response();
  await handler(request(), unavailable);
  equal(unavailable.statusCode, 502, 'network failure is normalized');
  equal(
    unavailable.body.error,
    'The analysis service is temporarily unavailable. Please retry.',
    'network details are not exposed',
  );
} finally {
  global.fetch = originalFetch;
  if (originalEnv.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
  if (originalEnv.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalEnv.SESSION_SECRET;
}

console.log(`analyze API integration: ${assertions} assertions passed`);
