import { constants } from "@generated/dirtyTidy.settings";
import type { AutomationMode, Settings, Variable } from "../types";
// Defaults and the variable menu are generated from schemas/dirtyTidy.settings.json,
// which the Python backend reads as well.
export const DEFAULT_SETTINGS = constants.defaultSettings as Settings;
// [token, label, menu group]. Order within a group is the menu order.
export const VARIABLES = constants.variables as unknown as Variable[];

// The Python backend's normalize_settings() is the single source of truth.
// These helpers mirror it exactly so a saved draft always hashes to the same
// strategy the server planned with, and so a stale preview cannot be caused
// by the two sides defaulting differently.
/** @param {*} value @returns {string[]} */
export function parseLevels(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.hierarchyLevels.slice();
  // An explicit all-empty list stays empty rather than reverting to the
  // defaults the server would never plan with.
  return value.map((item: unknown) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

/** @param {*} value @returns {number} */
export function parseMaxFilenameLength(value: unknown): number {
  let number;
  if (typeof value === "number" && Number.isFinite(value)) number = Math.trunc(value);
  else if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) number = parseInt(value.trim(), 10);
  else return DEFAULT_SETTINGS.maxFilenameLength;
  return Math.max(16, Math.min(255, number));
}

export function parseSeparator(value: unknown): string {
  let separator = value == null ? DEFAULT_SETTINGS.multiValueSeparator : String(value);
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
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    return Boolean(value);
  }
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

export function parseAutomationMode(value: unknown): AutomationMode {
  const mode = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  return ["manual", "scan", "generate"].indexOf(mode) >= 0 ? (mode as AutomationMode) : "manual";
}

export function parseApprovalHash(value: unknown): string {
  const hash = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : "";
}

/** @param {*} configuration @returns {Record<string, *>} */
export function settingsFromConfiguration(configuration: unknown): Settings {
  // Narrow the input shape; scalar/array configurations use the same empty fallback.
  const source =
    configuration && typeof configuration === "object" && !Array.isArray(configuration)
      ? (configuration as Record<string, unknown>)
      : {};
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
