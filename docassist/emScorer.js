/* em_mdm scorer — deterministic. Reads em_mdm_FY2026.json + extracted facts, returns scored result.
   Pure function. No DOM, no template-string HTML. Safe to paste into v12 later. */
(function (root) {
  var RANK = { straightforward: 0, low: 1, moderate: 2, high: 3 };
  var ORDER = ["straightforward", "low", "moderate", "high"];

  function rank(level) { return RANK[level] == null ? -1 : RANK[level]; }

  // ---- Data column: fully mechanical from the data_items list ----
  function scoreData(dataItems, dataTiers) {
    var present = {};
    (dataItems || []).forEach(function (id) { present[id] = true; });

    function optionSatisfied(opt) {
      var have = 0;
      (opt.item_pool || []).forEach(function (id) { if (present[id]) have++; });
      return have >= (opt.min_items || 1);
    }
    // walk high -> low, return first satisfied
    for (var i = ORDER.length - 1; i >= 0; i--) {
      var tierName = ORDER[i];
      var tier = dataTiers[tierName];
      if (!tier) continue;
      var need = tier.categories_required || 0;
      if (need === 0) return { level: tierName, satisfied: [] };
      var sat = (tier.options || []).filter(optionSatisfied);
      if (sat.length >= need) {
        return { level: tierName, satisfied: sat.map(function (o) { return o.id; }) };
      }
    }
    return { level: "straightforward", satisfied: [] };
  }

  // highest tier among a list of {tier} objects
  function highestTier(list) {
    var best = "straightforward";
    (list || []).forEach(function (x) { if (rank(x.tier) > rank(best)) best = x.tier; });
    return best;
  }

  // 2-of-3: highest level L where >=2 element levels reach L
  function twoOfThree(pLevel, dLevel, rLevel) {
    var levels = [pLevel, dLevel, rLevel];
    for (var i = ORDER.length - 1; i >= 0; i--) {
      var L = ORDER[i];
      var count = levels.filter(function (lv) { return rank(lv) >= rank(L); }).length;
      if (count >= 2) return L;
    }
    return "straightforward";
  }

  function codeForLevel(family, level, mdm) {
    var fam = mdm.code_families[family];
    if (!fam) return null;
    return fam.codes_by_level[level] || null;
  }

  // time path: highest code in family whose threshold <= documented minutes
  function codeByTime(family, minutes, mdm) {
    if (minutes == null) return null;
    var fam = mdm.code_families[family];
    if (!fam) return null;
    var best = null, bestThresh = -1;
    Object.keys(fam.codes_by_level).forEach(function (lvl) {
      var code = fam.codes_by_level[lvl];
      var t = mdm.time_thresholds_minutes[code];
      if (t != null && minutes >= t && t > bestThresh) { best = code; bestThresh = t; }
    });
    return best ? { code: best, threshold: bestThresh } : null;
  }

  // what's missing for the next level up (gap coaching)
  function upgradeGap(family, mdmLevel, pLevel, dLevel, rLevel, mdm) {
    var idx = rank(mdmLevel);
    if (idx >= ORDER.length - 1) return null; // already high
    var next = ORDER[idx + 1];
    var atNext = [pLevel, dLevel, rLevel].filter(function (lv) { return rank(lv) >= rank(next); }).length;
    var needMore = 2 - atNext; // elements that must rise to `next`
    var laggards = [];
    if (rank(pLevel) < rank(next)) laggards.push("Problems");
    if (rank(dLevel) < rank(next)) laggards.push("Data");
    if (rank(rLevel) < rank(next)) laggards.push("Risk");
    return {
      next_level: next,
      next_code: codeForLevel(family, next, mdm),
      elements_needed: needMore,
      lagging_elements: laggards
    };
  }

  function scoreEM(facts, mdm) {
    var family = (mdm.meta.encounter_type_map[facts.encounter_type]) || facts.encounter_type;
    var dataTiers = mdm.elements.data.tiers;

    var pLevel = highestTier(facts.problems);
    var dRes = scoreData(facts.data_items, dataTiers);
    var dLevel = dRes.level;
    var rLevel = highestTier(facts.risk_matches);

    var mdmLevel = twoOfThree(pLevel, dLevel, rLevel);
    var mdmCode = codeForLevel(family, mdmLevel, mdm);

    var timeRes = codeByTime(family, facts.total_time_minutes, mdm);

    // pick the better-supported code: MDM vs time
    var supportedCode = mdmCode, basis = "mdm_2of3";
    if (timeRes && rank(levelOfCode(family, timeRes.code, mdm)) > rank(mdmLevel)) {
      supportedCode = timeRes.code; basis = "time";
    }

    var lowConf = (facts.risk_matches || []).filter(function (r) {
      return rank(r.tier) >= rank(mdmLevel) && rank(r.tier) >= 2; // risk drove a mod/high call
    }).map(function (r) { return r.example; });

    return {
      family: family,
      element_levels: { problems: pLevel, data: dLevel, risk: rLevel },
      data_categories_met: dRes.satisfied,
      mdm_level: mdmLevel,
      mdm_code: mdmCode,
      time_supports: timeRes,
      supported_code: supportedCode,
      basis: basis,
      upgrade_gap: upgradeGap(family, mdmLevel, pLevel, dLevel, rLevel, mdm),
      low_confidence_flags: lowConf
    };
  }

  function levelOfCode(family, code, mdm) {
    var fam = mdm.code_families[family];
    if (!fam) return "straightforward";
    var found = "straightforward";
    Object.keys(fam.codes_by_level).forEach(function (lvl) {
      if (fam.codes_by_level[lvl] === code) found = lvl;
    });
    return found;
  }

  var api = { scoreEM: scoreEM, scoreData: scoreData, twoOfThree: twoOfThree };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.emScorer = api;
})(typeof window !== "undefined" ? window : null);
