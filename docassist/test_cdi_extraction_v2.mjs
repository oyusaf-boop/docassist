import assert from 'node:assert/strict';
import {
  CDI_EXTRACTION_V2_SCHEMA,
  transformCdiExtractionV2
} from './api/cdiExtractionV2.js';

assert.equal(CDI_EXTRACTION_V2_SCHEMA.properties.schema_version.const, '2.0');
assert.equal(CDI_EXTRACTION_V2_SCHEMA.properties.diagnoses.type, 'array');
assert.equal(CDI_EXTRACTION_V2_SCHEMA.properties.code_candidates.type, 'array');

const output = transformCdiExtractionV2({
  schema_version: '2.0',
  diagnoses: [{
    diagnosis: 'Acute kidney injury',
    documentation_status: 'documented',
    clinical_support: 'supported',
    severity: 'warning',
    meat_status: 'met',
    clinical_rationale: 'Creatinine doubled from 1.0 to 2.0, supporting the documented acute kidney injury.',
    evidence: ['Creatinine increased from 1.0 to 2.0'],
    missing_evidence: [],
    action: 'Document the baseline and trajectory.'
  }],
  code_candidates: [{
    code: 'N17.9',
    description: 'Acute kidney failure, unspecified',
    role: 'secondary',
    support_status: 'confirmed',
    evidence: ['AKI documented'],
    missing_evidence: [],
    note: ''
  }],
  drg_context: {
    principal_diagnosis: 'Pneumonia',
    candidate_number: '',
    candidate_description: '',
    evidence: ['Admitted for pneumonia'],
    missing_evidence: ['Discharge diagnoses']
  }
});

assert.equal(output.cdi_alerts[0].status, 'confirmed');
assert.equal(
  output.cdi_alerts[0].body,
  'Creatinine doubled from 1.0 to 2.0, supporting the documented acute kidney injury.'
);
assert.equal(output.icd_codes[0].cc_mcc_status, 'cc');
assert.equal(output.drg.status, 'not_grouped');
assert.equal(output.drg.impact_available, false);
assert.equal(output.summary.mcc_cc_count, '');

assert.throws(
  () => transformCdiExtractionV2({ schema_version: '1.0', diagnoses: [], code_candidates: [] }),
  /invalid schema version/
);

const fallbackOutput = transformCdiExtractionV2({
  schema_version: '2.0',
  diagnoses: [{
    diagnosis: 'Acute respiratory failure',
    documentation_status: 'clarification_needed',
    clinical_support: 'partial',
    severity: 'warning',
    meat_status: 'partial',
    evidence: ['Oxygen requirement increased from room air to 4 L nasal cannula'],
    missing_evidence: ['Baseline oxygen requirement', 'Provider diagnostic statement'],
    action: 'Clarify whether acute respiratory failure is clinically present.'
  }],
  code_candidates: [],
  drg_context: {
    principal_diagnosis: '',
    candidate_number: '',
    candidate_description: '',
    evidence: [],
    missing_evidence: []
  }
});

assert.match(fallbackOutput.cdi_alerts[0].body, /Acute respiratory failure requires clarification/);
assert.match(fallbackOutput.cdi_alerts[0].body, /4 L nasal cannula/);
assert.doesNotMatch(fallbackOutput.cdi_alerts[0].body, /clarification opportunity/i);

console.log('clinical_extraction_v2 assertions passed');
