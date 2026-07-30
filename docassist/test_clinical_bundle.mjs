import assert from 'node:assert/strict';
import {
  CLINICAL_BUNDLE_SCHEMA,
  transformClinicalBundle,
} from './api/clinicalBundle.js';

assert.equal(CLINICAL_BUNDLE_SCHEMA.properties.schema_version.const, '1.0');
assert.deepEqual(CLINICAL_BUNDLE_SCHEMA.required, ['schema_version', 'em', 'cdi', 'sepsis']);

const sepsisProperties =
  CLINICAL_BUNDLE_SCHEMA.properties.sepsis.properties.sepsis_facts.properties;
const sepsisFacts = Object.fromEntries(
  Object.keys(sepsisProperties).map(name => [
    name,
    name === 'sepsis_or_infection_suspected' || name === 'infection_documented'
      ? false
      : null,
  ])
);

const result = transformClinicalBundle({
  schema_version: '1.0',
  em: {
    note_type: 'Hospital progress note',
    em_facts: {
      encounter_type: 'progress',
      total_time_minutes: null,
      problems: [{ text: 'Acute illness with systemic symptoms', tier: 'moderate' }],
      data_items: ['review_unique_test_result', 'order_unique_test'],
      risk_matches: [{ example: 'Prescription drug management', tier: 'moderate' }],
    },
    rationale: {
      problems: 'Acute illness is documented.',
      data: 'Test review and ordering are documented.',
      risk: 'Prescription drug management is documented.',
    },
    already_documented: ['Prescription drug management'],
    add_to_upgrade: [],
    gaps: [],
  },
  cdi: {
    schema_version: '2.0',
    diagnoses: [{
      diagnosis: 'Acute kidney injury',
      documentation_status: 'documented',
      clinical_support: 'supported',
      severity: 'warning',
      meat_status: 'met',
      clinical_rationale: 'Creatinine doubled from baseline, supporting documented AKI.',
      evidence: ['Creatinine increased from 1.0 to 2.0'],
      missing_evidence: [],
      action: 'Document the creatinine trajectory.',
    }],
    code_candidates: [{
      code: 'N17.9',
      description: 'Acute kidney failure, unspecified',
      role: 'secondary',
      support_status: 'confirmed',
      evidence: ['AKI documented'],
      missing_evidence: [],
      note: '',
    }],
    drg_context: {
      principal_diagnosis: '',
      candidate_number: '',
      candidate_description: '',
      evidence: [],
      missing_evidence: [],
    },
  },
  sepsis: {
    sepsis_facts: sepsisFacts,
    organ_dysfunction_documented: false,
    denial_risk: 'indeterminate',
    documentation_tips: [],
    sep1: {
      applicable: false,
      status: 'not_applicable',
      evidence: [],
      missing: [],
    },
  },
});

assert.equal(result.em.justified_code, '99232');
assert.equal(result.cdi_alerts[0].title, 'Acute kidney injury');
assert.equal(result.icd_codes[0].cc_mcc_status, 'cc');
assert.equal(result.sepsis.detected, false);
assert.equal(result.sepsis.sep1.status, 'not_applicable');
assert.throws(
  () => transformClinicalBundle({ schema_version: '2.0' }),
  /invalid schema version/
);

console.log('clinical bundle transformation assertions passed');
