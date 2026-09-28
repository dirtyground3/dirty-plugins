// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyTidySettings";
  if (window[INSTANCE_KEY]) return;
  var DirtyPlugins = window.DirtyPlugins;

  var DEFAULT_SETTINGS = {
    moveEnabled: true,
    moveRequireStashId: false,
    hierarchyLevels: ["{studio}", "{year}"],
    renameEnabled: false,
    renameRequireStashId: false,
    renamePattern: "{date} - {studio} - {title}",
    maxFilenameLength: 180,
    multiValueSeparator: ", ",
    automationMode: "manual",
    approvedStrategyHash: "",
    approvedPlanDigest: "",
  };
  var VARIABLES = [
    ["title", "Title"],
    ["scene_id", "Scene ID"],
    ["stash_id", "Stash ID"],
    ["date", "Date"],
    ["year", "Year"],
    ["month", "Month"],
    ["day", "Day"],
    ["rating", "Rating"],
    ["grade", "Grade (A–F)"],
    ["rating_bucket", "Rating bucket"],
    ["organized", "Organized"],
    ["studio", "Studio"],
    ["parent_studio", "Parent studio"],
    ["performers", "Performers"],
    ["first_performer", "First performer"],
    ["female_performers", "Female performers"],
    ["male_performers", "Male performers"],
    ["first_female_performer", "First female performer"],
    ["first_male_performer", "First male performer"],
    ["performer_count", "Performer count"],
    ["tags", "Tags"],
    ["first_tag", "First tag"],
    ["group", "Group"],
    ["group_position", "Group position"],
    ["resolution", "Resolution"],
    ["height", "Height"],
    ["video_codec", "Video codec"],
    ["duration", "Duration (minutes)"],
    ["duration_bucket", "Duration bucket"],
    ["source", "Source"],
    ["original_name", "Original name"],
    ["extension", "Extension"],
  ];

  // The Python backend's normalize_settings() is the single source of truth.
  // These helpers mirror it exactly so a saved draft always hashes to the same
  // strategy the server planned with, and so a stale preview cannot be caused
  // by the two sides defaulting differently.
  /** @param {*} value @returns {string[]} */
  function parseLevels(value) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_error) { value = [value]; }
    }
    if (!Array.isArray(value)) return DEFAULT_SETTINGS.hierarchyLevels.slice();
    // An explicit all-empty list stays empty rather than reverting to the
    // defaults the server would never plan with.
    return value.map(function (item) {
      var template = (typeof item === "object" && item) ? item.template : item;
      return template ? String(template).trim() : "";
    }).filter(Boolean);
  }

  /** @param {*} value @returns {number} */
  function parseMaxFilenameLength(value) {
    var number;
    if (typeof value === "number" && Number.isFinite(value)) number = Math.trunc(value);
    else if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) number = parseInt(value.trim(), 10);
    else return DEFAULT_SETTINGS.maxFilenameLength;
    return Math.max(16, Math.min(255, number));
  }

  function parseSeparator(value) {
    var separator = value == null ? DEFAULT_SETTINGS.multiValueSeparator : String(value);
    if (!separator) separator = DEFAULT_SETTINGS.multiValueSeparator;
    return separator.slice(0, 10);
  }

  function parseRenamePattern(source) {
    if (!Object.prototype.hasOwnProperty.call(source, "renamePattern")) {
      return DEFAULT_SETTINGS.renamePattern;
    }
    return source.renamePattern ? String(source.renamePattern).trim() : "";
  }

  /** @param {*} value @param {boolean} fallback @returns {boolean} */
  function parseBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
      return Boolean(value);
    }
    if (value === null || value === undefined) return fallback;
    if (typeof value === "number") return value !== 0;
    return Boolean(value);
  }

  function parseAutomationMode(value) {
    var mode = String(value == null ? "" : value).trim().toLowerCase();
    return ["manual", "scan", "generate"].indexOf(mode) >= 0 ? mode : "manual";
  }

  function parseApprovalHash(value) {
    var hash = String(value == null ? "" : value).trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(hash) ? hash : "";
  }

  /** @param {*} configuration @returns {Record<string, *>} */
  function settingsFromConfiguration(configuration) {
    var source = DirtyPlugins.values.asObject(configuration);
    return {
      moveEnabled: parseBoolean(source.moveEnabled, true),
      moveRequireStashId: parseBoolean(source.moveRequireStashId, false),
      hierarchyLevels: parseLevels(source.hierarchyLevels),
      renameEnabled: parseBoolean(source.renameEnabled, false),
      renameRequireStashId: parseBoolean(source.renameRequireStashId, false),
      renamePattern: parseRenamePattern(source),
      maxFilenameLength: parseMaxFilenameLength(source.maxFilenameLength),
      multiValueSeparator: parseSeparator(source.multiValueSeparator),
      automationMode: parseAutomationMode(source.automationMode),
      approvedStrategyHash: parseApprovalHash(source.approvedStrategyHash),
      approvedPlanDigest: parseApprovalHash(source.approvedPlanDigest),
    };
  }

  window[INSTANCE_KEY] = {
    defaults: DEFAULT_SETTINGS, variables: VARIABLES,
    settingsFromConfiguration: settingsFromConfiguration,
    parseLevels: parseLevels, parseMaxFilenameLength: parseMaxFilenameLength,
    parseSeparator: parseSeparator, parseRenamePattern: parseRenamePattern,
    parseBoolean: parseBoolean
  };
})();
