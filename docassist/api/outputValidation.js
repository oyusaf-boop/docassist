import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const emScorer = require('../emScorer.js');
const emMdm = require('../em_mdm_FY2026.json');

const LEVELS = new Set(['straightforward', 'low', 'moderate', 'high']);
const ENCOUNTER_TYPES = new Set(Object.keys(emMdm.meta.encounter_type_map));
const DATA_ITEMS = new Set(Object.keys(emMdm.elements.data.data_item_pool));
const SEVERITIES = new Set(['critical', 'warning', 'info']);

class ModelOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelOutputError';
  }
}

function fail(path, message) {
  throw new ModelOutputError(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  return value;
}

function string(value, path, max = 4000, allowEmpty = false) {
  if (typeof value !== 'string') fail(path, 'must be a string');
  const clean = value.trim();
  if (!allowEmpty && !clean) fail(path, 'must not be empty');
  if (clean.length > max) fail(path, `must be at most ${max} characters`);
  return clean;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function number(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number');
  if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
  return value;
}

function array(value, path, max) {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  if (value.length > max) fail(path, `must contain at most ${max} items`);
  return value;
}

function enumValue(value, path, allowed) {
  const clean = string(value, path, 80).toLowerCase();
  if (!allowed.has(clean)) fail(path, `contains unsupported value "${clean}"`);
  return clean;
}

function stringArray(value, path, maxItems, maxLength = 500) {
  return array(value, path, maxItems).map((item, index) =>
    string(item, `${path}[${index}]`, maxLength)
  );
}

function parseJson(text) {
  let clean = string(text, 'output', 100000);
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first < 0 || last <= first) fail('output', 'must contain one JSON object');
  clean = clean.slice(first, last + 1);
  try {
    return JSON.parse(clean);
  } catch {
    fail('output', 'is not valid JSON');
  }
}

function validateAlert(item, path) {
  const value = object(item, path);
  return {
    severity: enumValue(value.severity, `${path}.severity`, SEVERITIES),
    title: string(value.title, `${path}.title`, 200),
    body: string(value.body, `${path}.body`, 1200),
    action: string(value.action, `${path}.action`, 800),
  };
}

function validateEm(raw) {
  const root = object(raw, 'output');
  const facts = object(root.em_facts, 'em_facts');
  const problems = array(facts.problems, 'em_facts.problems', 20).map((item, index) => {
    const value = object(item, `em_facts.problems[${index}]`);
    return {
      text: string(value.text, `em_facts.problems[${index}].text`, 500),
      tier: enumValue(value.tier, `em_facts.problems[${index}].tier`, LEVELS),
    };
  });
  const riskMatches = array(facts.risk_matches, 'em_facts.risk_matches', 20).map((item, index) => {
    const value = object(item, `em_facts.risk_matches[${index}]`);
    return {
      example: string(value.example, `em_facts.risk_matches[${index}].example`, 500),
      tier: enumValue(value.tier, `em_facts.risk_matches[${index}].tier`, LEVELS),
    };
  });
  const dataItems = array(facts.data_items, 'em_facts.data_items', DATA_ITEMS.size).map((item, index) =>
    enumValue(item, `em_facts.data_items[${index}]`, DATA_ITEMS)
  );
  const totalTime = facts.total_time_minutes == null
    ? null
    : number(facts.total_time_minutes, 'em_facts.total_time_minutes', 0, 1440);
  const encounterType = enumValue(facts.encounter_type, 'em_facts.encounter_type', ENCOUNTER_TYPES);
  const scored = emScorer.scoreEM({
    encounter_type: encounterType,
    total_time_minutes: totalTime,
    problems,
    data_items: [...new Set(dataItems)],
    risk_matches: riskMatches,
  }, emMdm);
  if (!scored.supported_code) fail('em_facts.encounter_type', 'does not map to a supported E&M code');

  const rationale = object(root.rationale, 'rationale');
  const labels = {
    straightforward: 'Straightforward Complexity',
    low: 'Low Complexity',
    moderate: 'Moderate Complexity',
    high: 'High Complexity',
  };
  return {
    em: {
      note_type: string(root.note_type, 'note_type', 120),
      justified_code: scored.supported_code,
      justified_level: labels[scored.supported_level],
      current_likely_code: scored.supported_code,
      upgrade_available: false,
      revenue_gap_per_note: '',
      scoring_basis: scored.basis,
      mdm: {
        problems: { level: labels[scored.element_levels.problems].replace(' Complexity', ''), rationale: string(rationale.problems, 'rationale.problems', 1000) },
        data: { level: labels[scored.element_levels.data].replace(' Complexity', ''), rationale: string(rationale.data, 'rationale.data', 1000) },
        risk: { level: labels[scored.element_levels.risk].replace(' Complexity', ''), rationale: string(rationale.risk, 'rationale.risk', 1000) },
      },
      already_documented: stringArray(root.already_documented, 'already_documented', 6),
      add_to_upgrade: stringArray(root.add_to_upgrade, 'add_to_upgrade', 6),
      deterministic_details: scored,
    },
    gaps: stringArray(root.gaps, 'gaps', 5, 800),
  };
}

function validateCdi(raw) {
  const root = object(raw, 'output');
  const drg = object(root.drg, 'drg');
  return {
    cdi_alerts: array(root.cdi_alerts, 'cdi_alerts', 6).map(validateAlert),
    drg: {
      current_number: string(drg.current_number, 'drg.current_number', 10, true),
      current_desc: string(drg.current_desc, 'drg.current_desc', 300, true),
      current_gmlos: string(drg.current_gmlos, 'drg.current_gmlos', 20, true),
      optimized_number: string(drg.optimized_number, 'drg.optimized_number', 10, true),
      optimized_desc: string(drg.optimized_desc, 'drg.optimized_desc', 300, true),
      optimized_gmlos: string(drg.optimized_gmlos, 'drg.optimized_gmlos', 20, true),
      revenue_impact: string(drg.revenue_impact, 'drg.revenue_impact', 80, true),
      impact_available: boolean(drg.impact_available, 'drg.impact_available'),
    },
    icd_codes: array(root.icd_codes, 'icd_codes', 8).map((item, index) => {
      const value = object(item, `icd_codes[${index}]`);
      return {
        code: string(value.code, `icd_codes[${index}].code`, 20),
        description: string(value.description, `icd_codes[${index}].description`, 300),
        type: string(value.type, `icd_codes[${index}].type`, 40),
        note: string(value.note, `icd_codes[${index}].note`, 800, true),
      };
    }),
    summary: {
      mcc_cc_count: string(object(root.summary, 'summary').mcc_cc_count, 'summary.mcc_cc_count', 80),
    },
  };
}

function validateSepsis(raw) {
  const root = object(raw, 'output');
  const sepsis = object(root.sepsis, 'sepsis');
  boolean(sepsis.detected, 'sepsis.detected');
  if (!sepsis.detected) {
    return { sepsis: { ...sepsis, detected: false, documentation_tips: stringArray(sepsis.documentation_tips || [], 'sepsis.documentation_tips', 4) } };
  }
  object(sepsis.sepsis2, 'sepsis.sepsis2');
  object(sepsis.sepsis3, 'sepsis.sepsis3');
  return {
    sepsis: {
      ...sepsis,
      detected: true,
      organ_dysfunction_documented: boolean(sepsis.organ_dysfunction_documented, 'sepsis.organ_dysfunction_documented'),
      denial_risk: string(sepsis.denial_risk, 'sepsis.denial_risk', 40),
      documentation_tips: stringArray(sepsis.documentation_tips, 'sepsis.documentation_tips', 4),
    },
  };
}

function validateDischargeCourse(raw) {
  return {
    hospital_course: string(object(raw, 'output').hospital_course, 'hospital_course', 6000),
  };
}

function validateDischargeDiagnoses(raw) {
  const root = object(raw, 'output');
  return {
    discharge_diagnoses: array(root.discharge_diagnoses, 'discharge_diagnoses', 30).map((item, index) => {
      const value = object(item, `discharge_diagnoses[${index}]`);
      return {
        number: number(value.number, `discharge_diagnoses[${index}].number`, 1, 100),
        name: string(value.name, `discharge_diagnoses[${index}].name`, 500),
        type: string(value.type, `discharge_diagnoses[${index}].type`, 40),
        cc_mcc: string(value.cc_mcc, `discharge_diagnoses[${index}].cc_mcc`, 40, true),
        note: string(value.note, `discharge_diagnoses[${index}].note`, 800, true),
      };
    }),
    cdi_flags: array(root.cdi_flags, 'cdi_flags', 10).map(validateAlert),
  };
}

function validateOptimizedAp(text) {
  const clean = string(text, 'output', 30000);
  if (!clean.includes('===AP_TEXT===') || !clean.includes('===END===')) {
    fail('output', 'must include complete A&P section markers');
  }
  return clean;
}

export function validateModelOutput(taskId, text) {
  if (taskId === 'optimized_ap') return validateOptimizedAp(text);
  const parsed = parseJson(text);
  if (taskId === 'em') return JSON.stringify(validateEm(parsed));
  if (taskId === 'cdi') return JSON.stringify(validateCdi(parsed));
  if (taskId === 'sepsis') return JSON.stringify(validateSepsis(parsed));
  if (taskId === 'discharge_course') return JSON.stringify(validateDischargeCourse(parsed));
  if (taskId === 'discharge_diagnoses') return JSON.stringify(validateDischargeDiagnoses(parsed));
  fail('taskId', 'has no output validator');
}

export { ModelOutputError };
