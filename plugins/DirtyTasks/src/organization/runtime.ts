import { hub } from "../../../DirtyPlugins/src/shared/host";
import type { HubApi } from "../../../DirtyPlugins/src/types";
import { loadSettings, saveSettings } from "../settings";
export { React, PluginApi, ui } from "../../../DirtyPlugins/src/shared/host";
export const DirtyPlugins: HubApi = {
  ...hub,
  getPluginSettings: () => loadSettings("organization"),
  configurePlugin: (_id, settings) => saveSettings("organization", settings),
  runPluginOperation: (id, args) => hub.runPluginOperation(id, { ...args, task: "organization" }),
};
export const PLUGIN_ID = "dirtyTasks";
