import { hub } from "../../DirtyPlugins/src/shared/host";
import { createContexts } from "./contexts";
import { createCounts } from "./counts";
import { createQueries } from "./queries";

export { React, PluginApi, hub as DirtyPlugins } from "../../DirtyPlugins/src/shared/host";
export const PLUGIN_ID = "multiscreen";
export const contexts = createContexts();
export const queries = createQueries(hub);
export const counts = createCounts();
