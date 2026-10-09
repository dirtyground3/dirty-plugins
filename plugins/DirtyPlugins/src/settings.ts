import { FIELD_LIMITS, FIELD_OPTIONS, MANAGED_PLUGIN_IDS, MANAGED_PLUGIN_ID_SET, PLUGIN_DEFAULTS, PLUGIN_SETTING_ORDER, ROUTE_PATH } from "./constants";
import { fieldActions, transport } from "./runtime";
import type { Drafts, FieldValue, Plugin, Setting, Snapshot } from "./types";
import { asObject } from "./values";
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
export function loadSettingsSnapshot(): Promise<Snapshot> {
  return Promise.all([transport.graphql<{ plugins: Plugin[]; }>(
    "query DirtyPluginsSettings{" +
    "plugins{id name description version enabled " +
    "settings{name display_name description type}}" +
    "}"
  ), transport.runSharedOperation({ mode: "getAllSettings" })]).then(function(values) {
    var data = values[0];
    var settingsPayload = asObject(values[1]);
    var configuration = asObject(settingsPayload.settings) as Snapshot["configuration"];
    var revisions = asObject(settingsPayload.pluginRevisions) as Snapshot["pluginRevisions"];
    Object.keys(revisions).forEach(function(pluginId) {
      transport.rememberPluginRevision(pluginId, revisions[pluginId]);
    });
    var plugins = Array.isArray(data.plugins) ? data.plugins : [];
    return {
      configuration: configuration,
      pluginRevisions: revisions,
      plugins: plugins
        .filter(function(plugin) {
          return MANAGED_PLUGIN_ID_SET.has(plugin.id);
        })
        .sort(function(left, right) {
          return MANAGED_PLUGIN_IDS.indexOf(left.id) - MANAGED_PLUGIN_IDS.indexOf(right.id);
        })
        .map(function(plugin) {
          var order = PLUGIN_SETTING_ORDER[plugin.id] || [];
          var orderIndex = new Map(order.map(function(name, index) {
            return [name, index];
          }));
          return Object.assign({}, plugin, {
            settings: (plugin.settings || []).slice().sort(function(left, right) {
              var leftIndex = orderIndex.has(left.name)
                ? orderIndex.get(left.name)!
                : Number.MAX_SAFE_INTEGER;
              var rightIndex = orderIndex.has(right.name)
                ? orderIndex.get(right.name)!
                : Number.MAX_SAFE_INTEGER;
              return leftIndex - rightIndex;
            }),
          });
        }),
    };
  });
}

export function initialFieldValue(pluginId: string, setting: Setting, rawSettings: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(rawSettings, setting.name)) {
    return rawSettings[setting.name];
  }
  var defaults = PLUGIN_DEFAULTS[pluginId] || {};
  if (Object.prototype.hasOwnProperty.call(defaults, setting.name)) {
    return defaults[setting.name];
  }
  if (setting.type === "BOOLEAN") return false;
  return "";
}

export function createDrafts(snapshot: Snapshot) {
  var drafts: Drafts = {};
  snapshot.plugins.forEach(function(plugin) {
    var rawSettings = asObject(snapshot.configuration[plugin.id]);
    drafts[plugin.id] = {};
    (plugin.settings || []).forEach(function(setting) {
      drafts[plugin.id][setting.name] = initialFieldValue(
        plugin.id,
        setting,
        rawSettings
      );
    });
  });
  return drafts;
}

export function serializeFieldValue(setting: Setting, value: FieldValue) {
  if (setting.type === "BOOLEAN") return Boolean(value);
  if (setting.type === "NUMBER") {
    var numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      throw new Error((setting.display_name || setting.name) + " must be a number.");
    }
    return numberValue;
  }
  return String(value == null ? "" : value);
}

export function standardDraftsAreDirty(snapshot: Snapshot | null, drafts: Drafts, savedDrafts: Drafts) {
  if (!snapshot) return false;
  return snapshot.plugins.some(function(plugin) {
    return (plugin.settings || []).some(function(setting) {
      try {
        return serializeFieldValue(
          setting,
          drafts[plugin.id] && drafts[plugin.id][setting.name]
        ) !== serializeFieldValue(
          setting,
          savedDrafts[plugin.id] && savedDrafts[plugin.id][setting.name]
        );
      } catch (_error) {
        return true;
      }
    });
  });
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
