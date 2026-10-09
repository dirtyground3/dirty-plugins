import type { Host, HubApi } from "../../DirtyPlugins/src/types";
/** Inject host component loaders and public hub transport; imports install no effects. */
export interface Runtime {
  DirtyPlugins: HubApi;
  PluginApi: Pick<Host, "components" | "utils" | "loadableComponents">;
  isActive?(): boolean;
}
