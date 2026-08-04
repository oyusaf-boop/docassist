import { CDI_EXTRACTION_V2_SCHEMA, transformCdiExtractionV2 } from './cdiExtractionV2.js';
import { validateModelOutput } from './outputValidation.js';

// Anthropic Structured Outputs supports number types, but not numeric bounds.
// Range checks remain enforced by the server-owned E&M and Sepsis validators
// after the provider returns schema-valid JSON.
const nullableNumber = {
  anyOf: [{ type: 'number' }, { type: 'null' }],
};
const EM_FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['note_type', 'em_facts', 'rationale', 'already_documented', 'add_to_upgrade', 'gaps'],
  properties: {
    note_type: { type: 'string' },
    em_facts: {
      type: 'object',
      additionalProperties: false,
      required: ['encounter_type', 'total_time_minutes', 'problems', 'data_items', 'risk_matches'],
      properties: {
        encounter_type: {
          type: 'string',
          enum: ['new_admit', 'overnight_admit', 'takeover', 'progress', 'obs_same_day', 'consult'],
        },
        total_time_minutes: nullableNumber,
        problems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'tier'],
            properties: {
              text: { type: 'string' },
              tier: { type: 'string', enum: ['straightforward', 'low', 'moderate', 'high'] },
            },
          },
        },
        data_items: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'review_external_records', 'review_unique_test_result', 'order_unique_test',
              'additional_historian', 'independent_interpretation', 'external_discussion',
            ],
          },
        },
        risk_matches: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['example', 'tier'],
            properties: {
              example: { type: 'string' },
              tier: { type: 'string', enum: ['straightforward', 'low', 'moderate', 'high'] },
            },
          },
        },
      },
    },
    rationale: {
      type: 'object',
      additionalProperties: false,
      required: ['problems', 'data', 'risk'],
      properties: {
        problems: { type: 'string' },
        data: { type: 'string' },
        risk: { type: 'string' },
      },
    },
    already_documented: { type: 'array', items: { type: 'string' } },
    add_to_upgrade: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
};

const SEPSIS_RANGES = {
  temperature_c: [25, 45], heart_rate: [0, 300], respiratory_rate: [0, 100],
  paco2: [5, 150], wbc: [0, 200], bands_percent: [0, 100],
  pao2: [10, 800], fio2: [0.21, 1], platelets: [0, 2000], bilirubin: [0, 100],
  map: [0, 250], gcs: [3, 15], creatinine: [0, 30], urine_output_ml_day: [0, 20000],
  dopamine_mcg_kg_min: [0, 100], dobutamine_mcg_kg_min: [0, 100],
  epinephrine_mcg_kg_min: [0, 10], norepinephrine_mcg_kg_min: [0, 10],
};
const sepsisFactProperties = {
  sepsis_or_infection_suspected: { type: 'boolean' },
  infection_documented: { type: 'boolean' },
  respiratory_support: { type: 'boolean' },
  baseline_respiratory_support: { type: 'boolean' },
};
for (const name of Object.keys(SEPSIS_RANGES)) {
  sepsisFactProperties[name] = { type: 'number' };
  sepsisFactProperties[`baseline_${name}`] = { type: 'number' };
}
const optionalSepsisFactNames = Object.keys(sepsisFactProperties)
  .filter(name => !['sepsis_or_infection_suspected', 'infection_documented'].includes(name));

const SEPSIS_FACTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sepsis_facts', 'organ_dysfunction_documented', 'denial_risk', 'documentation_tips', 'sep1'],
  properties: {
    sepsis_facts: {
      type: 'object',
      additionalProperties: false,
      required: [...Object.keys(sepsisFactProperties), 'documented_fields'],
      properties: {
        ...sepsisFactProperties,
        documented_fields: {
          type: 'array',
          items: { type: 'string', enum: optionalSepsisFactNames },
        },
      },
    },
    organ_dysfunction_documented: { type: 'boolean' },
    denial_risk: { type: 'string' },
    documentation_tips: { type: 'array', items: { type: 'string' } },
    sep1: {
      type: 'object',
      additionalProperties: false,
      required: ['applicable', 'status', 'evidence', 'missing'],
      properties: {
        applicable: { type: 'boolean' },
        status: { type: 'string', enum: ['complete', 'incomplete', 'indeterminate', 'not_applicable'] },
        evidence: { type: 'array', items: { type: 'string' } },
        missing: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

export const CLINICAL_BUNDLE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'em', 'cdi', 'sepsis'],
  properties: {
    schema_version: { type: 'string', const: '1.0' },
    em: EM_FACTS_SCHEMA,
    cdi: CDI_EXTRACTION_V2_SCHEMA,
    sepsis: SEPSIS_FACTS_SCHEMA,
  },
});

export const CLINICAL_CORE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'em', 'sepsis'],
  properties: {
    schema_version: { type: 'string', const: '1.0' },
    em: EM_FACTS_SCHEMA,
    sepsis: SEPSIS_FACTS_SCHEMA,
  },
});

export const CLINICAL_CORE_INSTRUCTIONS = `

CLINICAL CORE V1:
Ignore the separate output examples above. Read the encounter once and return
one JSON object matching the supplied schema. "em" contains documented E&M
facts and "sepsis" contains only documented sepsis/SIRS/SOFA/SEP-1 facts.
Do not calculate final E&M codes, SIRS, or SOFA; the server performs those
calculations deterministically. For sepsis facts, list every explicitly
documented optional field in documented_fields. Use 0 (or false for respiratory
support) as the required placeholder for fields not listed in documented_fields;
placeholders are discarded before scoring. Keep evidence concise and note-grounded.
The top-level schema_version must be "1.0".
`;

export const CLINICAL_BUNDLE_INSTRUCTIONS = `

CLINICAL BUNDLE V1:
Ignore the separate output examples above. Read the encounter once and return
one JSON object matching the supplied schema. "em" contains documented E&M
facts, "cdi" contains clinical_extraction_v2 facts, and "sepsis" contains only
documented sepsis/SIRS/SOFA/SEP-1 facts. Do not calculate final E&M codes, SIRS,
SOFA, or CC/MCC status; the server performs those calculations deterministically.
For sepsis facts, list every explicitly documented optional field in documented_fields.
Use 0 (or false for respiratory support) as the required placeholder for fields not
listed in documented_fields; placeholders are discarded before scoring. Keep evidence
concise and note-grounded.
The top-level schema_version must be "1.0".
`;

export function transformClinicalBundle(value) {
  const root = typeof value === 'string' ? JSON.parse(value) : value;
  if (!root || root.schema_version !== '1.0') {
    throw new Error('clinical_bundle_v1: invalid schema version');
  }
  const em = JSON.parse(validateModelOutput('em', JSON.stringify(root.em)));
  const cdi = transformCdiExtractionV2(root.cdi);
  const documentedFields = new Set(root.sepsis?.sepsis_facts?.documented_fields || []);
  const normalizedSepsis = {
    ...root.sepsis,
    sepsis_facts: { ...root.sepsis.sepsis_facts },
  };
  delete normalizedSepsis.sepsis_facts.documented_fields;
  for (const name of optionalSepsisFactNames) {
    if (!documentedFields.has(name)) normalizedSepsis.sepsis_facts[name] = null;
  }
  const sepsis = JSON.parse(validateModelOutput('sepsis', JSON.stringify(normalizedSepsis)));
  return { ...em, ...cdi, ...sepsis };
}

export function transformClinicalCore(value) {
  const root = typeof value === 'string' ? JSON.parse(value) : value;
  if (!root || root.schema_version !== '1.0') {
    throw new Error('clinical_core_v1: invalid schema version');
  }
  const em = JSON.parse(validateModelOutput('em', JSON.stringify(root.em)));
  const documentedFields = new Set(root.sepsis?.sepsis_facts?.documented_fields || []);
  const normalizedSepsis = {
    ...root.sepsis,
    sepsis_facts: { ...root.sepsis.sepsis_facts },
  };
  delete normalizedSepsis.sepsis_facts.documented_fields;
  for (const name of optionalSepsisFactNames) {
    if (!documentedFields.has(name)) normalizedSepsis.sepsis_facts[name] = null;
  }
  const sepsis = JSON.parse(validateModelOutput('sepsis', JSON.stringify(normalizedSepsis)));
  return { ...em, ...sepsis };
}
