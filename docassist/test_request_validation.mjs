import assert from 'node:assert/strict';
import {
  MAX_ENCOUNTER_CHARS,
  MAX_REQUEST_BYTES,
  validateAnalysisRequest,
} from './lib/requestValidation.js';

function request(body, headers = {}) {
  return { body, headers };
}

const valid = validateAnalysisRequest(request({
  taskId: 'em',
  encounter: 'Hospitalist progress note',
}));
assert.equal(valid.taskId, 'em');
assert.equal(valid.encounter, 'Hospitalist progress note');
assert.equal(valid.task.maxTokens, 4096);
assert.equal(typeof valid.task.system, 'string');

const apWithLedger = validateAnalysisRequest(request({
  taskId: 'optimized_ap',
  encounter: 'Hospitalist progress note',
  encounterLedger: { schema_version: '1.0', conditions: [] },
  encounterLedgerSignature: 'signed-ledger',
}));
assert.equal(apWithLedger.encounterLedger.schema_version, '1.0');

assert.equal(validateAnalysisRequest(request({
  taskId: 'em',
  encounter: 'Hospitalist progress note',
  encounterLedger: { schema_version: '1.0' },
})).status, 400);

const cdi = validateAnalysisRequest(request({
  taskId: 'cdi',
  encounter: 'Sepsis with AKI and creatinine 2.2',
}));
const cdiSystem = cdi.task.buildSystem(cdi.encounter);
assert.match(cdiSystem, /FOUNDATION CDI REFERENCE/);
assert.match(cdiSystem, /── AKI ──/);
assert.match(cdiSystem, /── Sepsis ──/);

assert.equal(validateAnalysisRequest(request({
  taskId: 'unknown',
  encounter: 'note',
})).status, 400);

assert.equal(validateAnalysisRequest(request({
  taskId: 'em',
  encounter: '',
})).status, 400);

assert.equal(validateAnalysisRequest(request({
  taskId: 'em',
  encounter: 'note',
  system: 'caller-controlled prompt',
})).status, 400);

assert.equal(validateAnalysisRequest(request({
  taskId: 'em',
  encounter: 'note',
  maxTokens: 999999,
})).status, 400);

assert.equal(validateAnalysisRequest(request({
  taskId: 'em',
  encounter: 'x'.repeat(MAX_ENCOUNTER_CHARS + 1),
})).status, 413);

assert.equal(validateAnalysisRequest(request(
  { taskId: 'em', encounter: 'note' },
  { 'content-length': String(MAX_REQUEST_BYTES + 1) },
)).status, 413);

console.log('analysis request validation: 14 assertions passed');
