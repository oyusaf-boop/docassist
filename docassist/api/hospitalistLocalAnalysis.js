import { validateModelOutput } from './outputValidation.js';

const INFECTION_TERMS = /\b(sepsis|septic|infection|infectious|pneumonia|uti|urinary tract infection|pyelonephritis|cellulitis|bacteremia|cholangitis|cholecystitis|diverticulitis|abscess)\b/i;
const SOURCE_INFECTION_TERMS = /\b(pneumonia|uti|urinary tract infection|pyelonephritis|cellulitis|bacteremia|cholangitis|cholecystitis|diverticulitis|abscess)\b/i;
const HIGH_RISK_TERMS = /\b(decision to admit|decision regarding hospitalization|escalation of care|intensive monitoring|vasopressor|heparin (?:drip|infusion)|insulin (?:drip|infusion)|mechanical ventilation|intubation)\b/i;
const PRESCRIPTION_TERMS = /\b(antibiotic|ceftriaxone|vancomycin|piperacillin|zosyn|diuresis|furosemide|lasix|insulin|steroid|prednisone|methylprednisolone|anticoagulation|heparin|eliquis|apixaban)\b/i;
const HIGH_PROBLEM_TERMS = /\b(sepsis|septic shock|shock|acute respiratory failure|myocardial infarction|stemi|nstemi|stroke|cva|pulmonary embolism|aortic dissection|status epilepticus|cardiac arrest)\b/i;
const MODERATE_PROBLEM_TERMS = /\b(acute kidney injury|aki|pneumonia|pyelonephritis|encephalopathy|heart failure|chf|copd exacerbation|asthma exacerbation|cellulitis|bacteremia|hyponatremia|hyperkalemia|anemia|malnutrition|uncontrolled diabetes|hyperglycemia)\b/i;

function lastNumber(text, patterns, min, max) {
  const matches = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value >= min && value <= max) matches.push(value);
      if (!pattern.global) break;
    }
  }
  return matches.length ? matches[matches.length - 1] : null;
}

function documented(text, pattern) {
  return pattern.test(text);
}

function contextualLastNumber(text, pattern, min, max, excludedContext) {
  const matches = [];
  let match;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    const value = Number(match[1]);
    const context = text.slice(Math.max(0, match.index - 35), match.index);
    if (
      Number.isFinite(value) && value >= min && value <= max &&
      !(excludedContext && excludedContext.test(context))
    ) matches.push(value);
  }
  return matches.length ? matches[matches.length - 1] : null;
}

function extractSepsisFacts(encounter) {
  const text = String(encounter || '');
  const lower = text.toLowerCase();
  const baselineClauses = [...text.matchAll(/(?:^|[.!?]\s+)\s*baseline\b[^.!?]*/gim)]
    .map(match => match[0])
    .join(' ');
  const currentText = text.replace(/(?:^|[.!?]\s+)\s*baseline\b[^.!?]*/gim, ' ');
  const fio2Percent = lastNumber(currentText, [/\bFiO2\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/gi], 21, 100);
  const fio2Decimal = lastNumber(currentText, [/\bFiO2\s*[:=]?\s*(0\.\d+)/gi], 0.21, 1);
  const oxygenLiters = lastNumber(currentText, [/\b(?:O2|oxygen)\s*(?:at|@|:)?\s*(\d+(?:\.\d+)?)\s*(?:L|liters?)(?:\/min|\/minute|pm)?\b/gi], 0, 100);
  const map = lastNumber(currentText, [/\bMAP\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 0, 250);
  const systolic = lastNumber(currentText, [/\bBP\s*[:=]?\s*(\d{2,3})\s*\/\s*\d{2,3}/gi], 30, 260);
  const diastolic = lastNumber(currentText, [/\bBP\s*[:=]?\s*\d{2,3}\s*\/\s*(\d{2,3})/gi], 10, 180);
  const calculatedMap = map ?? (
    systolic !== null && diastolic !== null
      ? Math.round((systolic + (2 * diastolic)) / 3)
      : null
  );
  const temperatureC = lastNumber(currentText, [
    /\b(?:temp(?:erature)?|T)\s*[:=]?\s*(\d{2}(?:\.\d+)?)\s*(?:°?\s*C|celsius)\b/gi,
  ], 25, 45);
  const temperatureF = lastNumber(currentText, [
    /\b(?:temp(?:erature)?|T)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\s*(?:°?\s*F|fahrenheit)\b/gi,
  ], 77, 113);
  const trendedCreatinine = lastNumber(currentText, [
    /\b(?:creatinine|Cr)\b[^\n]{0,100}?\bto\s*(\d+(?:\.\d+)?)/gi,
  ], 0, 30);
  const currentCreatinine = trendedCreatinine ?? contextualLastNumber(
    currentText,
    /\b(?:creatinine|Cr)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi,
    0,
    30,
    /\b(?:baseline|prior|usual)\b/i
  );

  return {
    sepsis_or_infection_suspected: INFECTION_TERMS.test(text),
    infection_documented: (
      SOURCE_INFECTION_TERMS.test(text) ||
      (/\bsepsis\b/i.test(text) && !/\bproblem list\b/i.test(text))
    ) && !/\b(?:rule out|r\/o|no evidence of|no)\s+(?:an?\s+)?(?:infection(?:\s+source)?|sepsis|pneumonia|uti)\b/i.test(text),
    temperature_c: temperatureC ?? (
      temperatureF === null ? null : Math.round(((temperatureF - 32) * 5 / 9) * 10) / 10
    ),
    heart_rate: lastNumber(text, [/\b(?:HR|heart rate|pulse)\s*[:=]?\s*(\d{1,3})\b/gi], 0, 300),
    respiratory_rate: lastNumber(text, [/\b(?:RR|resp(?:iratory)? rate)\s*[:=]?\s*(\d{1,3})\b/gi], 0, 100),
    paco2: lastNumber(text, [/\bPaCO2\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 5, 150),
    wbc: lastNumber(text, [/\bWBC\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 0, 200),
    bands_percent: lastNumber(text, [/\bbands?\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%/gi], 0, 100),
    pao2: lastNumber(text, [/\bPaO2\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 10, 800),
    fio2: fio2Decimal ?? (fio2Percent === null ? null : fio2Percent / 100),
    respiratory_support: oxygenLiters !== null || documented(lower, /\b(?:nasal cannula|high[- ]flow|bipap|cpap|ventilat|intubat)/i),
    platelets: lastNumber(currentText, [/\b(?:platelets?|PLT)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 0, 2000),
    baseline_platelets: lastNumber(baselineClauses, [/\b(?:platelets?|PLT)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 0, 2000),
    bilirubin: lastNumber(currentText, [/\b(?:total\s+)?bilirubin\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 0, 100),
    baseline_bilirubin: lastNumber(baselineClauses, [/\b(?:total\s+)?bilirubin\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 0, 100),
    map: calculatedMap,
    baseline_map: lastNumber(baselineClauses, [/\bMAP\s*[:=]?\s*(\d+(?:\.\d+)?)/gi], 0, 250),
    gcs: lastNumber(currentText, [/\bGCS\s*[:=]?\s*(\d{1,2})\b/gi], 3, 15),
    baseline_gcs: lastNumber(baselineClauses, [/\bGCS\s*[:=]?\s*(\d{1,2})\b/gi], 3, 15),
    creatinine: currentCreatinine,
    baseline_creatinine: lastNumber(text, [
      /\b(?:baseline|prior|usual)\s+(?:serum\s+)?(?:creatinine|Cr)\s*[:=]?\s*(\d+(?:\.\d+)?)/gi,
      /\b(?:creatinine|Cr)\b[^\n]{0,80}?\b(?:documented\s+)?baseline\s*[:=]?\s*(\d+(?:\.\d+)?)/gi,
    ], 0, 30),
    baseline_fio2: lastNumber(baselineClauses, [/\bFiO2\s*[:=]?\s*(0\.\d+)/gi], 0.21, 1),
    baseline_respiratory_support: /\b(?:oxygen|nasal cannula|high[- ]flow|bipap|cpap|ventilat|intubat)\b/i.test(baselineClauses) &&
      !/\broom air\b/i.test(baselineClauses),
    urine_output_ml_day: lastNumber(text, [/\b(?:urine output|UOP)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mL\/(?:day|24\s*h)/gi], 0, 20000),
    dopamine_mcg_kg_min: lastNumber(text, [/\bdopamine\s*[:@]?\s*(\d+(?:\.\d+)?)\s*mcg\/kg\/min/gi], 0, 100),
    dobutamine_mcg_kg_min: lastNumber(text, [/\bdobutamine\s*[:@]?\s*(\d+(?:\.\d+)?)\s*mcg\/kg\/min/gi], 0, 100),
    epinephrine_mcg_kg_min: lastNumber(text, [/\bepinephrine\s*[:@]?\s*(\d+(?:\.\d+)?)\s*mcg\/kg\/min/gi], 0, 10),
    norepinephrine_mcg_kg_min: lastNumber(text, [/\bnorepinephrine\s*[:@]?\s*(\d+(?:\.\d+)?)\s*mcg\/kg\/min/gi], 0, 10),
  };
}

function encounterType(encounter) {
  if (/\bconsult(?:ation)?\b/i.test(encounter)) return 'consult';
  if (/\bsame[- ]day observation\b|\bobs(?:ervation)?\s+discharge\b/i.test(encounter)) return 'obs_same_day';
  if (/\bnew admission\b|\badmission h&p\b|\badmit(?:ted)?\b/i.test(encounter)) return 'new_admit';
  if (/\bovernight admission\b/i.test(encounter)) return 'overnight_admit';
  if (/\btakeover\b|\bassuming care\b/i.test(encounter)) return 'takeover';
  return 'progress';
}

function problemTier(item) {
  const name = String(item?.diagnosis || '');
  if (item?.clinical_support === 'unsupported') return 'low';
  if (HIGH_PROBLEM_TERMS.test(name)) return 'high';
  if (MODERATE_PROBLEM_TERMS.test(name) || /\bacute\b|\bexacerbation\b/i.test(name)) return 'moderate';
  return 'low';
}

function emInput(encounter, extraction, ledger) {
  const diagnoses = Array.isArray(extraction?.diagnoses) ? extraction.diagnoses : [];
  const permitted = new Set((ledger?.established_diagnoses || []).map(name => String(name).toLowerCase()));
  const countableDiagnoses = ledger
    ? diagnoses.filter(item => permitted.has(String(item.diagnosis || '').toLowerCase()))
    : diagnoses.filter(item => item.documentation_status === 'documented' && item.clinical_support === 'supported');
  const problems = countableDiagnoses.slice(0, 12).map(item => ({
    text: String(item.diagnosis || 'Hospital problem').slice(0, 500),
    tier: problemTier(item),
  }));
  if (!problems.length) problems.push({ text: 'Hospital encounter under evaluation', tier: 'low' });

  const dataItems = [];
  if (/\b(?:reviewed?|prior|outside|external)\s+(?:records?|notes?|chart)\b/i.test(encounter)) dataItems.push('review_external_records');
  if (
    /\b(?:reviewed?|review of|interpreted)\b[^.\n]{0,100}\b(?:labs?|cbc|cmp|bmp|imaging|x-?ray|ct|mri|echo|culture|results?)\b/i.test(encounter) ||
    /\b(?:labs?|cbc|cmp|bmp|imaging|x-?ray|ct|mri|echo|culture|results?)\b[^.\n]{0,60}\b(?:reviewed?|interpreted)\b/i.test(encounter)
  ) dataItems.push('review_unique_test_result');
  if (/\b(?:ordered?|obtain|check|repeat|trend)\s+(?:labs?|cbc|cmp|bmp|culture|x-?ray|ct|mri|echo|test)\b/i.test(encounter)) dataItems.push('order_unique_test');
  if (/\b(?:family|spouse|caregiver|ems)\s+(?:reports?|states?|provided|history)\b/i.test(encounter)) dataItems.push('additional_historian');
  if (/\b(?:independently interpreted|my interpretation)\b/i.test(encounter)) dataItems.push('independent_interpretation');
  if (/\b(?:discussed with|case discussed|spoke with)\s+(?:cardiology|nephrology|pulmonology|surgery|consultant|physician|provider)\b/i.test(encounter)) dataItems.push('external_discussion');

  const riskMatches = [];
  if (HIGH_RISK_TERMS.test(encounter)) riskMatches.push({ example: 'High-risk management or hospitalization decision documented', tier: 'high' });
  else if (
    PRESCRIPTION_TERMS.test(encounter) &&
    /\b(?:start(?:ed)?|continue(?:d)?|order(?:ed)?|adjust(?:ed)?|increase(?:d)?|decrease(?:d)?|hold|held|manage(?:ment)?|treat(?:ed|ment)?)\b/i.test(encounter)
  ) riskMatches.push({ example: 'Prescription drug management documented', tier: 'moderate' });
  else riskMatches.push({ example: 'Routine hospital management documented', tier: 'low' });

  const totalTime = lastNumber(encounter, [
    /\b(?:total\s+)?time\s*[:=]?\s*(\d{1,4})\s*(?:minutes?|mins?)\b/gi,
  ], 0, 1440);

  return {
    note_type: 'Hospital encounter',
    em_facts: {
      encounter_type: encounterType(encounter),
      total_time_minutes: totalTime,
      problems,
      data_items: [...new Set(dataItems)],
      risk_matches: riskMatches,
    },
    rationale: {
      problems: `${problems.length} active problem${problems.length === 1 ? '' : 's'} identified from the evidence-bound clinical extraction.`,
      data: dataItems.length ? 'Documented data review and ordering were counted from the note.' : 'No qualifying physician data work was explicitly detected.',
      risk: riskMatches[0].example,
    },
    already_documented: problems.slice(0, 6).map(item => item.text),
    add_to_upgrade: [],
    gaps: [],
  };
}

function sepsisInput(encounter) {
  const facts = extractSepsisFacts(encounter);
  const organDysfunction = /\b(acute kidney injury|aki|respiratory failure|encephalopathy|thrombocytopenia|shock|elevated bilirubin|oliguria)\b/i.test(encounter);
  return {
    sepsis_facts: facts,
    organ_dysfunction_documented: organDysfunction,
    denial_risk: facts.infection_documented && organDysfunction ? 'review' : 'indeterminate',
    documentation_tips: facts.infection_documented && organDysfunction
      ? ['Document whether the organ dysfunction is causally related to infection when clinically appropriate.']
      : [],
    sep1: {
      applicable: /\bsepsis\b/i.test(encounter),
      status: 'indeterminate',
      evidence: [],
      missing: ['SEP-1 timing elements require explicit documentation and measure review.'],
    },
  };
}

export function buildLocalHospitalistAnalysis(encounter, extraction, ledger) {
  const em = JSON.parse(validateModelOutput('em', JSON.stringify(emInput(encounter, extraction, ledger))));
  const sepsis = JSON.parse(validateModelOutput('sepsis', JSON.stringify(sepsisInput(encounter))));
  return { ...em, ...sepsis };
}

export const _test = { extractSepsisFacts, encounterType, emInput, sepsisInput };
