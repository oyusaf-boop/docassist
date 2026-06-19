var em = require('./emScorer.js');
var mdm = require('./em_mdm_FY2026.json');
function show(name, facts) {
  var r = em.scoreEM(facts, mdm);
  console.log("\n=== " + name + " ===");
  console.log(" elements:", JSON.stringify(r.element_levels));
  console.log(" data cats met:", JSON.stringify(r.data_categories_met));
  console.log(" MDM level/code:", r.mdm_level, "/", r.mdm_code);
  console.log(" time supports:", JSON.stringify(r.time_supports));
  console.log(" => SUPPORTED:", r.supported_code, "(", r.basis, ")");
  if (r.upgrade_gap) console.log(" upgrade:", r.upgrade_gap.elements_needed, "of", JSON.stringify(r.upgrade_gap.lagging_elements), "->", r.upgrade_gap.next_code);
  if (r.low_confidence_flags.length) console.log(" low-conf risk flags:", JSON.stringify(r.low_confidence_flags));
}

// 1) sepsis + CHF exac, 2 data items, IV abx risk — expect 99233 via 2of3
show("Subsequent: sepsis+CHF exac, Limited data, IV abx", {
  encounter_type: "subsequent", total_time_minutes: null,
  problems: [{text:"sepsis", tier:"high"}, {text:"acute on chronic systolic HF exacerbation", tier:"moderate"}],
  data_items: ["review_unique_test_result","order_unique_test"],
  risk_matches: [{tier:"high", example:"IV antibiotics (parenteral)"}]
});

// 2) add independent interpretation -> data should rise to Moderate
show("Subsequent: + independent interp (data->Moderate)", {
  encounter_type: "subsequent", total_time_minutes: null,
  problems: [{text:"sepsis", tier:"high"}, {text:"CHF exac", tier:"moderate"}],
  data_items: ["review_unique_test_result","order_unique_test","independent_interpretation"],
  risk_matches: [{tier:"high", example:"IV antibiotics (parenteral)"}]
});

// 3) TIME PATH: weak MDM (Low) but 52 min documented -> time supports 99233
show("Subsequent: weak MDM, 52 min documented (time path)", {
  encounter_type: "subsequent", total_time_minutes: 52,
  problems: [{text:"stable HTN", tier:"low"}],
  data_items: [],
  risk_matches: [{tier:"low", example:"continue home meds"}]
});

// 4) Straightforward consult -> 99252
show("Consult: 1 minor problem, minimal -> SF", {
  encounter_type: "consult", total_time_minutes: null,
  problems: [{text:"minor rash", tier:"straightforward"}],
  data_items: [],
  risk_matches: [{tier:"straightforward", example:"awaiting discharge"}]
});

// 5) High consult: 2-of-3 high -> 99255
show("Consult: high problem + extensive data + high risk -> 99255", {
  encounter_type: "consult", total_time_minutes: null,
  problems: [{text:"life-threatening GI bleed", tier:"high"}],
  data_items: ["review_external_records","review_unique_test_result","order_unique_test","independent_interpretation"],
  risk_matches: [{tier:"high", example:"decision re: escalation of care"}]
});

// 6) New admit moderate: 2 stable chronic + moderate data + moderate risk -> 99222
show("Initial admit: 2 stable chronic, Moderate data+risk -> 99222", {
  encounter_type: "new_admit", total_time_minutes: null,
  problems: [{text:"DM2 stable", tier:"low"}, {text:"two stable chronic (COPD+HTN)", tier:"moderate"}],
  data_items: ["external_discussion"],
  risk_matches: [{tier:"moderate", example:"Rx med modification"}]
});
