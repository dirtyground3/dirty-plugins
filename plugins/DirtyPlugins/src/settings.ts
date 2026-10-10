import type * as R from "react";
import {
  CONFIGURATION_CHANGED_EVENT,
  FIELD_ACTIONS_CHANGED_EVENT,
  FIELD_LIMITS,
  FIELD_INTEGERS,
  FIELD_OPTIONS,
  MANAGED_PLUGIN_IDS,
  MANAGED_PLUGIN_ID_SET,
  PLUGIN_DEFAULTS,
  PLUGIN_SETTING_ORDER,
  ROUTE_PATH,
  SETTINGS_PANELS_CHANGED_EVENT,
} from "./constants";
import { graphql, rememberPluginRevision, runSharedOperation } from "./transport";
import type { Drafts, FieldAction, FieldValue, PanelProps, Plugin, Setting, Snapshot } from "./types";
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
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
}
/** Ordinary controls share authored metadata; domain editors keep their policies. */
export function fieldDefinition(pluginId: string, setting: Setting): FieldDefinition {
  const options = FIELD_OPTIONS[pluginId]?.[setting.name];
  return {
    id: "dirty-plugin-" + pluginId + "-" + setting.name,
    containerId: "plugin-" + pluginId + "-" + setting.name,
    label: setting.display_name || setting.name,
    help: setting.description,
    kind: setting.type === "BOOLEAN" ? "checkbox" : options ? "select" : setting.type === "NUMBER" ? "number" : "text",
    options,
    ...FIELD_LIMITS[pluginId]?.[setting.name],
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
    const revisions = asObject(settingsPayload.pluginRevisions) as Snapshot["pluginRevisions"];
    Object.keys(revisions).forEach(pluginId => rememberPluginRevision(pluginId, revisions[pluginId]));
    const plugins = (Array.isArray(data.plugins) ? data.plugins : [])
      .filter(plugin => MANAGED_PLUGIN_ID_SET.has(plugin.id))
      .sort((left, right) => MANAGED_PLUGIN_IDS.indexOf(left.id) - MANAGED_PLUGIN_IDS.indexOf(right.id))
      .map(plugin => {
        const order = new Map((PLUGIN_SETTING_ORDER[plugin.id] || []).map((name, index) => [name, index]));
        const position = (setting: Setting) =>
          order.has(setting.name) ? order.get(setting.name)! : Number.MAX_SAFE_INTEGER;
        return {
          ...plugin,
          settings: (plugin.settings || []).slice().sort((left, right) => position(left) - position(right)),
        };
      });
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

export function initialFieldValue(pluginId: string, setting: Setting, rawSettings: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(rawSettings, setting.name)) return rawSettings[setting.name];
  const defaults = PLUGIN_DEFAULTS[pluginId] || {};
  if (Object.prototype.hasOwnProperty.call(defaults, setting.name)) return defaults[setting.name];
  return setting.type === "BOOLEAN" ? false : "";
}

export function createDrafts(snapshot: Snapshot) {
  const drafts: Drafts = {};
  snapshot.plugins.forEach(plugin => {
    const rawSettings = asObject(snapshot.configuration[plugin.id]);
    drafts[plugin.id] = {};
    (plugin.settings || []).forEach(setting => {
      drafts[plugin.id][setting.name] = initialFieldValue(plugin.id, setting, rawSettings);
    });
  });
  return drafts;
}

export function serializeFieldValue(pluginId: string, setting: Setting, value: FieldValue) {
  if (setting.type === "BOOLEAN") return Boolean(value);
  if (setting.type === "NUMBER") {
    const label = setting.display_name || setting.name;
    const numberValue = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(numberValue)) throw new Error(label + " must be a number.");
    if (FIELD_INTEGERS[pluginId]?.has(setting.name) && !Number.isInteger(numberValue))
      throw new Error(label + " must be a whole number.");
    const limits = FIELD_LIMITS[pluginId]?.[setting.name];
    if (limits?.min !== undefined && numberValue < limits.min)
      throw new Error(label + " must be at least " + limits.min + ".");
    if (limits?.max !== undefined && numberValue > limits.max)
      throw new Error(label + " must be at most " + limits.max + ".");
    if (limits?.step !== undefined) {
      const steps = (numberValue - (limits.min ?? 0)) / limits.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8)
        throw new Error(label + " must use increments of " + limits.step + ".");
    }
    return numberValue;
  }
  return String(value == null ? "" : value);
}

export function fieldValuesEqual(pluginId: string, setting: Setting, left: FieldValue, right: FieldValue) {
  try {
    return serializeFieldValue(pluginId, setting, left) === serializeFieldValue(pluginId, setting, right);
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
      (editedFields.has(setting.name) ||
        !fieldValuesEqual(plugin.id, setting, draft[setting.name], saved?.[setting.name]))
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
      (plugin.settings || []).some(setting => {
        return !fieldValuesEqual(
          plugin.id,
          setting,
          drafts[plugin.id]?.[setting.name],
          savedDrafts[plugin.id]?.[setting.name],
        );
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
