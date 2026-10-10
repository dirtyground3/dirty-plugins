import { hub } from "../../DirtyPlugins/src/shared/host";
import type { Operation } from "./types";

export { React, PluginApi, hub, ui } from "../../DirtyPlugins/src/shared/host";
export const ID = "dirtyCompactor";
export const operation: Operation = (mode, args) => hub.runPluginOperation(ID, { mode, ...args });
