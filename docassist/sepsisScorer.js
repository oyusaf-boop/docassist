'use strict';

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function scoreRespiratory(facts) {
  if (!finite(facts.pao2) || !finite(facts.fio2) || facts.fio2 <= 0) return null;
  const ratio = facts.pao2 / facts.fio2;
  const support = facts.respiratory_support === true;
  if (ratio < 100 && support) return { score: 4, value: ratio };
  if (ratio < 200 && support) return { score: 3, value: ratio };
  if (ratio < 300) return { score: 2, value: ratio };
  if (ratio < 400) return { score: 1, value: ratio };
  return { score: 0, value: ratio };
}

function scoreCoagulation(platelets) {
  if (!finite(platelets)) return null;
  if (platelets < 20) return 4;
  if (platelets < 50) return 3;
  if (platelets < 100) return 2;
  if (platelets < 150) return 1;
  return 0;
}

function scoreLiver(bilirubin) {
  if (!finite(bilirubin)) return null;
  if (bilirubin >= 12) return 4;
  if (bilirubin >= 6) return 3;
  if (bilirubin >= 2) return 2;
  if (bilirubin >= 1.2) return 1;
  return 0;
}

function scoreCardiovascular(facts) {
  const dopamine = facts.dopamine_mcg_kg_min;
  const epinephrine = facts.epinephrine_mcg_kg_min;
  const norepinephrine = facts.norepinephrine_mcg_kg_min;
  if ((finite(dopamine) && dopamine > 15) ||
      (finite(epinephrine) && epinephrine > 0.1) ||
      (finite(norepinephrine) && norepinephrine > 0.1)) return 4;
  if ((finite(dopamine) && dopamine > 5) ||
      (finite(epinephrine) && epinephrine > 0) ||
      (finite(norepinephrine) && norepinephrine > 0)) return 3;
  if (finite(dopamine) && dopamine > 0) return 2;
  if (finite(facts.dobutamine_mcg_kg_min) && facts.dobutamine_mcg_kg_min > 0) return 2;
  if (finite(facts.map)) return facts.map < 70 ? 1 : 0;
  return null;
}

function scoreCns(gcs) {
  if (!finite(gcs)) return null;
  if (gcs < 6) return 4;
  if (gcs <= 9) return 3;
  if (gcs <= 12) return 2;
  if (gcs <= 14) return 1;
  return 0;
}

function scoreRenal(creatinine, urineOutputMlDay) {
  if (finite(urineOutputMlDay) && urineOutputMlDay < 200) return 4;
  if (finite(creatinine) && creatinine >= 5) return 4;
  if (finite(urineOutputMlDay) && urineOutputMlDay < 500) return 3;
  if (finite(creatinine) && creatinine >= 3.5) return 3;
  if (finite(creatinine) && creatinine >= 2) return 2;
  if (finite(creatinine) && creatinine >= 1.2) return 1;
  if (finite(creatinine)) return 0;
  return null;
}

function component(system, current, baseline, display) {
  const known = current !== null;
  const baselineKnown = baseline !== null;
  return {
    system,
    current_score: current,
    baseline_score: baseline,
    acute_change: known && baselineKnown ? Math.max(0, current - baseline) : null,
    known,
    baseline_known: baselineKnown,
    value: display,
  };
}

function scoreSofa(facts) {
  const respiratory = scoreRespiratory(facts);
  const baselineRespiratory = scoreRespiratory({
    pao2: facts.baseline_pao2,
    fio2: facts.baseline_fio2,
    respiratory_support: facts.baseline_respiratory_support,
  });
  const components = [
    component('Respiratory (PaO2/FiO2)', respiratory && respiratory.score, baselineRespiratory && baselineRespiratory.score,
      respiratory ? `P/F ${Math.round(respiratory.value)}` : 'not documented'),
    component('Coagulation (Platelets)', scoreCoagulation(facts.platelets), scoreCoagulation(facts.baseline_platelets),
      finite(facts.platelets) ? `${facts.platelets} K/µL` : 'not documented'),
    component('Liver (Bilirubin)', scoreLiver(facts.bilirubin), scoreLiver(facts.baseline_bilirubin),
      finite(facts.bilirubin) ? `${facts.bilirubin} mg/dL` : 'not documented'),
    component('Cardiovascular (MAP/vasopressors)', scoreCardiovascular(facts), scoreCardiovascular({
      map: facts.baseline_map,
      dopamine_mcg_kg_min: facts.baseline_dopamine_mcg_kg_min,
      dobutamine_mcg_kg_min: facts.baseline_dobutamine_mcg_kg_min,
      epinephrine_mcg_kg_min: facts.baseline_epinephrine_mcg_kg_min,
      norepinephrine_mcg_kg_min: facts.baseline_norepinephrine_mcg_kg_min,
    }), finite(facts.map) ? `MAP ${facts.map}` : 'not documented'),
    component('CNS (GCS)', scoreCns(facts.gcs), scoreCns(facts.baseline_gcs),
      finite(facts.gcs) ? `GCS ${facts.gcs}` : 'not documented'),
    component('Renal (Creatinine/UOP)', scoreRenal(facts.creatinine, facts.urine_output_ml_day),
      scoreRenal(facts.baseline_creatinine, facts.baseline_urine_output_ml_day),
      finite(facts.creatinine) ? `Cr ${facts.creatinine} mg/dL` :
        (finite(facts.urine_output_ml_day) ? `UOP ${facts.urine_output_ml_day} mL/day` : 'not documented')),
  ];
  const known = components.filter(item => item.known);
  const currentScore = known.reduce((sum, item) => sum + item.current_score, 0);
  const baselineComplete = components.every(item => item.baseline_known);
  const baselineScore = baselineComplete
    ? components.reduce((sum, item) => sum + item.baseline_score, 0)
    : null;
  const acuteChange = baselineScore === null ? null : Math.max(0, currentScore - baselineScore);
  return {
    components,
    current_score: currentScore,
    baseline_score: baselineScore,
    acute_change: acuteChange,
    complete: known.length === components.length,
    baseline_complete: baselineComplete,
  };
}

function scoreSirs(facts) {
  const criteria = [
    { name: 'Temp >38°C or <36°C', met: finite(facts.temperature_c) ? facts.temperature_c > 38 || facts.temperature_c < 36 : null, value: finite(facts.temperature_c) ? `${facts.temperature_c}°C` : 'not documented' },
    { name: 'HR >90', met: finite(facts.heart_rate) ? facts.heart_rate > 90 : null, value: finite(facts.heart_rate) ? String(facts.heart_rate) : 'not documented' },
    { name: 'RR >20 or PaCO2 <32', met: finite(facts.respiratory_rate) || finite(facts.paco2) ? (facts.respiratory_rate > 20 || facts.paco2 < 32) : null, value: finite(facts.respiratory_rate) ? `RR ${facts.respiratory_rate}` : (finite(facts.paco2) ? `PaCO2 ${facts.paco2}` : 'not documented') },
    { name: 'WBC >12k, <4k, or >10% bands', met: finite(facts.wbc) || finite(facts.bands_percent) ? (facts.wbc > 12 || facts.wbc < 4 || facts.bands_percent > 10) : null, value: finite(facts.wbc) ? `WBC ${facts.wbc}` : (finite(facts.bands_percent) ? `Bands ${facts.bands_percent}%` : 'not documented') },
  ];
  return {
    criteria,
    criteria_met: criteria.filter(item => item.met === true).length,
    criteria_known: criteria.filter(item => item.met !== null).length,
  };
}

function scoreSepsis(facts) {
  const sirs = scoreSirs(facts);
  const sofa = scoreSofa(facts);
  const infection = facts.infection_documented === true;
  const sofaDeltaMet = sofa.acute_change !== null ? sofa.acute_change >= 2 : null;
  return {
    detected: facts.sepsis_or_infection_suspected === true,
    sepsis2: {
      infection_documented: infection,
      sirs_criteria: sirs.criteria,
      criteria_met: sirs.criteria_met,
      criteria_known: sirs.criteria_known,
      threshold: 2,
      verdict: infection && sirs.criteria_met >= 2 ? 'met' :
        (sirs.criteria_known < 4 ? 'indeterminate' : 'not_met'),
    },
    sepsis3: {
      infection_documented: infection,
      sofa_components: sofa.components,
      sofa_score: sofa.current_score,
      baseline_sofa_score: sofa.baseline_score,
      acute_sofa_change: sofa.acute_change,
      complete: sofa.complete,
      baseline_complete: sofa.baseline_complete,
      verdict: infection && sofaDeltaMet === true ? 'met' :
        (sofaDeltaMet === null ? 'indeterminate' : 'not_met'),
    },
  };
}

module.exports = { scoreSepsis, scoreSirs, scoreSofa };
