const INTERNAL_LANGUAGE = /\b(?:physician writes? (?:the )?diagnosis manually|silent rule|per rule|implementation commentary)\b/i;
const PLACEHOLDER = /\{\{[^{}]+\}\}/;

function escapedPattern(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function diagnosisPatterns(name) {
  const patterns = [new RegExp(`\\b${escapedPattern(name)}\\b`, 'i')];
  if (/\b(?:acute kidney injury|AKI)\b/i.test(name)) patterns.push(/\b(?:acute kidney injury|AKI|acute renal failure)\b/i);
  if (/\b(?:chronic kidney disease|CKD)\b/i.test(name)) patterns.push(/\b(?:chronic kidney disease|CKD)(?:\s+stage\s+[1-5])?\b/i);
  return patterns;
}

export function validateAPOutput(text, ledger) {
  const output = String(text || '');
  const reasons = [];
  if (PLACEHOLDER.test(output)) reasons.push('unresolved placeholder');
  if (INTERNAL_LANGUAGE.test(output)) reasons.push('internal instruction language');
  for (const diagnosis of ledger?.prohibited_diagnoses || []) {
    const name = String(diagnosis || '').trim();
    if (!name) continue;
    if (diagnosisPatterns(name).some(pattern => pattern.test(output))) {
      reasons.push(`prohibited diagnosis: ${name}`);
    }
  }
  const sepsisPermissions = [
    ['Severe sepsis', ledger?.sepsis?.severe_sepsis_permission],
    ['Septic shock', ledger?.sepsis?.septic_shock_permission],
    ['Sepsis', ledger?.sepsis?.sepsis_permission],
  ];
  for (const [diagnosis, permission] of sepsisPermissions) {
    if (permission !== 'prohibited') continue;
    if (new RegExp(`\\b${diagnosis}\\b`, 'i').test(output)) reasons.push(`prohibited diagnosis: ${diagnosis}`);
  }
  return { safe: reasons.length === 0, reasons };
}

export function ledgerInstructions(ledger) {
  if (!ledger) return '';
  return `\n\nAUTHORITATIVE ENCOUNTER LEDGER (server-generated):\n${JSON.stringify(ledger)}\n` +
    'You must honor this ledger. Do not assert prohibited or clarification-only diagnoses as established. ' +
    'Do not introduce diagnoses, demographics, causal relationships, values, units, or reference ranges absent from the source evidence. ' +
    'Never emit internal instructions or unresolved placeholders.';
}

export const _test = { INTERNAL_LANGUAGE, PLACEHOLDER };
