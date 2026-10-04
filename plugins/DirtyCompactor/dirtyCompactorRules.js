// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCompactorRules";
  if (window[INSTANCE_KEY]) return;

  // Keep in sync with QUALITY_MBPS_1080P in dirty_compactor_rules.py: typical
  // video Mbps of each constant-quality preset for a 1080p, 30 fps output.
  var QUALITY_MBPS_1080P = { h264: { high: 8, balanced: 5, small: 3 }, hevc: { high: 5, balanced: 3, small: 1.8 } };
  // Keep in sync with CRF in dirty_compactor_quality.py.
  var CRF = { h264: { high: 19, balanced: 22, small: 25 }, hevc: { high: 21, balanced: 24, small: 27 } };
  var QUALITIES = [["high", "High quality"], ["balanced", "Balanced"], ["small", "Smallest files"], ["visual", "Match visual quality (slower)"],
    ["source", "Same bitrate (convert only)"], ["custom", "Custom bitrate"]];
  var VMAF_TARGETS = [["97", "Nearly identical (VMAF 97)"], ["95", "Very close (VMAF 95)"], ["93", "Close (VMAF 93)"], ["90", "Good enough (VMAF 90)"]];
  // Typical audio track, used only for the in-editor estimate; the planner
  // measures the real audio and subtitle streams.
  var ESTIMATE_AUDIO_MBPS = 0.128;
  var RESOLUTIONS = [["854x480", "480p"], ["1280x720", "720p"], ["1920x1080", "1080p"], ["2560x1440", "1440p"], ["3840x2160", "2160p (4K)"]];
  var ACTIONS = { resize: "Resize", reencode: "Reencode", delete: "Delete" };
  var CODECS = { h264: "H.264", hevc: "H.265" };

  /** @template T @param {T} value @returns {T} */
  function copy(value) { return JSON.parse(JSON.stringify(value)); }

  /** @param {number} value @returns {string} */
  function bytes(value) {
    var amount = Number(value || 0), units = ["B", "KiB", "MiB", "GiB", "TiB"], index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
    return amount.toFixed(index ? 2 : 0) + " " + units[index];
  }

  /** @returns {CompactorRule} */
  function newRule() {
    return { id: "rule-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2), name: "New rule", enabled: false,
      mode: "manual", condition: { scene: {}, find: {}, query: "", all: false }, action: "resize", width: 1920, height: 1080,
      quality: "balanced", vmaf: 95, mbps: 4, codec: "h264", encoder: "auto", format: "keep" };
  }

  /** @param {Partial<CompactorSettings>} value */
  function normalize(value) {
    var list = Array.isArray(value.rules) ? value.rules : [];
    return { schemaVersion: 1, rules: list.map(fitQuality), automationPaused: value.automationPaused !== false };
  }

  /**
   * Keeping the bitrate while lowering the resolution cannot save space
   * (size ≈ bitrate × duration), so Resize rules use a preset instead.
   * @param {CompactorRule} rule @returns {CompactorRule}
   */
  function fitQuality(rule) {
    return rule && rule.action === "resize" && rule.quality === "source" ? Object.assign({}, rule, { quality: "balanced" }) : rule;
  }

  /** Quality choices for an action. @param {string} action @returns {string[][]} */
  function qualities(action) {
    return action === "resize" ? QUALITIES.filter(function (item) { return item[0] !== "source"; }) : QUALITIES;
  }

  /** Rules saved before presets existed keep their explicit bitrate. @param {{quality?: string}} rule @returns {string} */
  function quality(rule) { return rule.quality || "custom"; }

  /** @param {CompactorSettings} value @returns {string} */
  function validation(value) {
    var ids = {};
    for (var i = 0; i < value.rules.length; i++) {
      var r = value.rules[i], condition = r.condition || {};
      if (!r.id || ids[r.id]) return "Rules need unique IDs.";
      ids[r.id] = true;
      if (r.enabled && !r.name.trim()) return "Name each enabled rule.";
      if (r.enabled && !condition.all && !Object.keys(condition.scene || {}).length && !(condition.find || {}).q) return "Choose a filter or All scenes for “" + r.name + "”.";
      if (r.action !== "delete" && r.quality === "visual" && !VMAF_TARGETS.some(function (item) { return Number(item[0]) === r.vmaf; })) return "Choose a visual quality target for “" + r.name + "”.";
      if (r.action !== "delete" && quality(r) === "custom" && (!Number.isFinite(Number(r.mbps)) || Number(r.mbps) < 0.05 || Number(r.mbps) > 1000)) return "Target video bitrate must be 0.05–1000 Mbps.";
      if (r.action === "resize" && [r.width, r.height].some(function (v) { return !Number.isInteger(Number(v)) || Number(v) < 2 || Number(v) > 16384; })) return "Dimensions must be whole numbers from 2 to 16384.";
    }
    return "";
  }

  /** Mirrors visual_preset() in dirty_compactor_rules.py. @param {number} vmaf @returns {string} */
  function visualPreset(vmaf) { return vmaf >= 96 ? "high" : vmaf >= 94 ? "balanced" : "small"; }

  /** Mirrors target_mbps() in dirty_compactor_rules.py. @param {CompactorRule} rule @param {number} width @param {number} height @param {number=} fps @param {number=} sourceBitrate @returns {number} */
  function targetMbps(rule, width, height, fps, sourceBitrate) {
    if (quality(rule) === "custom") return Number(rule.mbps);
    if (rule.quality === "source") return Number(sourceBitrate || 0) / 1e6;
    var base = (QUALITY_MBPS_1080P[rule.codec] || QUALITY_MBPS_1080P.h264)[rule.quality === "visual" ? visualPreset(rule.vmaf) : rule.quality];
    var motion = Math.sqrt(Math.max(1, Math.min(Number(fps) || 30, 120) / 30));
    return Math.round(Math.max(0.2, base * Math.pow(Math.max(1, width * height) / (1920 * 1080), 0.75) * motion) * 100) / 100;
  }

  /** Mirrors dimensions() in dirty_compactor_rules.py. @param {number} width @param {number} height @param {CompactorRule} rule @returns {number[]} */
  function outputSize(width, height, rule) {
    if (rule.action !== "resize") return [width, height];
    var bw = Number(rule.width), bh = Number(rule.height);
    if (height > width && bw > bh) { var swap = bw; bw = bh; bh = swap; }
    var factor = Math.min(1, bw / width, bh / height);
    if (factor === 1) return [width, height];
    return [Math.max(2, Math.floor(width * factor / 2) * 2), Math.max(2, Math.floor(height * factor / 2) * 2)];
  }

  /**
   * Source and target video Mbps for a file the planner would encode to a
   * smaller size, or null when it would skip it or keep its bitrate.
   * @param {CompactorRule} rule @param {CompactorMediaFile} file @returns {{source: number, target: number}|null}
   */
  function fileBitrates(rule, file) {
    if (rule.action === "delete" || quality(rule) === "source" || !Number(file.size) || !Number(file.duration) || !file.width || !file.height) return null;
    var output = outputSize(file.width, file.height, rule);
    if (rule.action === "resize" && output[0] === file.width && output[1] === file.height) return null;
    var target = targetMbps(rule, output[0], output[1], file.frame_rate);
    var source = Number(file.bit_rate) / 1e6 - ESTIMATE_AUDIO_MBPS;
    // The planner never raises a bitrate; such files are skipped or converted as-is.
    if (source > 0 && source <= target) return null;
    return { source: source, target: target };
  }

  /** Rough bytes one Stash video file would save, following the planner's skip rules. @param {CompactorRule} rule @param {CompactorMediaFile} file @returns {number} */
  function fileSaving(rule, file) {
    if (rule.action === "delete") return Number(file.size) || 0;
    var rates = fileBitrates(rule, file);
    if (!rates) return 0;
    return Math.max(0, Number(file.size) - (rates.target + ESTIMATE_AUDIO_MBPS) * 1e6 * Number(file.duration) / 8 * 1.02);
  }

  /**
   * Scale a sample of matching scenes to the whole filter.
   * @param {CompactorRule} rule @param {{count: number, filesize: number, scenes: Array<{files: CompactorMediaFile[]}>}} sample
   * @returns {{saved: number, total: number, sampled: number, exact: boolean, sourceMbps: number, targetMbps: number}}
   */
  function estimate(rule, sample) {
    var sampledBytes = 0, savedBytes = 0, seconds = 0, sourceBits = 0, targetBits = 0;
    sample.scenes.forEach(function (scene) {
      (scene.files || []).forEach(function (file) {
        var rates = fileBitrates(rule, file), duration = Number(file.duration) || 0;
        sampledBytes += Number(file.size) || 0;
        savedBytes += fileSaving(rule, file);
        if (rates && rates.source > 0) { seconds += duration; sourceBits += rates.source * duration; targetBits += rates.target * duration; }
      });
    });
    var exact = rule.action === "delete" || sample.scenes.length >= sample.count;
    var saved = rule.action === "delete" ? sample.filesize : exact ? savedBytes : sampledBytes ? sample.filesize * savedBytes / sampledBytes : 0;
    // Duration-weighted average video bitrate of the files that would shrink.
    return { saved: saved, total: sample.filesize, sampled: sample.scenes.length, exact: exact,
      sourceMbps: seconds ? sourceBits / seconds : 0, targetMbps: seconds ? targetBits / seconds : 0 };
  }

  /** @param {CompactorRule} rule @returns {string} */
  function qualityHint(rule) {
    if (quality(rule) === "custom") return "Video bitrate for every file, never above its original bitrate. Audio and subtitles are kept as they are.";
    if (rule.quality === "visual") return "When the run reaches each video, it test-encodes three short clips and keeps the smallest setting that still looks this close to the original, measured with VMAF. That adds about half a minute per video; Preview stays quick and shows typical estimates.";
    if (rule.quality === "source") return "Keeps each video's bitrate, so files stay about the same size; a better codec then looks better, not smaller. " +
      "For the same look in less space, choose Match visual quality. Videos already in " + CODECS[rule.codec] + " are skipped.";
    var width = rule.action === "resize" ? Number(rule.width) : 1920, height = rule.action === "resize" ? Number(rule.height) : 1080;
    var label = (RESOLUTIONS.find(function (item) { return item[0] === width + "x" + height; }) || [0, width + "×" + height])[1];
    return "Constant quality (CRF " + (CRF[rule.codec] || CRF.h264)[rule.quality] + "): each scene gets the bits it needs, never more than the original. " +
      "Typically about " + targetMbps(rule, width, height) + " Mbps for " + label + " " + CODECS[rule.codec] + "; sizes vary with the content.";
  }

  var FIELD_LABELS = { rating100: "Rating", o_counter: "O count", play_count: "Play count", play_duration: "Play time",
    resume_time: "Resume time", file_count: "File count", tag_count: "Tag count", performer_count: "Performer count",
    video_codec: "Video codec", audio_codec: "Audio codec", frame_rate: "Frame rate", average_resolution: "Average resolution",
    is_missing: "Missing", has_markers: "Has markers", performer_favorite: "Favorite performer", performer_tags: "Performer tags",
    performer_age: "Performer age", studios: "Studio", groups: "Groups", galleries: "Galleries", created_at: "Created",
    updated_at: "Updated", last_played_at: "Last played", stash_id_endpoint: "StashID", code: "Studio code", url: "URL" };
  var NOUNS = { tags: ["tag", "tags"], performer_tags: ["tag", "tags"], performers: ["performer", "performers"], studios: ["studio", "studios"],
    groups: ["group", "groups"], galleries: ["gallery", "galleries"] };
  var RESOLUTION_ENUMS = { VERY_LOW: "144p", LOW: "240p", R360P: "360p", STANDARD: "480p", WEB_HD: "540p", STANDARD_HD: "720p",
    FULL_HD: "1080p", QUAD_HD: "1440p", FOUR_K: "4K", FIVE_K: "5K", SIX_K: "6K", SEVEN_K: "7K", EIGHT_K: "8K", HUGE: "Huge" };
  var OPERATORS = { EQUALS: "=", NOT_EQUALS: "≠", GREATER_THAN: ">", LESS_THAN: "<", INCLUDES: "contains", EXCLUDES: "doesn't contain",
    MATCHES_REGEX: "matches", NOT_MATCHES_REGEX: "doesn't match" };

  /** @param {string} key @returns {string} */
  function fieldLabel(key) { return FIELD_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1)).replace(/_/g, " "); }

  /** @param {string} type @param {number} count @returns {string} */
  function countLabel(type, count) { var noun = NOUNS[type] || ["item", "items"]; return count + " " + noun[count === 1 ? 0 : 1]; }

  /** @param {number} seconds @returns {string} */
  function clock(seconds) {
    var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = Math.round(seconds % 60);
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  /** @param {string} type @param {*} value @returns {string} */
  function formatValue(type, value) {
    if (value === true || value === "true") return "yes";
    if (value === false || value === "false") return "no";
    if (type === "rating100" && Number.isFinite(Number(value))) { var stars = Math.round(Number(value) / 2) / 10; return stars + (stars === 1 ? " star" : " stars"); }
    if (/^(duration|play_duration|resume_time)$/.test(type) && Number.isFinite(Number(value))) return clock(Number(value));
    if (/resolution$/.test(type)) return RESOLUTION_ENUMS[value] || String(value).replace(/k$/, "K");
    if (typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value)) return value.toLowerCase().replace(/_/g, " ");
    return typeof value === "string" ? "“" + value + "”" : String(value);
  }

  /** @param {Array<*>} items @param {string} type @param {boolean} hideNames @returns {string} */
  function names(items, type, hideNames) {
    if (hideNames || items.some(function (item) { return typeof item !== "object" || !item.label; })) return countLabel(type, items.length);
    var labels = items.map(function (item) { return item.label; });
    return labels.slice(0, 3).join(", ") + (labels.length > 3 ? " +" + (labels.length - 3) + " more" : "");
  }

  /** One readable clause for a Stash criterion. @param {string} type @param {string|undefined} modifier @param {*} value @param {boolean} hideNames @returns {string} */
  function describeCriterion(type, modifier, value, hideNames) {
    var label = fieldLabel(type);
    if (/^(AND|OR|NOT)$/.test(type)) return "Combined filter";
    if (modifier === "IS_NULL") return label + " is empty";
    if (modifier === "NOT_NULL") return label + " is set";
    var hierarchical = value && typeof value === "object" && Array.isArray(value.items);
    if (hierarchical || Array.isArray(value)) {
      var included = hierarchical ? value.items : value, excluded = hierarchical ? value.excluded || [] : [];
      var prefix = modifier === "INCLUDES_ALL" ? "all of " : modifier === "EXCLUDES" ? "not " : "";
      var text = included.length ? label + ": " + prefix + names(included, type, hideNames) : label + ": any";
      return text + (excluded.length ? ", not " + names(excluded, type, hideNames) : "");
    }
    if (value && typeof value === "object" && "value" in value) {
      if (modifier === "BETWEEN" || modifier === "NOT_BETWEEN") return label + (modifier === "NOT_BETWEEN" ? " not" : "") + " between " + formatValue(type, value.value) + " and " + formatValue(type, value.value2);
      value = value.value;
    }
    return modifier && OPERATORS[modifier] ? label + " " + OPERATORS[modifier] + " " + formatValue(type, value) : label + ": " + formatValue(type, value);
  }

  /** Friendly remaining time. @param {number} seconds @returns {string} */
  function timeLeft(seconds) {
    if (seconds < 60) return "less than a minute left";
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return "about " + minutes + " min left";
    var hours = Math.floor(minutes / 60), rest = minutes % 60;
    return "about " + hours + " h" + (rest ? " " + rest + " min" : "") + " left";
  }

  /** Swap Stash's URL-friendly parentheses back to JSON braces outside strings. @param {string} text @returns {string} */
  function braces(text) {
    var quoted = false, escaped = false, out = "";
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (escaped) escaped = false;
      else if (c === "\\" && quoted) escaped = true;
      else if (c === "\"") quoted = !quoted;
      else if (!quoted && c === "(") c = "{";
      else if (!quoted && c === ")") c = "}";
      out += c;
    }
    return out;
  }

  /** Criteria saved by the native filter editor keep display labels for tags, performers, and studios. @param {string} query @returns {Array<*>} */
  function queryCriteria(query) {
    return String(query || "").split("&").filter(function (part) { return part.indexOf("c=") === 0; }).map(function (part) {
      try { return JSON.parse(braces(decodeURIComponent(part.slice(2).replace(/\+/g, " ")))); } catch (error) { return null; }
    }).filter(function (criterion) { return criterion && typeof criterion.type === "string"; });
  }

  /** @param {{all?: boolean, scene?: object, find?: {q?: string}, query?: string}} condition @param {boolean=} hideNames @returns {string} */
  function filterSummary(condition, hideNames) {
    if (condition.all) return "All scenes";
    var labels = queryCriteria(condition.query).map(function (c) { return describeCriterion(c.type, c.modifier, c.value, Boolean(hideNames)); });
    if (!labels.length) labels = Object.keys(condition.scene || {}).map(function (key) {
      var entry = condition.scene[key], criterion = entry && typeof entry === "object" && "modifier" in entry;
      return describeCriterion(key, criterion ? entry.modifier : undefined, criterion ? ("value2" in entry ? entry : entry.value) : entry, Boolean(hideNames));
    });
    if ((condition.find || {}).q) labels.unshift("Search “" + condition.find.q + "”");
    return labels.join(" · ") || "No condition selected";
  }

  /** One-line description of what a rule does. @param {CompactorRule} rule @returns {string} */
  function actionSummary(rule) {
    if (rule.action === "delete") return "Delete scene and files";
    var parts = [ACTIONS[rule.action]];
    if (rule.action === "resize") parts.push("max " + ((RESOLUTIONS.find(function (item) { return item[0] === rule.width + "x" + rule.height; }) || [0, rule.width + "×" + rule.height])[1]));
    parts.push(CODECS[rule.codec] || rule.codec);
    parts.push(quality(rule) === "custom" ? rule.mbps + " Mbps" : rule.quality === "source" ? "same bitrate" : rule.quality === "visual" ? "visual match VMAF " + rule.vmaf : (QUALITIES.find(function (item) { return item[0] === rule.quality; }) || ["", rule.quality])[1].toLowerCase());
    return parts.join(" · ");
  }

  window[INSTANCE_KEY] = { copy: copy, bytes: bytes, newRule: newRule, normalize: normalize, validation: validation, filterSummary: filterSummary,
    actionSummary: actionSummary, timeLeft: timeLeft, targetMbps: targetMbps, outputSize: outputSize, fileBitrates: fileBitrates, fileSaving: fileSaving, estimate: estimate, qualityHint: qualityHint, quality: quality,
    fitQuality: fitQuality, visualPreset: visualPreset, CRF: CRF, qualities: qualities, QUALITIES: QUALITIES, RESOLUTIONS: RESOLUTIONS, VMAF_TARGETS: VMAF_TARGETS };
})();
