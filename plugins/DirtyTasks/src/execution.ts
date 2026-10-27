import { constants } from "@generated/dirtyTasks.settings";
import { asObject } from "../../DirtyPlugins/src/shared/values";
export type RunMode = "manual" | "scan" | "generate";
export type OrganizationAction = "move" | "rename" | "tags";
export interface ExecutionSettings extends Record<string, unknown> {
  move: RunMode;
  rename: RunMode;
  tags: RunMode;
  encoding: Record<string, RunMode>;
}
export const RUN_MODES = constants.execution.modes;
export function normalizeExecution(value: Record<string, unknown>): ExecutionSettings {
  const mode = (value: unknown): RunMode =>
    RUN_MODES.some(item => item.value === value) ? (value as RunMode) : "manual";
  return {
    move: mode(value.move),
    rename: mode(value.rename),
    tags: mode(value.tags),
    encoding: Object.fromEntries(Object.entries(asObject(value.encoding)).map(([key, value]) => [key, mode(value)])),
  };
}
