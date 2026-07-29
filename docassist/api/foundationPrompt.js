import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadProjectJson(filename) {
  const candidates = [
    join(process.cwd(), filename),
    join(process.cwd(), 'docassist', filename)
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  throw new Error(`Unable to load ${filename}`);
}

const FOUNDATION_KB = loadProjectJson('foundation_knowledge_FY2026.json');

function buildKBSummary(kb, onlyDxKeys) {
  if (!kb || !kb.diagnoses) return '';
  const filterSet = (onlyDxKeys && onlyDxKeys.length) ? new Set(onlyDxKeys) : null;
  const dxCount = filterSet ? filterSet.size : Object.keys(kb.diagnoses).length;
  const lines = [];
  lines.push('═══════════════════════════════════════════════');
  lines.push('FOUNDATION CDI REFERENCE — FY2026 (' + dxCount + ' relevant hospitalist dx)');
  lines.push('Use this as authoritative ladder for CC/MCC capture suggestions.');
  lines.push('Each dx lists base code, top capture rungs, hard rules, common misses.');
  lines.push('═══════════════════════════════════════════════');
  lines.push('');

  // Global rules
  if (kb.global_rules) {
    lines.push('GLOBAL HARD RULES:');
    (kb.global_rules.hard_rules_universal || []).forEach(r => lines.push('  • ' + r));
    if (kb.global_rules.cdi_specificity_principle) {
      lines.push('  • CDI principle: ' + kb.global_rules.cdi_specificity_principle);
    }
    lines.push('');
  }

  // Per-dx condensed
  Object.entries(kb.diagnoses).forEach(([dxName, dx]) => {
    if (filterSet && !filterSet.has(dxName)) return;
    lines.push('── ' + dxName + ' ──');
    lines.push('  Base: ' + (dx.base_code || '?') + ' = ' + (dx.cc_mcc || '?'));

    // Top capture opportunities (MCC rungs first, then CC)
    const ladder = dx.specificity_ladder || [];
    const mccRungs = ladder.filter(r => r.cc_mcc && /MCC/i.test(r.cc_mcc)).slice(0, 4);
    const ccRungs = ladder.filter(r => r.cc_mcc && /^CC$/i.test(r.cc_mcc)).slice(0, 2);

    if (mccRungs.length) {
      lines.push('  MCC captures:');
      mccRungs.forEach(r => {
        const trig = r.query_trigger ? ' [trigger: ' + r.query_trigger + ']' : '';
        lines.push('    → ' + (r.label || '') + ' (' + (r.code || '?') + ')' + trig);
      });
    }
    if (ccRungs.length) {
      lines.push('  CC captures:');
      ccRungs.forEach(r => {
        lines.push('    → ' + (r.label || '') + ' (' + (r.code || '?') + ')');
      });
    }

    // AI behavior linkage flag
    if (dx.ai_behavior && dx.ai_behavior.linkage_flag_template) {
      lines.push('  Linkage: ' + dx.ai_behavior.linkage_flag_template);
    }

    // Top hard rules (max 3)
    const hardRules = (dx.hard_rules || []).slice(0, 3);
    if (hardRules.length) {
      lines.push('  Hard rules:');
      hardRules.forEach(r => lines.push('    ! ' + r));
    }

    // Top common misses (max 3)
    const misses = (dx.common_misses || []).slice(0, 3);
    if (misses.length) {
      lines.push('  Common misses:');
      misses.forEach(m => lines.push('    ⚠ ' + m));
    }

    // Medication triggers (high-specificity meds only)
    const medTrigs = (dx.medication_triggers || []).filter(m =>
      m.specificity && /very high|^high/i.test(m.specificity)
    ).slice(0, 3);
    if (medTrigs.length) {
      lines.push('  Med triggers:');
      medTrigs.forEach(m => lines.push('    💊 ' + (m.medication || '') + ' → ' + (m.query_trigger || '')));
    }

    lines.push('');
  });

  return lines.join('\n');
}

// Wrap the system prompt with KB reference if loaded
// ═
// SELECTIVE KB INJECTION (Option C)
// Only inject dx ladders whose keywords appear in the note.
// Global rules always injected. False positives are cheap;
// keywords are intentionally broad to avoid silent misses.
// ═══════════════════════════════════════════════
const KEYWORD_MAP = {
  'AKI': ['aki','acute kidney injury','acute renal failure','atn','acute tubular necrosis','azotemia','creatinine'],
  'Sepsis': ['sepsis','septic','septicemia','bacteremia','sirs','lactate'],
  'Heart failure': ['heart failure','chf','hfref','hfpef','hfmref','cardiomyopathy','volume overload','pulmonary edema','bnp','nt-probnp','ef of','ejection fraction'],
  'Pneumonia': ['pneumonia','pna','infiltrate','consolidation','aspiration','empyema'],
  'COPD exacerbation': ['copd','emphysema','chronic bronchitis','obstructive pulmonary'],
  'Asthma exacerbation': ['asthma','bronchospasm','status asthmaticus','wheez'],
  'Encephalopathy': ['encephalopath'],
  'Acute respiratory failure': ['respiratory failure','hypoxic','hypoxemic','hypoxia','hypercapnic','hypercarbic','bipap','high-flow','high flow','hfnc','intubat','ventilator','mechanical ventilation','nasal cannula'],
  'Malnutrition': ['malnutrition','malnourish','cachexia','cachectic','protein-calorie','protein calorie','underweight','poor oral intake','aspen'],
  'Pressure injury': ['pressure injury','pressure ulcer','decubitus','sacral ulcer','sacral wound','bedsore','stage 3','stage 4','unstageable'],
  'Delirium / AMS': ['delirium','altered mental status','ams','confusion','confused','disoriented','sundowning'],
  'DKA / HHS': ['dka','diabetic ketoacidosis','hhs','hyperosmolar','ketoacidosis','anion gap','ketones','ketonemia'],
  'Diabetes with complications': ['diabetes','diabetic','t2dm','t1dm','dm2','iddm','niddm','hyperglycemia','insulin','a1c','hemoglobin a1c'],
  'CKD': ['ckd','chronic kidney disease','esrd','end-stage renal','end stage renal','dialysis','hemodialysis','gfr'],
  'Atrial fibrillation': ['atrial fibrillation','afib','a-fib','a fib','atrial flutter','rvr'],
  'NSTEMI / STEMI / Type 2 MI': ['nstemi','stemi','myocardial infarction','troponin','acs','acute coronary','demand ischemia','chest pain','cath lab','heart cath'],
  'PE / DVT': ['pulmonary embolism','pe','dvt','deep vein','deep venous','venous thromboembolism','vte','d-dimer','d dimer','saddle embol','thrombus','thrombosis'],
  'GI bleed': ['gi bleed','gib','gastrointestinal bleed','melena','hematemesis','hematochezia','brbpr','coffee ground','variceal bleed','ugib','lgib'],
  'Cirrhosis with decompensation': ['cirrhosis','cirrhotic','ascites','hepatic encephalopathy','varices','esophageal varices','meld','paracentesis','sbp','spontaneous bacterial'],
  'Hyponatremia': ['hyponatremia','hyponatremic','siadh','low sodium','sodium of 1'],
  'UTI / pyelonephritis / urosepsis': ['uti','urinary tract infection','pyelonephritis','urosepsis','cystitis','pyuria','urine culture'],
  'Cellulitis': ['cellulitis','erysipelas','abscess','skin and soft tissue','ssti','necrotizing'],
  'COVID-19': ['covid','sars-cov-2','sars cov','coronavirus'],
  'Stroke / TIA': ['stroke','cva','tia','transient ischemic','cerebrovascular','hemiparesis','aphasia','dysarthria','facial droop','thrombectomy','tpa','tnk','tenecteplase','alteplase'],
  'Hypertensive emergency': ['hypertensive emergency','hypertensive urgency','hypertensive crisis','malignant hypertension','htn emergency','htn urgency'],
  'Shock': ['shock','hypotension','hypotensive','pressor','vasopressor','norepinephrine','levophed','vasopressin','phenylephrine','map <','map<'],
  'Pancreatitis': ['pancreatitis','lipase'],
  'C diff': ['c diff','c. diff','cdiff','clostridioides','clostridium difficile','pseudomembranous'],
  'Anemia': ['anemia','anemic','hemoglobin of','hgb of','transfus','prbc','blood loss'],
  'Hyperkalemia / electrolyte disturbances': ['hyperkalemia','hypokalemia','hyperkalemic','potassium of','k of 6','k of 5','hypomagnesemia','hypocalcemia','hypophosphatemia','electrolyte'],
  'Rhabdomyolysis': ['rhabdomyolysis','rhabdo','creatine kinase','ck of','cpk','myoglobin'],
  'Alcohol withdrawal': ['alcohol withdrawal','etoh withdrawal','etoh','ciwa','delirium tremens','dts','alcohol use disorder','alcoholism','drinks per day']
};

// Returns array of dx keys whose keywords appear in the note (word-boundary match)
function getMatchedDxKeys(noteText) {
  if (!noteText) return [];
  const text = noteText.toLowerCase();
  const matched = [];
  Object.entries(KEYWORD_MAP).forEach(([dxKey, keywords]) => {
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Word boundary for short tokens to avoid substring false hits ("pe" in "type")
      const pattern = kw.length <= 4 ? '\\b' + escaped + '\\b' : escaped;
      if (new RegExp(pattern, 'i').test(text)) { matched.push(dxKey); break; }
    }
  });
  return matched;
}

// Selective wrapper: global rules always, dx ladders only if matched in note


export function withFoundationKnowledge(systemPrompt, noteText) {
  const matched = getMatchedDxKeys(noteText);
  const summary = buildKBSummary(FOUNDATION_KB, matched.length ? matched : null);
  return summary ? systemPrompt + '\n\n' + summary : systemPrompt;
}
