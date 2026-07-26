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
  cdi_alerts: [],
  drg: {
    current_number: '', current_desc: '', current_gmlos: '',
    optimized_number: '', optimized_desc: '', optimized_gmlos: '',
    revenue_impact: '', impact_available: false,
  },
  icd_codes: [],
  summary: { mcc_cc_count: '0' },
})));
equal(cdi.drg.impact_available, false, 'valid CDI output is normalized');

rejects(() => validateModelOutput('cdi', JSON.stringify({
  cdi_alerts: new Array(7).fill({ severity: 'info', title: 'x', body: 'x', action: 'x' }),
  drg: {}, icd_codes: [], summary: {},
})), 'CDI alert cap is enforced');

const course = JSON.parse(validateModelOutput('discharge_course', '{"hospital_course":"Patient improved and was discharged."}'));
equal(course.hospital_course, 'Patient improved and was discharged.', 'discharge course validates');

equal(validateModelOutput('optimized_ap', '===AP_TEXT===\\n# Problem\\nPlan\\n===END===').includes('# Problem'), true, 'complete A&P markers validate');
rejects(() => validateModelOutput('optimized_ap', '# Problem\\nPlan'), 'incomplete A&P markers are rejected');

console.log(`model output validation: ${assertions} assertions passed`);
