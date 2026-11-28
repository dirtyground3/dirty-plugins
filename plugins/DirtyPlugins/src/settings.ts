import type * as R from "react";
import {
  CONFIGURATION_CHANGED_EVENT,
  FIELD_ACTIONS_CHANGED_EVENT,
  MANAGED_PLUGIN_IDS,
  MANAGED_PLUGIN_ID_SET,
  ROUTE_PATH,
  SETTINGS_PANELS_CHANGED_EVENT,
} from "./constants";
import legacySettings from "./legacy-settings.json";
import { graphql, rememberPluginRevision, runSharedOperation } from "./transport";
import type {
  Drafts,
  FieldAction,
  FieldValue,
  PanelProps,
  Plugin,
  Setting,
  SettingMetadata,
  SettingsGroup,
  Snapshot,
} from "./types";
import { asObject } from "./shared/values";

type Panel = R.ComponentType<PanelProps>;
/** Plugin-registered settings extensions; the settings page rerenders on change events. */
export const fieldActions: Record<string, Record<string, FieldAction>> = Object.create(null);
export const settingsPanels: Record<string, Panel> = Object.create(null);
export const settingsAddons: Record<string, Panel> = Object.create(null);

function changed(eventName: string) {
  window.dispatchEvent(new CustomEvent(eventName));
}
export function registerFieldAction(pluginId: string, settingName: string, action: FieldAction) {
  if (!fieldActions[pluginId]) fieldActions[pluginId] = Object.create(null);
  if (fieldActions[pluginId][settingName] === action) return;
  fieldActions[pluginId][settingName] = action;
  changed(FIELD_ACTIONS_CHANGED_EVENT);
}
function register(registry: Record<string, Panel>, pluginId: string, component: Panel) {
  if (registry[pluginId] === component) return;
  registry[pluginId] = component;
  changed(SETTINGS_PANELS_CHANGED_EVENT);
}
export const registerSettingsPanel = (pluginId: string, component: Panel) =>
  register(settingsPanels, pluginId, component);
export const registerSettingsAddon = (pluginId: string, component: Panel) =>
  register(settingsAddons, pluginId, component);

export function notifyConfigurationChanged(pluginId: string, options?: { preserveSettingsPage?: boolean }) {
  window.dispatchEvent(
    new CustomEvent(CONFIGURATION_CHANGED_EVENT, {
      detail: { pluginId, preserveSettingsPage: Boolean(options && options.preserveSettingsPage) },
    }),
  );
}

export interface FieldDefinition {
  id: string;
  containerId: string;
  label: string;
  help?: string;
  kind: "checkbox" | "select" | "number" | "text";
  options?: SettingMetadata["options"];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}
/** Ordinary controls share authored metadata; domain editors keep their policies. */
export function fieldDefinition(pluginId: string, setting: Setting): FieldDefinition {
  const { options, min, max, step, placeholder } = setting.metadata ?? {};
  return {
    id: "dirty-plugin-" + pluginId + "-" + setting.name,
    containerId: "plugin-" + pluginId + "-" + setting.name,
    label: setting.display_name || setting.name,
    help: setting.description,
    kind: setting.type === "BOOLEAN" ? "checkbox" : options ? "select" : setting.type === "NUMBER" ? "number" : "text",
    options,
    min,
    max,
    step,
    placeholder,
  };
}

interface SettingsMetadata {
  settings: Record<string, SettingMetadata>;
  sections: SettingsGroup[];
}
// Frozen metadata from before packages supplied their own definitions.
const legacyDefinitions: Record<string, SettingsMetadata & { version: string }> = legacySettings;
const releaseVersion = /^(\d+)\.(\d+)\.(\d+)(-rc)?$/;

function legacyDefinition(plugin: Plugin) {
  const definition = legacyDefinitions[plugin.id];
  const installed = plugin.version?.match(releaseVersion);
  if (!definition || !installed) return undefined;
  const latest = definition.version.match(releaseVersion)!;
  const comparison =
    Number(installed[1]) - Number(latest[1]) ||
    Number(installed[2]) - Number(latest[2]) ||
    Number(installed[3]) - Number(latest[3]) ||
    Number(!!latest[4]) - Number(!!installed[4]);
  return comparison <= 0 ? definition : undefined;
}

/** Older manifests still use their previous form metadata. A matching package definition takes precedence. */
function withSettingsDefinition(plugin: Plugin, value: unknown): Plugin {
  const reported = plugin.settings ?? [];
  if (!reported.length) return plugin;
  const definition = asObject(value);
  const settings = asObject(definition.settings) as Record<string, SettingMetadata>;
  const installed =
    definition.formatVersion === 1 &&
    definition.pluginId === plugin.id &&
    typeof definition.version === "string" &&
    definition.version === plugin.version &&
    reported.every(setting => settings[setting.name]?.type === setting.type) &&
    Array.isArray(definition.sections)
      ? { settings, sections: definition.sections as SettingsGroup[] }
      : legacyDefinition(plugin);
  if (!installed) return { ...plugin, settingsUnavailable: true };
  const order = new Map(Object.keys(installed.settings).map((name, index) => [name, index]));
  const position = (setting: Setting) => order.get(setting.name) ?? Number.MAX_SAFE_INTEGER;
  return {
    ...plugin,
    settings: reported
      .slice()
      .sort((left, right) => position(left) - position(right))
      .map(setting => {
        const metadata = installed.settings[setting.name];
        return metadata?.type === setting.type ? { ...setting, metadata } : setting;
      }),
    settingsSections: installed.sections,
  };
}

/** Managed plugins in suite order, each with its settings in authored order. */
export function loadSettingsSnapshot(): Promise<Snapshot> {
  return Promise.all([
    graphql<{ plugins: Plugin[] }>(
      "query DirtyPluginsSettings{plugins{id name description version enabled settings{name display_name description type}}}",
    ),
    runSharedOperation({ mode: "getAllSettings" }),
  ]).then(([data, payload]) => {
    const settingsPayload = asObject(payload);
    const definitions = asObject(settingsPayload.settingsDefinitions);
    const revisions = asObject(settingsPayload.pluginRevisions) as Snapshot["pluginRevisions"];
    Object.keys(revisions).forEach(pluginId => rememberPluginRevision(pluginId, revisions[pluginId]));
    const plugins = (Array.isArray(data.plugins) ? data.plugins : [])
      .filter(plugin => MANAGED_PLUGIN_ID_SET.has(plugin.id))
      .sort((left, right) => MANAGED_PLUGIN_IDS.indexOf(left.id) - MANAGED_PLUGIN_IDS.indexOf(right.id))
      .map(plugin => withSettingsDefinition(plugin, definitions[plugin.id]));
    return {
      configuration: asObject(settingsPayload.settings) as Snapshot["configuration"],
      pluginRevisions: revisions,
      plugins,
    };
  });
}

/** Configuration events already identify the plugin; keep the other settings and metadata untouched. */
export function loadPluginConfiguration(pluginId: string) {
  return runSharedOperation<{ settings: Record<string, unknown>; revision: number }>({
    mode: "getSettings",
    pluginId,
  }).then(payload => {
    rememberPluginRevision(pluginId, payload.revision);
    return { settings: asObject(payload.settings), revision: payload.revision };
  });
}

/** The schema default; a setting without one starts empty (or unchecked). */
export function defaultFieldValue(setting: Setting) {
  if (setting.metadata && Object.prototype.hasOwnProperty.call(setting.metadata, "default"))
    return setting.metadata.default;
  return setting.type === "BOOLEAN" ? false : "";
}

export function initialFieldValue(setting: Setting, rawSettings: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(rawSettings, setting.name)) return rawSettings[setting.name];
  return defaultFieldValue(setting);
}

export function createDrafts(snapshot: Snapshot) {
  const drafts: Drafts = {};
  snapshot.plugins.forEach(plugin => {
    const rawSettings = asObject(snapshot.configuration[plugin.id]);
    drafts[plugin.id] = {};
    (plugin.settings || []).forEach(setting => {
      drafts[plugin.id][setting.name] = initialFieldValue(setting, rawSettings);
    });
  });
  return drafts;
}

/** Null clears a number that may stay empty, so the plugin applies its own fallback. */
export function serializeFieldValue(setting: Setting, value: FieldValue) {
  if (setting.type === "BOOLEAN") return Boolean(value);
  if (setting.type === "NUMBER") {
    const { placeholder, integer, min, max, step } = setting.metadata ?? {};
    if (placeholder && !String(value ?? "").trim()) return null;
    const label = setting.display_name || setting.name;
    const numberValue = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(numberValue)) throw new Error(label + " must be a number.");
    if (integer && !Number.isInteger(numberValue)) throw new Error(label + " must be a whole number.");
    if (min !== undefined && numberValue < min) throw new Error(label + " must be at least " + min + ".");
    if (max !== undefined && numberValue > max) throw new Error(label + " must be at most " + max + ".");
    if (step !== undefined) {
      const steps = (numberValue - (min ?? 0)) / step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8) throw new Error(label + " must use increments of " + step + ".");
    }
    return numberValue;
  }
  return String(value == null ? "" : value);
}

export function fieldValuesEqual(setting: Setting, left: FieldValue, right: FieldValue) {
  // A value saved by an older definition can be out of range under the current one.
  if (Object.is(left, right)) return true;
  try {
    return serializeFieldValue(setting, left) === serializeFieldValue(setting, right);
  } catch (_error) {
    return false;
  }
}

/** Refresh clean fields while retaining raw edits, including invalid values. */
export function mergePluginDraft(
  plugin: Plugin,
  draft: Record<string, FieldValue> | undefined,
  saved: Record<string, FieldValue> | undefined,
  incoming: Record<string, FieldValue>,
  editedFields: ReadonlySet<string>,
) {
  const next = { ...incoming };
  (plugin.settings || []).forEach(setting => {
    if (
      draft &&
      (editedFields.has(setting.name) || !fieldValuesEqual(setting, draft[setting.name], saved?.[setting.name]))
    )
      next[setting.name] = draft[setting.name];
  });
  return next;
}

export function standardDraftsAreDirty(snapshot: Snapshot | null, drafts: Drafts, savedDrafts: Drafts) {
  if (!snapshot) return false;
  return snapshot.plugins.some(
    plugin =>
      !settingsPanels[plugin.id] &&
      !plugin.settingsUnavailable &&
      (plugin.settings || []).some(setting => {
        return !fieldValuesEqual(setting, drafts[plugin.id]?.[setting.name], savedDrafts[plugin.id]?.[setting.name]);
      }),
  );
}

export function getFieldAction(pluginId: string, settingName: string) {
  return fieldActions[pluginId] && fieldActions[pluginId][settingName];
}

export function settingsRoute(pluginId: string) {
  if (!MANAGED_PLUGIN_ID_SET.has(pluginId)) return ROUTE_PATH;
  return ROUTE_PATH + "?plugin=" + encodeURIComponent(pluginId);
}

export function requestedPluginId() {
  try {
    return new URLSearchParams(window.location.search).get("plugin");
  } catch (_error) {
    return null;
  }
}
