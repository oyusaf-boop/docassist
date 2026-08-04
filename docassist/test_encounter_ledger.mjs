import assert from 'node:assert/strict';
import {
  attachSepsisLedger,
  buildEncounterLedger,
  reconcileExtractionWithLedger,
  signEncounterLedger,
  verifyEncounterLedger,
} from './api/encounterLedger.js';

const extraction = {
  diagnoses: [
    { diagnosis: 'Acute kidney injury', documentation_status: 'clarification_needed', clinical_support: 'supported', evidence: ['Cr 1.1 to 1.3'], missing_evidence: [] },
    { diagnosis: 'Chronic kidney disease', documentation_status: 'not_documented', clinical_support: 'partial', evidence: [], missing_evidence: [] },
    { diagnosis: 'Acute systolic heart failure', documentation_status: 'documented', clinical_support: 'supported', evidence: ['Documented in A&P'], missing_evidence: [] },
  ],
  code_candidates: [
    { code: 'N17.9', description: 'Acute kidney failure, unspecified', support_status: 'query', note: '' },
  ],
};

const ledger = buildEncounterLedger('Creatinine 1.1 to 1.3. Acute systolic heart failure documented.', extraction);
assert.equal(ledger.calculations.creatinine.delta, 0.2);
assert.equal(ledger.calculations.creatinine.absolute_threshold_met, false);
assert.equal(ledger.conditions.find(item => /kidney injury/i.test(item.name)).permission, 'prohibited');
assert.equal(ledger.conditions.find(item => /chronic kidney/i.test(item.name)).permission, 'prohibited');
assert.deepEqual(ledger.established_diagnoses, ['Acute systolic heart failure']);

const reconciled = reconcileExtractionWithLedger(extraction, ledger);
assert.equal(reconciled.diagnoses[0].clinical_support, 'unsupported');
assert.equal(reconciled.code_candidates[0].support_status, 'unsupported');
const withSepsis = attachSepsisLedger(ledger, {
  infection_documented: true,
  organ_dysfunction_documented: false,
  sepsis2: { verdict: 'indeterminate' },
  sepsis3: { verdict: 'indeterminate' },
  sep1: { status: 'not_applicable' },
});
assert.equal(withSepsis.sepsis.sepsis_permission, 'prohibited');
assert.equal(withSepsis.sepsis.severe_sepsis_permission, 'prohibited');
const signature = signEncounterLedger(withSepsis, 'same note', 'test-secret');
assert.equal(verifyEncounterLedger(withSepsis, 'same note', signature, 'test-secret'), true);
assert.equal(verifyEncounterLedger(withSepsis, 'different note', signature, 'test-secret'), false);
console.log('encounter ledger regression tests passed');
