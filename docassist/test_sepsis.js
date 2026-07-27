const assert = require('node:assert/strict');
const { scoreSepsis, scoreSirs, scoreSofa } = require('./sepsisScorer.js');

let assertions = 0;
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

equal(scoreSofa({ pao2: 79, fio2: 0.4, respiratory_support: true }).components[0].current_score, 3, 'supported P/F under 200 scores 3');
equal(scoreSofa({ pao2: 80, fio2: 0.4, respiratory_support: true }).components[0].current_score, 2, 'P/F exactly 200 scores 2');
equal(scoreSofa({ platelets: 19 }).components[1].current_score, 4, 'platelets under 20 score 4');
equal(scoreSofa({ platelets: 150 }).components[1].current_score, 0, 'platelets exactly 150 score 0');
equal(scoreSofa({ bilirubin: 12 }).components[2].current_score, 4, 'bilirubin 12 scores 4');
equal(scoreSofa({ bilirubin: 1.2 }).components[2].current_score, 1, 'bilirubin 1.2 scores 1');
equal(scoreSofa({ map: 69 }).components[3].current_score, 1, 'MAP under 70 scores 1');
equal(scoreSofa({ norepinephrine_mcg_kg_min: 0.11 }).components[3].current_score, 4, 'norepinephrine over 0.1 scores 4');
equal(scoreSofa({ gcs: 9 }).components[4].current_score, 3, 'GCS 9 scores 3');
equal(scoreSofa({ gcs: 15 }).components[4].current_score, 0, 'GCS 15 scores 0');
equal(scoreSofa({ creatinine: 2 }).components[5].current_score, 2, 'creatinine 2 scores 2');
equal(scoreSofa({ creatinine: 1, urine_output_ml_day: 150 }).components[5].current_score, 4, 'severe oliguria controls renal score');

const sirs = scoreSirs({ temperature_c: 36, heart_rate: 90, respiratory_rate: 20, paco2: 32, wbc: 12, bands_percent: 10 });
equal(sirs.criteria_met, 0, 'SIRS thresholds are strict at exact boundary values');
equal(sirs.criteria_known, 4, 'all documented SIRS criteria are counted as known');

const indeterminate = scoreSepsis({
  sepsis_or_infection_suspected: true,
  infection_documented: true,
  creatinine: 3,
});
equal(indeterminate.sepsis3.sofa_score, 2, 'known current SOFA points are still reported');
equal(indeterminate.sepsis3.baseline_sofa_score, null, 'missing chronic baseline is explicit');
equal(indeterminate.sepsis3.acute_sofa_change, null, 'acute change is not invented');
equal(indeterminate.sepsis3.verdict, 'indeterminate', 'Sepsis-3 is not confirmed without an acute delta');

const notInfected = scoreSepsis({
  sepsis_or_infection_suspected: false,
  infection_documented: false,
  temperature_c: 39,
  heart_rate: 120,
});
equal(notInfected.sepsis2.verdict, 'indeterminate', 'SIRS without infection does not meet Sepsis-2');

console.log(`deterministic sepsis scorer: ${assertions} assertions passed`);
