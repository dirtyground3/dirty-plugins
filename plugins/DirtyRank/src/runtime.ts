import type { HubApi } from "../../DirtyPlugins/src/types";
/** Inject the public hub transport; imports install no effects. */
export interface Runtime {
  DirtyPlugins: HubApi;
  isActive?(): boolean;
}
