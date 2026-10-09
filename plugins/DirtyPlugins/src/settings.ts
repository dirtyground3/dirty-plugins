import type * as R from "react";
import { CONFIGURATION_CHANGED_EVENT, FIELD_ACTIONS_CHANGED_EVENT, FIELD_LIMITS, FIELD_OPTIONS, MANAGED_PLUGIN_IDS, MANAGED_PLUGIN_ID_SET, PLUGIN_DEFAULTS, PLUGIN_SETTING_ORDER, ROUTE_PATH, SETTINGS_PANELS_CHANGED_EVENT } from "./constants";
import { graphql, rememberPluginRevision, runSharedOperation } from "./transport";
import type { Drafts, FieldAction, FieldValue, PanelProps, Plugin, Setting, Snapshot } from "./types";
import { asObject } from "./values";

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
export function unregisterFieldAction(pluginId: string, settingName: string, action: FieldAction) {
  if (!fieldActions[pluginId] || fieldActions[pluginId][settingName] !== action) return;
  delete fieldActions[pluginId][settingName];
  changed(FIELD_ACTIONS_CHANGED_EVENT);
}
function register(registry: Record<string, Panel>, pluginId: string, component: Panel) {
  if (registry[pluginId] === component) return;
  registry[pluginId] = component;
  changed(SETTINGS_PANELS_CHANGED_EVENT);
}
function unregister(registry: Record<string, Panel>, pluginId: string, component: Panel) {
  if (registry[pluginId] !== component) return;
  delete registry[pluginId];
  changed(SETTINGS_PANELS_CHANGED_EVENT);
}
export const registerSettingsPanel = (pluginId: string, component: Panel) => register(settingsPanels, pluginId, component);
export const unregisterSettingsPanel = (pluginId: string, component: Panel) => unregister(settingsPanels, pluginId, component);
export const registerSettingsAddon = (pluginId: string, component: Panel) => register(settingsAddons, pluginId, component);
export const unregisterSettingsAddon = (pluginId: string, component: Panel) => unregister(settingsAddons, pluginId, component);

export function notifyConfigurationChanged(pluginId: string, options?: { preserveSettingsPage?: boolean; }) {
  window.dispatchEvent(new CustomEvent(CONFIGURATION_CHANGED_EVENT, {
    detail: { pluginId, preserveSettingsPage: Boolean(options && options.preserveSettingsPage) },
  }));
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
    label: setting.display_name || setting.name, help: setting.description,
    kind: setting.type === "BOOLEAN" ? "checkbox" : options ? "select" : setting.type === "NUMBER" ? "number" : "text",
    options, ...FIELD_LIMITS[pluginId]?.[setting.name],
  };
}

/** Managed plugins in suite order, each with its settings in authored order. */
export function loadSettingsSnapshot(): Promise<Snapshot> {
  return Promise.all([
    graphql<{ plugins: Plugin[]; }>("query DirtyPluginsSettings{plugins{id name description version enabled settings{name display_name description type}}}"),
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
        const position = (setting: Setting) => order.has(setting.name) ? order.get(setting.name)! : Number.MAX_SAFE_INTEGER;
        return { ...plugin, settings: (plugin.settings || []).slice().sort((left, right) => position(left) - position(right)) };
      });
    return { configuration: asObject(settingsPayload.settings) as Snapshot["configuration"], pluginRevisions: revisions, plugins };
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

export function serializeFieldValue(setting: Setting, value: FieldValue) {
  if (setting.type === "BOOLEAN") return Boolean(value);
  if (setting.type === "NUMBER") {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new Error((setting.display_name || setting.name) + " must be a number.");
    return numberValue;
  }
  return String(value == null ? "" : value);
}

export function standardDraftsAreDirty(snapshot: Snapshot | null, drafts: Drafts, savedDrafts: Drafts) {
  if (!snapshot) return false;
  return snapshot.plugins.some(plugin => (plugin.settings || []).some(setting => {
    try {
      return serializeFieldValue(setting, drafts[plugin.id] && drafts[plugin.id][setting.name]) !==
        serializeFieldValue(setting, savedDrafts[plugin.id] && savedDrafts[plugin.id][setting.name]);
    } catch (_error) {
      return true;
    }
  }));
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
