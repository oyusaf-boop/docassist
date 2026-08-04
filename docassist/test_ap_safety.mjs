import assert from 'node:assert/strict';
import { validateAPOutput } from './api/apSafety.js';

const ledger = {
  prohibited_diagnoses: ['Acute kidney injury', 'Chronic kidney disease'],
};

assert.equal(validateAPOutput('Heart failure: Continue diuresis.', ledger).safe, true);
assert.equal(validateAPOutput('Acute kidney injury: trend creatinine.', ledger).safe, false);
assert.equal(validateAPOutput('Chronic kidney disease stage 3.', ledger).safe, false);
assert.equal(validateAPOutput('AKI on CKD, likely pre-renal from diuresis.', ledger).safe, false);
assert.equal(validateAPOutput('{{BNP_PROMPT}}', ledger).safe, false);
assert.equal(validateAPOutput('Physician writes the diagnosis manually.', ledger).safe, false);
console.log('A&P safety tests passed');
