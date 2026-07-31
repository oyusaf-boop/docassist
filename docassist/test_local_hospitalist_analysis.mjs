import assert from 'node:assert/strict';
import {
  _test,
  buildLocalHospitalistAnalysis,
} from './api/hospitalistLocalAnalysis.js';

const note = `
Hospital progress note
E. coli UTI on ceftriaxone. AKI with creatinine 2.10; prior baseline creatinine 0.90.
Temp 39.1 C, HR 112, RR 24, WBC 18.4, platelets 92, bilirubin 2.3.
BP 84/48. GCS 13. Oxygen at 4 L/min by nasal cannula.
Reviewed CBC/CMP and chest x-ray. Repeat BMP ordered. Discussed with nephrology.
`;

const extraction = {
  diagnoses: [
    {
      diagnosis: 'Acute kidney injury',
      severity: 'critical',
    },
    {
      diagnosis: 'E. coli urinary tract infection',
      severity: 'warning',
    },
  ],
};

const facts = _test.extractSepsisFacts(note);
assert.equal(facts.temperature_c, 39.1);
assert.equal(facts.heart_rate, 112);
assert.equal(facts.respiratory_rate, 24);
assert.equal(facts.wbc, 18.4);
assert.equal(facts.platelets, 92);
assert.equal(facts.bilirubin, 2.3);
assert.equal(facts.creatinine, 2.1);
assert.equal(facts.baseline_creatinine, 0.9);
assert.equal(facts.map, 60);
assert.equal(facts.gcs, 13);
assert.equal(facts.respiratory_support, true);
assert.equal(facts.infection_documented, true);

const analysis = buildLocalHospitalistAnalysis(note, extraction);
assert.match(analysis.em.justified_code, /^99/);
assert.equal(analysis.em.scoring_basis, 'mdm_2of3');
assert.equal(analysis.sepsis.sepsis2.verdict, 'met');
assert.equal(analysis.sepsis.organ_dysfunction_documented, true);
assert.equal(analysis.sepsis.sepsis3.sofa_score > 0, true);

const negated = _test.extractSepsisFacts('No evidence of infection. Rule out sepsis. HR 70, WBC 8.');
assert.equal(negated.infection_documented, false);

const trend = _test.extractSepsisFacts(
  'Creatinine increased from documented baseline 1.0 to 2.1 mg/dL today. Temperature 102.2 F.'
);
assert.equal(trend.baseline_creatinine, 1);
assert.equal(trend.creatinine, 2.1);
assert.equal(trend.temperature_c, 39);

const incomplete = buildLocalHospitalistAnalysis(
  'Possible urinary infection. Creatinine 2.0 and platelets 120. No baseline is available.',
  { diagnoses: [{ diagnosis: 'Possible urinary infection', severity: 'warning' }] }
);
assert.equal(incomplete.sepsis.sepsis3.verdict, 'indeterminate');
assert.equal(incomplete.sepsis.sepsis3.baseline_complete, false);

console.log('local hospitalist analysis assertions passed');
