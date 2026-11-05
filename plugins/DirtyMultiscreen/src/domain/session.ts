import { isMultiscreenLaunchContext, isRecord } from "./context";
import type { AudioState, SavedPane, SavedSession, Settings } from "../types";

const SESSION_STORAGE_KEY = "multiscreen.session";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isAudio = (value: unknown): value is AudioState =>
  isRecord(value) && typeof value.muted === "boolean" && isFiniteNumber(value.volume);
const isPane = (value: unknown): value is SavedPane =>
  isRecord(value) &&
  typeof value.itemId === "string" &&
  (value.item === undefined ||
    (isRecord(value.item) && value.item.id === value.itemId && isRecord(value.item.scene))) &&
  isFiniteNumber(value.page) &&
  value.page >= 1 &&
  (value.time === undefined || (isFiniteNumber(value.time) && value.time >= 0)) &&
  (value.audio === undefined || isAudio(value.audio));
const isSession = (value: unknown): value is SavedSession =>
  isRecord(value) &&
  (value.context === null || isMultiscreenLaunchContext(value.context)) &&
  typeof value.queue === "string" &&
  (value.sort === undefined || typeof value.sort === "string") &&
  isFiniteNumber(value.seed) &&
  isFiniteNumber(value.now) &&
  Array.isArray(value.panes) &&
  value.panes.every(pane => pane === null || isPane(pane));

/** The settings that deal the queue. Under any others a saved page and seed name different scenes. */
export const queueKey = (settings: Settings) =>
  JSON.stringify([
    settings.sceneOrder,
    settings.spreadScenes,
    settings.avoidDuplicates,
    settings.splitScenes,
    settings.totalScreens,
  ]);

export function readSession(): SavedSession | null {
  try {
    const session = JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "null");
    return isSession(session) ? session : null;
  } catch {
    return null;
  }
}
export function writeSession(session: SavedSession) {
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
