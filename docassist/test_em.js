var assert = require('node:assert/strict');
var em = require('./emScorer.js');
var mdm = require('./em_mdm_FY2026.json');
var assertions = 0;

function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}

function score(facts) {
  return em.scoreEM(facts, mdm);
}

var highSubsequent = score({
  encounter_type: 'subsequent', total_time_minutes: null,
  problems: [{ text: 'sepsis', tier: 'high' }, { text: 'acute CHF exacerbation', tier: 'moderate' }],
  data_items: ['review_unique_test_result', 'order_unique_test'],
  risk_matches: [{ tier: 'high', example: 'decision regarding escalation of care' }],
});
equal(highSubsequent.element_levels, { problems: 'high', data: 'low', risk: 'high' }, 'element levels are independently scored');
equal(highSubsequent.supported_code, '99233', 'two high elements support 99233');
equal(highSubsequent.basis, 'mdm_2of3', 'MDM basis is recorded');

var moderateData = score({
  encounter_type: 'subsequent', total_time_minutes: null,
  problems: [{ text: 'sepsis', tier: 'high' }],
  data_items: ['review_unique_test_result', 'order_unique_test', 'independent_interpretation'],
  risk_matches: [{ tier: 'high', example: 'decision regarding escalation of care' }],
});
equal(moderateData.element_levels.data, 'moderate', 'independent interpretation satisfies moderate data');

var byTime = score({
  encounter_type: 'subsequent', total_time_minutes: 52,
  problems: [{ text: 'stable HTN', tier: 'low' }],
  data_items: [],
  risk_matches: [{ tier: 'low', example: 'continue medication' }],
});
equal(byTime.supported_code, '99233', '52 documented minutes support 99233');
equal(byTime.supported_level, 'high', 'supported level follows the selected time code');
equal(byTime.basis, 'time', 'higher time code wins only with explicit time');

var consult = score({
  encounter_type: 'consult', total_time_minutes: null,
  problems: [{ text: 'minor rash', tier: 'straightforward' }],
  data_items: [],
  risk_matches: [{ tier: 'straightforward', example: 'minimal risk' }],
});
equal(consult.supported_code, '99252', 'straightforward consult maps to 99252');

var highConsult = score({
  encounter_type: 'consult', total_time_minutes: null,
  problems: [{ text: 'life-threatening GI bleed', tier: 'high' }],
  data_items: ['review_external_records', 'review_unique_test_result', 'order_unique_test', 'independent_interpretation'],
  risk_matches: [{ tier: 'high', example: 'decision regarding escalation of care' }],
});
equal(highConsult.element_levels.data, 'high', 'two extensive data categories support high data');
equal(highConsult.supported_code, '99255', 'high consult maps to 99255');

var moderateInitial = score({
  encounter_type: 'new_admit', total_time_minutes: null,
  problems: [{ text: 'two stable chronic illnesses', tier: 'moderate' }],
  data_items: ['external_discussion'],
  risk_matches: [{ tier: 'moderate', example: 'prescription drug management' }],
});
equal(moderateInitial.supported_code, '99222', 'moderate initial care maps to 99222');

var minimalInitial = score({
  encounter_type: 'new_admit', total_time_minutes: null,
  problems: [],
  data_items: [],
  risk_matches: [],
});
equal(minimalInitial.calculated_mdm_level, 'straightforward', 'raw 2-of-3 result remains auditable');
equal(minimalInitial.mdm_level, 'low', 'hospital family applies its lowest supported level');
equal(minimalInitial.supported_code, '99221', 'minimal initial care maps to family floor');

console.log('deterministic E&M scorer: ' + assertions + ' assertions passed');
