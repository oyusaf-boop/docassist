const AKI_TERMS = /\b(?:acute kidney injury|AKI)\b/i;
const CKD_TERMS = /\b(?:chronic kidney disease|CKD)(?:\s+stage\s+[1-5])?\b/i;

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function creatinineTrend(note) {
  const text = String(note || '');
  const patterns = [
    /\b(?:creatinine|Cr)\b[^\n]{0,60}?\b(?:from\s+)?(\d+(?:\.\d+)?)\s*(?:→|->|to)\s*(\d+(?:\.\d+)?)/i,
    /\b(?:baseline|prior|usual)\s+(?:serum\s+)?(?:creatinine|Cr)\s*[:=]?\s*(\d+(?:\.\d+)?)[^\n]{0,100}?\b(?:current|now|peak)?\s*(?:creatinine|Cr)?\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const baseline = Number(match[1]);
    const current = Number(match[2]);
    if (!Number.isFinite(baseline) || !Number.isFinite(current) || baseline <= 0) continue;
    return {
      baseline,
      current,
      delta: round(current - baseline),
      ratio: round(current / baseline),
      absolute_threshold_met: current - baseline >= 0.3,
      relative_threshold_met: current / baseline >= 1.5,
      timeframe_known: /\b(?:within|over|in)\s+\d+(?:\.\d+)?\s*(?:hours?|hrs?|days?)\b/i.test(match[0]),
      source_text: match[0].trim().slice(0, 240),
    };
  }
  return null;
}

function permissionFor(diagnosis) {
  if (diagnosis.clinical_support === 'unsupported') return 'prohibited';
  if (diagnosis.documentation_status === 'documented' && diagnosis.clinical_support === 'supported') {
    return 'established';
  }
  return 'clarification_only';
}

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function buildEncounterLedger(note, extraction) {
  const diagnoses = Array.isArray(extraction?.diagnoses) ? extraction.diagnoses : [];
  const trend = creatinineTrend(note);
  const conditions = diagnoses.map(item => ({
    name: normalizedName(item.diagnosis),
    documentation_status: item.documentation_status,
    clinical_support: item.clinical_support,
    evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 6) : [],
    missing_evidence: Array.isArray(item.missing_evidence) ? item.missing_evidence.slice(0, 6) : [],
    permission: permissionFor(item),
  })).filter(item => item.name);

  const aki = conditions.find(item => AKI_TERMS.test(item.name));
  if (aki && trend && !trend.absolute_threshold_met && !trend.relative_threshold_met) {
    aki.clinical_support = 'unsupported';
    aki.permission = 'prohibited';
    aki.missing_evidence = [...new Set([
      ...aki.missing_evidence,
      'No supplied creatinine criterion meets the KDIGO threshold.',
      ...(trend.timeframe_known ? [] : ['A qualifying KDIGO timeframe or urine-output criterion is not established.']),
    ])];
  }

  const ckdMentioned = CKD_TERMS.test(String(note || ''));
  const ckd = conditions.find(item => CKD_TERMS.test(item.name));
  if (ckd && !ckdMentioned) {
    ckd.documentation_status = 'not_documented';
    ckd.clinical_support = 'unsupported';
    ckd.permission = 'prohibited';
  }

  return {
    schema_version: '1.0',
    calculations: { creatinine: trend },
    conditions,
    prohibited_diagnoses: conditions.filter(item => item.permission === 'prohibited').map(item => item.name),
    clarification_only_diagnoses: conditions.filter(item => item.permission === 'clarification_only').map(item => item.name),
    established_diagnoses: conditions.filter(item => item.permission === 'established').map(item => item.name),
  };
}

export function reconcileExtractionWithLedger(extraction, ledger) {
  const byName = new Map(ledger.conditions.map(item => [item.name.toLowerCase(), item]));
  const diagnoses = (extraction.diagnoses || []).map(item => {
    const ledgerItem = byName.get(normalizedName(item.diagnosis).toLowerCase());
    if (!ledgerItem) return item;
    return {
      ...item,
      documentation_status: ledgerItem.documentation_status,
      clinical_support: ledgerItem.clinical_support,
      missing_evidence: ledgerItem.missing_evidence,
    };
  });
  const prohibited = ledger.prohibited_diagnoses.map(name => name.toLowerCase());
  const akiProhibited = ledger.conditions.some(item => item.permission === 'prohibited' && AKI_TERMS.test(item.name));
  const ckdProhibited = ledger.conditions.some(item => item.permission === 'prohibited' && CKD_TERMS.test(item.name));
  const codeCandidates = (extraction.code_candidates || []).map(item => {
    const text = `${item.description || ''} ${item.note || ''}`.toLowerCase();
    const code = String(item.code || '').toUpperCase();
    return prohibited.some(name => text.includes(name.toLowerCase())) ||
      (akiProhibited && (code.startsWith('N17') || /acute kidney (?:injury|failure)/i.test(text))) ||
      (ckdProhibited && (code.startsWith('N18') || /chronic kidney disease/i.test(text)))
      ? { ...item, support_status: 'unsupported' }
      : item;
  });
  return { ...extraction, diagnoses, code_candidates: codeCandidates };
}

export function ledgerAllowsEstablishedDiagnosis(ledger, diagnosis) {
  const needle = normalizedName(diagnosis).toLowerCase();
  return (ledger?.established_diagnoses || []).some(name => {
    const allowed = normalizedName(name).toLowerCase();
    return needle === allowed || needle.includes(allowed) || allowed.includes(needle);
  });
}

export function attachSepsisLedger(ledger, sepsis) {
  const conditions = ledger?.conditions || [];
  const established = pattern => conditions.some(item => item.permission === 'established' && pattern.test(item.name));
  const documented = pattern => conditions.some(item => item.documentation_status === 'documented' && pattern.test(item.name));
  return {
    ...ledger,
    sepsis: {
      infection_documented: Boolean(sepsis?.infection_documented),
      organ_dysfunction_documented: Boolean(sepsis?.organ_dysfunction_documented),
      sepsis2: sepsis?.sepsis2 || null,
      sepsis3: sepsis?.sepsis3 || null,
      severe_sepsis_permission: established(/\bsevere sepsis\b/i) ? 'established' : 'prohibited',
      septic_shock_permission: established(/\bseptic shock\b/i) ? 'established' : 'prohibited',
      sepsis_permission: established(/\bsepsis\b/i)
        ? 'established'
        : (documented(/\bsepsis\b/i) ? 'clarification_only' : 'prohibited'),
      sep1: sepsis?.sep1 || null,
    },
  };
}

function ledgerPayload(ledger, encounter) {
  return `${JSON.stringify(ledger)}\n${String(encounter || '')}`;
}

export function signEncounterLedger(ledger, encounter, secret) {
  if (!secret) throw new Error('SESSION_SECRET is required to sign encounter ledger');
  return crypto.createHmac('sha256', secret).update(ledgerPayload(ledger, encounter)).digest('base64url');
}

export function verifyEncounterLedger(ledger, encounter, signature, secret) {
  if (!secret || typeof signature !== 'string') return false;
  const expected = signEncounterLedger(ledger, encounter, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export const _test = { creatinineTrend, permissionFor };
import crypto from 'node:crypto';
