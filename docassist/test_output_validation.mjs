import assert from 'node:assert/strict';
import { ModelOutputError, validateModelOutput } from './api/outputValidation.js';

let assertions = 0;
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}
function rejects(fn, message) {
  assert.throws(fn, ModelOutputError, message);
  assertions += 1;
}

const em = JSON.parse(validateModelOutput('em', JSON.stringify({
  note_type: 'Hospital progress note',
  em_facts: {
    encounter_type: 'progress',
    total_time_minutes: null,
    problems: [{ text: 'Sepsis threatening life', tier: 'high' }],
    data_items: ['review_unique_test_result', 'order_unique_test'],
    risk_matches: [{ example: 'Decision regarding escalation of care', tier: 'high' }],
  },
  rationale: { problems: 'Sepsis is life threatening.', data: 'Two unique data activities.', risk: 'Escalation was considered.' },
  already_documented: ['Sepsis'],
  add_to_upgrade: [],
  gaps: [],
})));
equal(em.em.justified_code, '99233', 'server scorer selects subsequent high code');
equal(em.em.scoring_basis, 'mdm_2of3', 'server records deterministic basis');
equal(em.em.mdm.data.level, 'Low', 'data tier is computed rather than accepted from model');

const timed = JSON.parse(validateModelOutput('em', JSON.stringify({
  note_type: 'Hospital progress note',
  em_facts: {
    encounter_type: 'progress',
    total_time_minutes: 52,
    problems: [{ text: 'Stable hypertension', tier: 'low' }],
    data_items: [],
    risk_matches: [{ example: 'Continue medication', tier: 'low' }],
  },
  rationale: { problems: 'Stable condition.', data: 'No qualifying data.', risk: 'Low risk.' },
  already_documented: [],
  add_to_upgrade: [],
  gaps: [],
})));
equal(timed.em.justified_code, '99233', 'documented time can support a higher code');
equal(timed.em.justified_level, 'High Complexity', 'displayed level follows the deterministic time code');
equal(timed.em.scoring_basis, 'time', 'time basis is explicit');

const minimal = JSON.parse(validateModelOutput('em', JSON.stringify({
  note_type: 'Initial hospital care',
  em_facts: {
    encounter_type: 'new_admit',
    total_time_minutes: null,
    problems: [],
    data_items: [],
    risk_matches: [],
  },
  rationale: { problems: 'No qualifying problems.', data: 'No qualifying data.', risk: 'No qualifying risk.' },
  already_documented: [],
  add_to_upgrade: [],
  gaps: [],
})));
equal(minimal.em.justified_code, '99221', 'initial care applies the lowest supported family code');

rejects(() => validateModelOutput('em', '{"em":{"justified_code":"99233"}}'), 'model-selected code without facts is rejected');
rejects(() => validateModelOutput('em', JSON.stringify({
  note_type: 'Progress',
  em_facts: { encounter_type: 'progress', total_time_minutes: null, problems: [], data_items: ['invented_item'], risk_matches: [] },
  rationale: { problems: 'None.', data: 'None.', risk: 'None.' },
  already_documented: [], add_to_upgrade: [], gaps: [],
})), 'unknown data identifier is rejected');
rejects(() => validateModelOutput('em', 'not json'), 'malformed JSON is rejected');

const cdi = JSON.parse(validateModelOutput('cdi', JSON.stringify({
  cdi_alerts: [{
    severity: 'warning', title: 'AKI clarification', body: 'Creatinine increased.',
    action: 'Clarify acuity if clinically appropriate.', status: 'query',
    evidence: ['Creatinine 2.0 from 1.0'], missing_evidence: ['Timing of change'],
    meat_status: 'partial',
  }],
  drg: {
    status: 'candidate', current_number: '', current_desc: '',
    candidate_number: '', candidate_desc: '', principal_diagnosis: 'Pneumonia',
    evidence: ['Pneumonia documented'], missing_evidence: ['Discharge diagnoses'],
    verified_by: '', verification_note: 'Verify with grouper.',
  },
  icd_codes: [{
    code: 'J18.9', description: 'Pneumonia, unspecified', type: 'principal_candidate',
    cc_mcc_status: 'unknown', support_status: 'query',
    evidence: ['Pneumonia documented'], missing_evidence: ['Organism'],
    note: 'Clarify organism.',
  }],
  summary: { coding_note: 'Coder review required.' },
})));
equal(cdi.drg.impact_available, false, 'valid CDI output is normalized');
equal(cdi.drg.revenue_impact, '', 'model revenue estimates are discarded');
equal(cdi.drg.current_gmlos, '', 'model GMLOS estimates are discarded');
equal(cdi.icd_codes[0].support_status, 'query', 'ICD support state is preserved');
equal(cdi.cdi_alerts[0].status, 'query', 'CDI evidence state is preserved');
equal(cdi.cdi_alerts[0].evidence.length, 1, 'CDI alert requires traceable evidence');

rejects(() => validateModelOutput('cdi', JSON.stringify({
  cdi_alerts: [{ severity: 'warning', title: 'AKI', body: 'Possible.', action: 'Clarify.', status: 'query', evidence: [], missing_evidence: [], meat_status: 'partial' }],
  drg: { status: 'not_grouped', current_number: '', current_desc: '', candidate_number: '', candidate_desc: '', principal_diagnosis: '', evidence: [], missing_evidence: [], verified_by: '', verification_note: 'Insufficient data.' },
  icd_codes: [], summary: { coding_note: 'Review required.' },
})), 'CDI query without evidence is rejected');

rejects(() => validateModelOutput('cdi', JSON.stringify({
  cdi_alerts: new Array(7).fill({ severity: 'info', title: 'x', body: 'x', action: 'x', status: 'confirmed', evidence: ['x'], missing_evidence: [], meat_status: 'met' }),
  drg: {}, icd_codes: [], summary: {},
})), 'CDI alert cap is enforced');

rejects(() => validateModelOutput('cdi', JSON.stringify({
  cdi_alerts: [],
  drg: { status: 'candidate', current_number: '', current_desc: '', candidate_number: '177', candidate_desc: 'Respiratory infections', principal_diagnosis: 'Pneumonia', evidence: [], missing_evidence: [], verified_by: '', verification_note: 'Candidate.' },
  icd_codes: [], summary: { coding_note: 'Review required.' },
})), 'candidate DRG without evidence is rejected');

rejects(() => validateModelOutput('cdi', JSON.stringify({
  cdi_alerts: [],
  drg: { status: 'not_grouped', current_number: '', current_desc: '', candidate_number: '', candidate_desc: '', principal_diagnosis: '', evidence: [], missing_evidence: [], verified_by: '', verification_note: 'Insufficient data.' },
  icd_codes: [{ code: 'N17.9', description: 'Acute kidney failure', type: 'secondary', cc_mcc_status: 'cc', support_status: 'query', evidence: ['Creatinine elevated'], missing_evidence: [], note: 'Clarify acuity.' }],
  summary: { coding_note: 'Review required.' },
})), 'ICD query without missing evidence is rejected');

const sepsis = JSON.parse(validateModelOutput('sepsis', JSON.stringify({
  sepsis_facts: {
    sepsis_or_infection_suspected: true, infection_documented: true,
    temperature_c: 39.1, heart_rate: 112, respiratory_rate: 24, paco2: null, wbc: 14.2, bands_percent: null,
    pao2: 80, fio2: 0.4, respiratory_support: true, platelets: 90, bilirubin: 2.5,
    map: 62, gcs: 14, creatinine: 2.8, urine_output_ml_day: null,
    dopamine_mcg_kg_min: null, dobutamine_mcg_kg_min: null, epinephrine_mcg_kg_min: null, norepinephrine_mcg_kg_min: null,
    baseline_pao2: 100, baseline_fio2: 0.21, baseline_respiratory_support: false,
    baseline_platelets: 210, baseline_bilirubin: 0.8, baseline_map: 80, baseline_gcs: 15, baseline_creatinine: 1.0, baseline_urine_output_ml_day: null,
    baseline_temperature_c: null, baseline_heart_rate: null, baseline_respiratory_rate: null, baseline_paco2: null, baseline_wbc: null, baseline_bands_percent: null,
    baseline_dopamine_mcg_kg_min: 0, baseline_dobutamine_mcg_kg_min: 0, baseline_epinephrine_mcg_kg_min: 0, baseline_norepinephrine_mcg_kg_min: 0,
  },
  organ_dysfunction_documented: true, denial_risk: 'low',
  documentation_tips: ['Link organ dysfunction to sepsis.'],
  sep1: { applicable: true, status: 'indeterminate', evidence: ['Lactate obtained'], missing: ['Bundle timestamps'] },
})));
equal(sepsis.sepsis.sepsis2.criteria_met, 4, 'SIRS count is deterministic');
equal(sepsis.sepsis.sepsis3.sofa_score, 10, 'SOFA current score is deterministic');
equal(sepsis.sepsis.sepsis3.baseline_sofa_score, 0, 'SOFA baseline is deterministic');
equal(sepsis.sepsis.sepsis3.verdict, 'met', 'Sepsis-3 verdict uses deterministic acute SOFA change');
equal(sepsis.sepsis.sep1.status, 'indeterminate', 'SEP-1 stays separate from diagnosis criteria');

rejects(() => validateModelOutput('sepsis', JSON.stringify({
  sepsis_facts: { sepsis_or_infection_suspected: true, infection_documented: true, fio2: 40 },
  organ_dysfunction_documented: false, denial_risk: 'unknown', documentation_tips: [],
  sep1: { applicable: false, status: 'not_applicable', evidence: [], missing: [] },
})), 'out-of-range FiO2 is rejected');

const course = JSON.parse(validateModelOutput('discharge_course', '{"hospital_course":"Patient improved and was discharged."}'));
equal(course.hospital_course, 'Patient improved and was discharged.', 'discharge course validates');

equal(validateModelOutput('optimized_ap', '===AP_TEXT===\\n# Problem\\nPlan\\n===END===').includes('# Problem'), true, 'complete A&P markers validate');
rejects(() => validateModelOutput('optimized_ap', '# Problem\\nPlan'), 'incomplete A&P markers are rejected');

console.log(`model output validation: ${assertions} assertions passed`);
