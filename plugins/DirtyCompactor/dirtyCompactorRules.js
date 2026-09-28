// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCompactorRules";
  if (window[INSTANCE_KEY]) return;

  // Keep in sync with QUALITY_MBPS_1080P in dirty_compactor_rules.py: video
  // Mbps for a 1080p, 30 fps output, scaled per file by the backend.
  var QUALITY_MBPS_1080P = { h264: { high: 8, balanced: 5, small: 3 }, hevc: { high: 5, balanced: 3, small: 1.8 } };
  var QUALITIES = [["high", "High quality"], ["balanced", "Balanced"], ["small", "Smallest files"], ["custom", "Custom bitrate"]];
  var RESOLUTIONS = [["854x480", "480p"], ["1280x720", "720p"], ["1920x1080", "1080p"], ["2560x1440", "1440p"], ["3840x2160", "2160p (4K)"]];
  var ACTIONS = { resize: "Resize", reencode: "Reencode", delete: "Delete" };
  var CODECS = { h264: "H.264", hevc: "H.265" };

  /** @param {*} value @returns {*} */
  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  /** @param {number} value @returns {string} */
  function bytes(value) {
    var amount = Number(value || 0), units = ["B", "KiB", "MiB", "GiB", "TiB"], index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
    return amount.toFixed(index ? 2 : 0) + " " + units[index];
  }

  /** @returns {{id: string, name: string, enabled: boolean, mode: string, condition: object, action: string, width: number, height: number, quality: string, mbps: number, codec: string, encoder: string, format: string}} */
  function newRule() {
    return { id: "rule-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2), name: "New rule", enabled: false,
      mode: "manual", condition: { scene: {}, find: {}, query: "", all: false }, action: "resize", width: 1920, height: 1080,
      quality: "balanced", mbps: 4, codec: "h264", encoder: "auto", format: "keep" };
  }

  /** @param {{rules?: Array<*> , automationPaused?: boolean}} value */
  function normalize(value) { return { schemaVersion: 1, rules: Array.isArray(value.rules) ? value.rules : [], automationPaused: value.automationPaused !== false }; }

  /** Rules saved before presets existed keep their explicit bitrate. @param {{quality?: string}} rule @returns {string} */
  function quality(rule) { return rule.quality || "custom"; }

  /** @param {{rules: Array<*>}} value @returns {string} */
  function validation(value) {
    var ids = {};
    for (var i = 0; i < value.rules.length; i++) {
      var r = value.rules[i], condition = r.condition || {};
      if (!r.id || ids[r.id]) return "Rules need unique IDs.";
      ids[r.id] = true;
      if (r.enabled && !r.name.trim()) return "Name each enabled rule.";
      if (r.enabled && !condition.all && !Object.keys(condition.scene || {}).length && !(condition.find || {}).q) return "Choose a filter or All scenes for “" + r.name + "”.";
      if (r.action !== "delete" && quality(r) === "custom" && (!Number.isFinite(Number(r.mbps)) || Number(r.mbps) < 0.05 || Number(r.mbps) > 1000)) return "Target video bitrate must be 0.05–1000 Mbps.";
      if (r.action === "resize" && [r.width, r.height].some(function (v) { return !Number.isInteger(Number(v)) || Number(v) < 2 || Number(v) > 16384; })) return "Dimensions must be whole numbers from 2 to 16384.";
    }
    return "";
  }

  /** Mirrors target_mbps() in dirty_compactor_rules.py. @param {*} rule @param {number} width @param {number} height @returns {number} */
  function targetMbps(rule, width, height) {
    if (quality(rule) === "custom") return Number(rule.mbps);
    var base = (QUALITY_MBPS_1080P[rule.codec] || QUALITY_MBPS_1080P.h264)[rule.quality];
    return Math.round(Math.max(0.2, base * Math.pow(Math.max(1, width * height) / (1920 * 1080), 0.75)) * 100) / 100;
  }

  /** @param {*} rule @returns {string} */
  function qualityHint(rule) {
    if (quality(rule) === "custom") return "Video bitrate for every file. Audio and subtitles are kept as they are.";
    var width = rule.action === "resize" ? Number(rule.width) : 1920, height = rule.action === "resize" ? Number(rule.height) : 1080;
    var label = (RESOLUTIONS.find(function (item) { return item[0] === width + "x" + height; }) || [0, width + "×" + height])[1];
    return "About " + targetMbps(rule, width, height) + " Mbps for " + label + " " + CODECS[rule.codec] +
      (rule.action === "resize" ? "; smaller videos get less." : ", adjusted to each video's resolution.");
  }

  /** @param {{all?: boolean, scene?: object, find?: {q?: string}}} condition @returns {string} */
  function filterSummary(condition) {
    if (condition.all) return "All scenes";
    var labels = Object.keys(condition.scene || {}).map(function (key) { return key.replace(/_/g, " "); });
    if ((condition.find || {}).q) labels.unshift("Search: " + condition.find.q);
    return labels.join(" · ") || "No condition selected";
  }

  /** One-line description of what a rule does. @param {*} rule @returns {string} */
  function actionSummary(rule) {
    if (rule.action === "delete") return "Delete scene and files";
    var parts = [ACTIONS[rule.action]];
    if (rule.action === "resize") parts.push("max " + ((RESOLUTIONS.find(function (item) { return item[0] === rule.width + "x" + rule.height; }) || [0, rule.width + "×" + rule.height])[1]));
    parts.push(CODECS[rule.codec] || rule.codec);
    parts.push(quality(rule) === "custom" ? rule.mbps + " Mbps" : (QUALITIES.find(function (item) { return item[0] === rule.quality; }) || [0, rule.quality])[1].toLowerCase());
    return parts.join(" · ");
  }

  window[INSTANCE_KEY] = { copy: copy, bytes: bytes, newRule: newRule, normalize: normalize, validation: validation, filterSummary: filterSummary,
    actionSummary: actionSummary, targetMbps: targetMbps, qualityHint: qualityHint, quality: quality,
    QUALITIES: QUALITIES, RESOLUTIONS: RESOLUTIONS };
})();
