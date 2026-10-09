// Browser globals the hub owns. The hub API itself is typed in plugins/DirtyPlugins/src/types.ts.
interface Window {
  __dirtyPluginsDebug?: boolean;
  __dirtyCurrentPluginId?: string;
  dirtyPluginsDumpDebugLogs?: () => unknown[];
  DirtyPlugins?: import("../plugins/DirtyPlugins/src/types").HubApi;
}
