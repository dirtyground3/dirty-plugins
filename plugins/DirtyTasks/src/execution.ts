import { constants } from "@generated/dirtyTasks.settings";
import { asObject } from "../../DirtyPlugins/src/shared/values";
export type RunMode = "manual" | "scan" | "generate" | "schedule";
export type OrganizationAction = "move" | "rename" | "tags";
export type ScheduledAction = OrganizationAction | "backup";
/** A time ("HH:MM", Stash server time) on the chosen weekdays, 0 = Monday. */
export interface Schedule {
  time: string;
  days: number[];
}
export interface ExecutionSettings extends Record<string, unknown> {
  move: RunMode;
  rename: RunMode;
  tags: RunMode;
  backup: RunMode;
  encoding: Record<string, RunMode>;
  /** Keyed by action, or "encoding:<rule id>"; kept while the action uses another trigger. */
  schedules: Record<string, Schedule>;
}
export const RUN_MODES = constants.execution.modes;
export const DEFAULT_SCHEDULE: Schedule = constants.execution.defaultSchedule;
export const WEEKDAYS = constants.execution.weekdays;
export const ACTIONS: ScheduledAction[] = ["move", "rename", "tags", "backup"];

export function normalizeSchedule(value: unknown): Schedule | null {
  const source = asObject(value);
  const time = typeof source.time === "string" ? source.time : "";
  const match = /^(\d\d):(\d\d)$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || !Array.isArray(source.days)) return null;
  const days = Array.from(
    new Set(source.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)),
  ).sort((a, b) => a - b);
  return days.length ? { time, days } : null;
}

export function normalizeExecution(value: Record<string, unknown>): ExecutionSettings {
  const mode = (value: unknown): RunMode =>
    RUN_MODES.some(item => item.value === value) ? (value as RunMode) : "manual";
  const schedules: Record<string, Schedule> = {};
  for (const [key, item] of Object.entries(asObject(value.schedules))) {
    const schedule = normalizeSchedule(item);
    if (schedule) schedules[key] = schedule;
  }
  return {
    move: mode(value.move),
    rename: mode(value.rename),
    tags: mode(value.tags),
    backup: mode(value.backup),
    encoding: Object.fromEntries(Object.entries(asObject(value.encoding)).map(([key, value]) => [key, mode(value)])),
    schedules,
  };
}

export function describeSchedule(schedule: Schedule) {
  const days =
    schedule.days.length === 7
      ? "Every day"
      : schedule.days.length === 5 && schedule.days.every(day => day < 5)
        ? "Weekdays"
        : schedule.days.map(day => WEEKDAYS[day]).join(", ");
  return days + " at " + schedule.time;
}
