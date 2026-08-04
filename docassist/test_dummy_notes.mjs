import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAnalysisRequest } from './lib/requestValidation.js';

const notes = JSON.parse(readFileSync(new URL('./dummy_notes.json', import.meta.url), 'utf8'));
assert.equal(notes.length, 6, 'six representative dummy notes are present');

let assertions = 1;
for (const fixture of notes) {
  assert.match(fixture.id, /^[a-z0-9-]+$/, `${fixture.id} has a stable identifier`);
  assert.ok(fixture.note.length >= 100, `${fixture.id} contains a useful clinical scenario`);
  assert.ok(fixture.expected_focus.length >= 2, `${fixture.id} declares review targets`);
  assertions += 3;

  for (const taskId of ['em', 'cdi', 'sepsis', 'optimized_ap']) {
    const result = validateAnalysisRequest({
      headers: { 'content-type': 'application/json' },
      body: { taskId, encounter: fixture.note },
    });
    assert.equal(result.error, undefined, `${fixture.id} is accepted for ${taskId}`);
    assertions += 1;
  }
}

console.log(`dummy-note fixtures: ${assertions} assertions passed`);
