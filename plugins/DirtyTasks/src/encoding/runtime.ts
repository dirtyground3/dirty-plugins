import { hub as sharedHub } from "../../../DirtyPlugins/src/shared/host";
import type { HubApi } from "../../../DirtyPlugins/src/types";
import { loadSettings, saveSettings } from "../settings";
import type { Operation } from "./types";

export { React, PluginApi, ui } from "../../../DirtyPlugins/src/shared/host";
export const hub: HubApi = {
  ...sharedHub,
  getPluginSettings: () => loadSettings("encoding"),
  configurePlugin: (_id, settings) => saveSettings("encoding", settings),
};
export const ID = "dirtyTasks";
export const operation: Operation = (mode, args) => hub.runPluginOperation(ID, { mode, ...args, task: "encoding" });
