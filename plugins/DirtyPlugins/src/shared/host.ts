// Compiled into every plugin bundle. The hub loads first (each manifest's ui.requires),
// validates Stash's PluginApi and publishes window.DirtyPlugins; plugins only read them.
import type { Host, HubApi } from "../types";

export const PluginApi = window.PluginApi as Host;
export const hub = window.DirtyPlugins as HubApi;
export const React = PluginApi?.React;
export const ui = hub?.react;
