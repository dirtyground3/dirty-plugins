// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCompactorRules";
  if (window[INSTANCE_KEY]) return;

  /** @param {*} value @returns {*} */
  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  /** @param {number} value @returns {string} */
  function bytes(value) {
    var amount = Number(value || 0), units = ["B", "KiB", "MiB", "GiB", "TiB"], index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
    return amount.toFixed(index ? 2 : 0) + " " + units[index];
  }

  /** @returns {{id: string, name: string, enabled: boolean, mode: string, condition: object, action: string, width: number, height: number, mbps: number, codec: string, encoder: string, format: string}} */
  function newRule() {
    return { id: "rule-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2), name: "New rule", enabled: false,
      mode: "manual", condition: { scene: {}, find: {}, query: "", all: false }, action: "resize", width: 1920, height: 1080,
      mbps: 4, codec: "h264", encoder: "auto", format: "keep" };
  }

  /** @param {{rules?: Array<*> , automationPaused?: boolean}} value */
  function normalize(value) { return { schemaVersion: 1, rules: Array.isArray(value.rules) ? value.rules : [], automationPaused: value.automationPaused !== false }; }

  /** @param {{rules: Array<*>}} value @returns {string} */
  function validation(value) {
    var ids = {};
    for (var i = 0; i < value.rules.length; i++) {
      var r = value.rules[i], condition = r.condition || {};
      if (!r.id || ids[r.id]) return "Rules need unique IDs.";
      ids[r.id] = true;
      if (r.enabled && !r.name.trim()) return "Name each enabled rule.";
      if (r.enabled && !condition.all && !Object.keys(condition.scene || {}).length && !(condition.find || {}).q) return "Choose a filter or All scenes for “" + r.name + "”.";
      if (r.action !== "delete" && (!Number.isFinite(Number(r.mbps)) || Number(r.mbps) < 0.05 || Number(r.mbps) > 1000)) return "Target video bitrate must be 0.05–1000 Mbps.";
      if (r.action === "resize" && [r.width, r.height].some(function (v) { return !Number.isInteger(Number(v)) || Number(v) < 2 || Number(v) > 16384; })) return "Dimensions must be whole numbers from 2 to 16384.";
    }
    return "";
  }

  /** @param {{all?: boolean, scene?: object, find?: {q?: string}}} condition @returns {string} */
  function filterSummary(condition) {
    if (condition.all) return "All scenes";
    var labels = Object.keys(condition.scene || {}).map(function (key) { return key.replace(/_/g, " "); });
    if ((condition.find || {}).q) labels.unshift("Search: " + condition.find.q);
    return labels.join(" · ") || "No condition selected";
  }

  window[INSTANCE_KEY] = { copy: copy, bytes: bytes, newRule: newRule, normalize: normalize, validation: validation, filterSummary: filterSummary };
})();
