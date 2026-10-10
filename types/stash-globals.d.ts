// Browser globals. Stash's PluginApi and the hub API are typed in plugins/DirtyPlugins/src/types.ts.
interface Window {
  __dirtyPluginsDebug?: boolean;
  dirtyPluginsDumpDebugLogs?: () => unknown[];
  PluginApi?: import("../plugins/DirtyPlugins/src/types").Host;
  DirtyPlugins?: import("../plugins/DirtyPlugins/src/types").HubApi;
}
