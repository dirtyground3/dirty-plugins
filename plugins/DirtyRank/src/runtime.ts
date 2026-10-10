import { hub, PluginApi } from "../../DirtyPlugins/src/shared/host";

export { React, PluginApi, hub as DirtyPlugins, ui } from "../../DirtyPlugins/src/shared/host";
/** Stash's React Router; components read its members when they render. */
export const Router = PluginApi?.libraries?.ReactRouterDOM;

export function documentationCapture() {
  return hub.captureEnabled(window.location.search);
}
