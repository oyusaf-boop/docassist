import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const emScorer = require('../emScorer.js');
const sepsisScorer = require('../sepsisScorer.js');
const emMdm = require('../em_mdm_FY2026.json');

const LEVELS = new Set(['straightforward', 'low', 'moderate', 'high']);
const ENCOUNTER_TYPES = new Set(Object.keys(emMdm.meta.encounter_type_map));
const DATA_ITEMS = new Set(Object.keys(emMdm.elements.data.data_item_pool));
const SEVERITIES = new Set(['critical', 'warning', 'info']);
const CDI_STATES = new Set(['confirmed', 'query', 'unsupported']);
const MEAT_STATES = new Set(['met', 'partial', 'absent', 'not_applicable']);

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
  const result = {
    severity: enumValue(value.severity, `${path}.severity`, SEVERITIES),
    title: string(value.title, `${path}.title`, 200),
    body: string(value.body, `${path}.body`, 1200),
    action: string(value.action, `${path}.action`, 800),
  };
  if (value.evidence !== undefined) {
    result.evidence = stringArray(value.evidence, `${path}.evidence`, 6, 500);
    result.missing_evidence = stringArray(value.missing_evidence || [], `${path}.missing_evidence`, 6, 500);
    result.status = enumValue(value.status, `${path}.status`, CDI_STATES);
    result.meat_status = enumValue(value.meat_status, `${path}.meat_status`, MEAT_STATES);
    if (result.status !== 'unsupported' && result.evidence.length === 0) {
      fail(`${path}.evidence`, 'must cite note evidence for confirmed or query alerts');
    }
    if (result.status === 'query' && result.missing_evidence.length === 0) {
      fail(`${path}.missing_evidence`, 'must identify what is missing for a query');
    }
  }
  return result;
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
  const drgStatus = enumValue(drg.status, 'drg.status', new Set(['not_grouped', 'candidate', 'verified']));
  const drgEvidence = stringArray(drg.evidence, 'drg.evidence', 8, 500);
  const drgMissingEvidence = stringArray(drg.missing_evidence, 'drg.missing_evidence', 8, 500);
  if (drgStatus === 'candidate' && !drgEvidence.length) {
    fail('drg.evidence', 'is required for a candidate DRG');
  }
  if (drgStatus === 'verified' && !drg.verified_by) {
    fail('drg.verified_by', 'is required for a verified DRG');
  }
  return {
    cdi_alerts: array(root.cdi_alerts, 'cdi_alerts', 6).map((item, index) => {
      const alert = validateAlert(item, `cdi_alerts[${index}]`);
      if (!alert.evidence) fail(`cdi_alerts[${index}].evidence`, 'is required');
      return alert;
    }),
    drg: {
      status: drgStatus,
      current_number: string(drg.current_number, 'drg.current_number', 10, true),
      current_desc: string(drg.current_desc, 'drg.current_desc', 300, true),
      candidate_number: string(drg.candidate_number, 'drg.candidate_number', 10, true),
      candidate_desc: string(drg.candidate_desc, 'drg.candidate_desc', 300, true),
      principal_diagnosis: string(drg.principal_diagnosis, 'drg.principal_diagnosis', 300, true),
      evidence: drgEvidence,
      missing_evidence: drgMissingEvidence,
      verified_by: string(drg.verified_by, 'drg.verified_by', 120, true),
      verification_note: string(drg.verification_note, 'drg.verification_note', 500),
      // Backward-compatible fields are deliberately blank. DocAssist is not an
      // official grouper and must not manufacture GMLOS or revenue projections.
      optimized_number: '',
      optimized_desc: '',
      current_gmlos: '',
      optimized_gmlos: '',
      revenue_impact: '',
      impact_available: false,
    },
    icd_codes: array(root.icd_codes, 'icd_codes', 8).map((item, index) => {
      const value = object(item, `icd_codes[${index}]`);
      const supportStatus = enumValue(
        value.support_status,
        `icd_codes[${index}].support_status`,
        new Set(['confirmed', 'query', 'unsupported'])
      );
      const evidence = stringArray(value.evidence, `icd_codes[${index}].evidence`, 6, 500);
      const missingEvidence = stringArray(value.missing_evidence, `icd_codes[${index}].missing_evidence`, 6, 500);
      if (supportStatus !== 'unsupported' && !evidence.length) {
        fail(`icd_codes[${index}].evidence`, 'is required for a supported code suggestion');
      }
      if (supportStatus === 'query' && !missingEvidence.length) {
        fail(`icd_codes[${index}].missing_evidence`, 'is required for a query');
      }
      return {
        code: string(value.code, `icd_codes[${index}].code`, 20),
        description: string(value.description, `icd_codes[${index}].description`, 300),
        type: enumValue(value.type, `icd_codes[${index}].type`, new Set(['principal_candidate', 'secondary'])),
        cc_mcc_status: enumValue(value.cc_mcc_status, `icd_codes[${index}].cc_mcc_status`, new Set(['mcc', 'cc', 'non_cc', 'unknown'])),
        support_status: supportStatus,
        evidence,
        missing_evidence: missingEvidence,
        note: string(value.note, `icd_codes[${index}].note`, 800, true),
      };
    }),
    summary: {
      mcc_cc_count: '',
      coding_note: string(object(root.summary, 'summary').coding_note, 'summary.coding_note', 500),
    },
  };
}

function validateSepsis(raw) {
  const root = object(raw, 'output');
  const facts = object(root.sepsis_facts, 'sepsis_facts');
  const nullableNumber = (value, path, min, max) =>
    value == null ? null : number(value, path, min, max);
  const normalized = {
    sepsis_or_infection_suspected: boolean(facts.sepsis_or_infection_suspected, 'sepsis_facts.sepsis_or_infection_suspected'),
    infection_documented: boolean(facts.infection_documented, 'sepsis_facts.infection_documented'),
  };
  const ranges = {
    temperature_c: [25, 45], heart_rate: [0, 300], respiratory_rate: [0, 100],
    paco2: [5, 150], wbc: [0, 200], bands_percent: [0, 100],
    pao2: [10, 800], fio2: [0.21, 1], platelets: [0, 2000], bilirubin: [0, 100],
    map: [0, 250], gcs: [3, 15], creatinine: [0, 30], urine_output_ml_day: [0, 20000],
    dopamine_mcg_kg_min: [0, 100], dobutamine_mcg_kg_min: [0, 100],
    epinephrine_mcg_kg_min: [0, 10], norepinephrine_mcg_kg_min: [0, 10],
  };
  for (const [name, range] of Object.entries(ranges)) {
    normalized[name] = nullableNumber(facts[name], `sepsis_facts.${name}`, range[0], range[1]);
    normalized[`baseline_${name}`] = nullableNumber(facts[`baseline_${name}`], `sepsis_facts.baseline_${name}`, range[0], range[1]);
  }
  normalized.respiratory_support = facts.respiratory_support == null ? null : boolean(facts.respiratory_support, 'sepsis_facts.respiratory_support');
  normalized.baseline_respiratory_support = facts.baseline_respiratory_support == null ? null : boolean(facts.baseline_respiratory_support, 'sepsis_facts.baseline_respiratory_support');
  const scored = sepsisScorer.scoreSepsis(normalized);
  const sep1 = object(root.sep1, 'sep1');
  return {
    sepsis: {
      ...scored,
      organ_dysfunction_documented: boolean(root.organ_dysfunction_documented, 'organ_dysfunction_documented'),
      denial_risk: string(root.denial_risk, 'denial_risk', 40),
      documentation_tips: stringArray(root.documentation_tips, 'documentation_tips', 4),
      sep1: {
        applicable: boolean(sep1.applicable, 'sep1.applicable'),
        status: enumValue(sep1.status, 'sep1.status', new Set(['complete', 'incomplete', 'indeterminate', 'not_applicable'])),
        evidence: stringArray(sep1.evidence, 'sep1.evidence', 8, 500),
        missing: stringArray(sep1.missing, 'sep1.missing', 8, 500),
        disclaimer: 'SEP-1 is a quality-measure screen, not a sepsis diagnosis.',
      },
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
