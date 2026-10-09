import type { AutomationMode, Settings, Variable } from "../types";
export const DEFAULT_SETTINGS: Settings = {
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
// [token, label, menu group]. Order within a group is the menu order.
export const VARIABLES: Variable[] = [
  ["title", "Title", "Scene"],
  ["scene_id", "Scene ID", "Scene"],
  ["stash_id", "Stash ID", "Scene"],
  ["date", "Date", "Date"],
  ["year", "Year", "Date"],
  ["month", "Month", "Date"],
  ["day", "Day", "Date"],
  ["rating", "Rating", "Rating"],
  ["grade", "Grade (A–F)", "Rating"],
  ["rating_bucket", "Rating bucket", "Rating"],
  ["organized", "Organized", "Scene"],
  ["studio", "Studio", "Studio"],
  ["parent_studio", "Parent studio", "Studio"],
  ["performers", "Performers", "Performers"],
  ["first_performer", "First performer", "Performers"],
  ["female_performers", "Female performers", "Performers"],
  ["male_performers", "Male performers", "Performers"],
  ["first_female_performer", "First female performer", "Performers"],
  ["first_male_performer", "First male performer", "Performers"],
  ["performer_count", "Performer count", "Performers"],
  ["tags", "Tags", "Tags and groups"],
  ["first_tag", "First tag", "Tags and groups"],
  ["group", "Group", "Tags and groups"],
  ["group_position", "Group position", "Tags and groups"],
  ["resolution", "Resolution", "Video"],
  ["height", "Height", "Video"],
  ["video_codec", "Video codec", "Video"],
  ["duration", "Duration (minutes)", "Video"],
  ["duration_bucket", "Duration bucket", "Video"],
  ["source", "Source", "Scene"],
  ["original_name", "Original name", "Scene"],
  ["extension", "Extension", "Scene"],
];

// The Python backend's normalize_settings() is the single source of truth.
// These helpers mirror it exactly so a saved draft always hashes to the same
// strategy the server planned with, and so a stale preview cannot be caused
// by the two sides defaulting differently.
/** @param {*} value @returns {string[]} */
export function parseLevels(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.hierarchyLevels.slice();
  // An explicit all-empty list stays empty rather than reverting to the
  // defaults the server would never plan with.
  return value.map(function (item: unknown) { return typeof item === "string" ? item.trim() : ""; }).filter(Boolean);
}

/** @param {*} value @returns {number} */
export function parseMaxFilenameLength(value: unknown): number {
  var number;
  if (typeof value === "number" && Number.isFinite(value)) number = Math.trunc(value);
  else if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) number = parseInt(value.trim(), 10);
  else return DEFAULT_SETTINGS.maxFilenameLength;
  return Math.max(16, Math.min(255, number));
}

export function parseSeparator(value: unknown): string {
  var separator = value == null ? DEFAULT_SETTINGS.multiValueSeparator : String(value);
  if (!separator) separator = DEFAULT_SETTINGS.multiValueSeparator;
  return separator.slice(0, 10);
}

export function parseRenamePattern(source: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(source, "renamePattern")) {
    return DEFAULT_SETTINGS.renamePattern;
  }
  return source.renamePattern ? String(source.renamePattern).trim() : "";
}

/** @param {*} value @param {boolean} fallback @returns {boolean} */
export function parseBoolean(value: unknown, fallback: boolean): boolean {
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

export function parseAutomationMode(value: unknown): AutomationMode {
  var mode = String(value == null ? "" : value).trim().toLowerCase();
  return ["manual", "scan", "generate"].indexOf(mode) >= 0 ? mode as AutomationMode : "manual";
}

export function parseApprovalHash(value: unknown): string {
  var hash = String(value == null ? "" : value).trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : "";
}

/** @param {*} configuration @returns {Record<string, *>} */
export function settingsFromConfiguration(configuration: unknown): Settings {
  // Narrow the input shape; scalar/array configurations use the same empty fallback.
  const source = configuration && typeof configuration === "object" && !Array.isArray(configuration) ? configuration as Record<string, unknown> : {};
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

