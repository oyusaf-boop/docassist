import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CDI_EXTRACTION_V2_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['schema_version', 'diagnoses', 'code_candidates', 'drg_context'],
  properties: {
    schema_version: { type: 'string', const: '2.0' },
    diagnoses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'diagnosis', 'documentation_status', 'clinical_support', 'severity',
          'meat_status', 'evidence', 'missing_evidence', 'action'
        ],
        properties: {
          diagnosis: { type: 'string' },
          documentation_status: {
            type: 'string',
            enum: ['documented', 'clarification_needed', 'not_documented']
          },
          clinical_support: {
            type: 'string',
            enum: ['supported', 'partial', 'unsupported']
          },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          meat_status: {
            type: 'string',
            enum: ['met', 'partial', 'absent', 'not_applicable']
          },
          evidence: {
            type: 'array',
            items: { type: 'string' }
          },
          missing_evidence: {
            type: 'array',
            items: { type: 'string' }
          },
          action: { type: 'string' }
        }
      }
    },
    code_candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'code', 'description', 'role', 'support_status',
          'evidence', 'missing_evidence', 'note'
        ],
        properties: {
          code: { type: 'string' },
          description: { type: 'string' },
          role: { type: 'string', enum: ['principal_candidate', 'secondary'] },
          support_status: {
            type: 'string',
            enum: ['confirmed', 'query', 'unsupported']
          },
          evidence: {
            type: 'array',
            items: { type: 'string' }
          },
          missing_evidence: {
            type: 'array',
            items: { type: 'string' }
          },
          note: { type: 'string' }
        }
      }
    },
    drg_context: {
      type: 'object',
      additionalProperties: false,
      required: [
        'principal_diagnosis', 'candidate_number', 'candidate_description',
        'evidence', 'missing_evidence'
      ],
      properties: {
        principal_diagnosis: { type: 'string' },
        candidate_number: { type: 'string' },
        candidate_description: { type: 'string' },
        evidence: {
          type: 'array',
          items: { type: 'string' }
        },
        missing_evidence: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  }
});

export const CDI_EXTRACTION_V2_INSTRUCTIONS = `

CLINICAL EXTRACTION V2:
Return only the facts required by the supplied JSON schema. Do not create final
UI prose, CC/MCC classifications, counts, revenue estimates, GMLOS, or a final
DRG assignment. The server derives those fields from FY2026 reference data.
Use evidence copied faithfully from the submitted note. A query must identify
the missing evidence. Never turn a clinical indicator into an asserted diagnosis.
`;

function loadFoundationKnowledge() {
  const candidates = [
    join(process.cwd(), 'foundation_knowledge_FY2026.json'),
    join(process.cwd(), 'docassist', 'foundation_knowledge_FY2026.json')
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Unable to load foundation_knowledge_FY2026.json');
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeClassification(value) {
  const compact = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (compact === 'mcc') return 'mcc';
  if (compact === 'cc') return 'cc';
  if (['noncc', 'neither', 'none'].includes(compact)) return 'non_cc';
  return 'unknown';
}

function buildClassificationIndex(root) {
  const index = new Map();
  const rank = { unknown: 0, non_cc: 1, cc: 2, mcc: 3 };
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      const code = normalizeCode(value.code || value.base_code);
      const classification = normalizeClassification(value.cc_mcc);
      if (code && !/[X*+]/.test(code) && classification !== 'unknown') {
        const prior = index.get(code) || 'unknown';
        if (rank[classification] > rank[prior]) index.set(code, classification);
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(root);
  return index;
}

const classificationIndex = buildClassificationIndex(loadFoundationKnowledge());

function boundedStrings(value, max) {
  return Array.isArray(value)
    ? value.slice(0, max).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : [];
}

function parseExtraction(value) {
  const root = typeof value === 'string' ? JSON.parse(value) : value;
  if (!root || typeof root !== 'object' || root.schema_version !== '2.0') {
    throw new Error('clinical_extraction_v2: invalid schema version');
  }
  if (!Array.isArray(root.diagnoses) || !Array.isArray(root.code_candidates)) {
    throw new Error('clinical_extraction_v2: missing required arrays');
  }
  return root;
}

function alertStatus(diagnosis) {
  if (diagnosis.clinical_support === 'unsupported') return 'unsupported';
  if (
    diagnosis.documentation_status === 'documented' &&
    diagnosis.clinical_support === 'supported'
  ) return 'confirmed';
  return 'query';
}

export function transformCdiExtractionV2(value) {
  const root = parseExtraction(value);
  const diagnoses = root.diagnoses.slice(0, 6);
  const codes = root.code_candidates.slice(0, 8);
  const context = root.drg_context && typeof root.drg_context === 'object'
    ? root.drg_context
    : {};

  const cdiAlerts = diagnoses.map(diagnosis => {
    const status = alertStatus(diagnosis);
    const evidence = boundedStrings(diagnosis.evidence, 6);
    const missing = boundedStrings(diagnosis.missing_evidence, 6);
    return {
      severity: ['critical', 'warning', 'info'].includes(diagnosis.severity)
        ? diagnosis.severity
        : 'info',
      title: String(diagnosis.diagnosis || 'Documentation review').slice(0, 200),
      body: status === 'confirmed'
        ? 'Diagnosis is documented and supported by the cited note evidence.'
        : status === 'query'
          ? 'The note contains a clarification opportunity; review the cited evidence and missing elements.'
          : 'The documented diagnosis is not supported by the available note evidence.',
      action: String(diagnosis.action || 'Review the documentation and clarify if clinically appropriate.').slice(0, 800),
      evidence,
      missing_evidence: missing,
      status,
      meat_status: ['met', 'partial', 'absent', 'not_applicable'].includes(diagnosis.meat_status)
        ? diagnosis.meat_status
        : 'not_applicable'
    };
  });

  const icdCodes = codes.map(candidate => {
    const code = normalizeCode(candidate.code);
    let support = ['confirmed', 'query', 'unsupported'].includes(candidate.support_status)
      ? candidate.support_status
      : 'unsupported';
    const evidence = boundedStrings(candidate.evidence, 6);
    const missing = boundedStrings(candidate.missing_evidence, 6);
    if (support !== 'unsupported' && evidence.length === 0) support = 'unsupported';
    if (support === 'query' && missing.length === 0) support = 'unsupported';
    return {
      code,
      description: String(candidate.description || '').slice(0, 300),
      type: candidate.role === 'principal_candidate' ? 'principal_candidate' : 'secondary',
      cc_mcc_status: classificationIndex.get(code) || 'unknown',
      support_status: support,
      evidence,
      missing_evidence: missing,
      note: String(candidate.note || '').slice(0, 800)
    };
  });

  const drgEvidence = boundedStrings(context.evidence, 8);
  const drgMissing = boundedStrings(context.missing_evidence, 8);
  const candidateNumber = String(context.candidate_number || '').slice(0, 10);

  return {
    cdi_alerts: cdiAlerts,
    drg: {
      status: candidateNumber && drgEvidence.length ? 'candidate' : 'not_grouped',
      current_number: '',
      current_desc: '',
      candidate_number: candidateNumber,
      candidate_desc: String(context.candidate_description || '').slice(0, 300),
      principal_diagnosis: String(context.principal_diagnosis || '').slice(0, 300),
      evidence: drgEvidence,
      missing_evidence: drgMissing,
      verified_by: '',
      verification_note: 'Candidate only; verify with an approved MS-DRG grouper and qualified coder.',
      optimized_number: '',
      optimized_desc: '',
      current_gmlos: '',
      optimized_gmlos: '',
      revenue_impact: '',
      impact_available: false
    },
    icd_codes: icdCodes,
    summary: {
      mcc_cc_count: '',
      coding_note: 'Coding suggestions require physician and coder review.'
    }
  };
}
