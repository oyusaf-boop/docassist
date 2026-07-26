import { getTaskDefinition } from './taskDefinitions.js';

export const MAX_REQUEST_BYTES = 160_000;
export const MAX_ENCOUNTER_CHARS = 120_000;

export function requestByteLength(req) {
  const declared = Number.parseInt(req.headers?.['content-length'], 10);
  if (Number.isFinite(declared) && declared >= 0) return declared;
  return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
}

export function validateAnalysisRequest(req) {
  if (requestByteLength(req) > MAX_REQUEST_BYTES) {
    return { error: 'Request is too large', status: 413 };
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid request', status: 400 };
  }

  const allowedFields = new Set(['taskId', 'encounter']);
  if (Object.keys(body).some(key => !allowedFields.has(key))) {
    return { error: 'Unsupported request fields', status: 400 };
  }

  const task = getTaskDefinition(body.taskId);
  if (!task) {
    return { error: 'Unsupported analysis task', status: 400 };
  }

  if (typeof body.encounter !== 'string' || !body.encounter.trim()) {
    return { error: 'Encounter text is required', status: 400 };
  }

  if (body.encounter.length > MAX_ENCOUNTER_CHARS) {
    return { error: 'Encounter text is too long', status: 413 };
  }

  return {
    task,
    taskId: body.taskId,
    encounter: body.encounter.trim(),
  };
}
