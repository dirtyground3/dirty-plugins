import { isMultiscreenLaunchContext, isRecord } from "./context";
import type { AudioState, PaneView, SavedPane, SavedSession, Settings } from "../types";

const SESSION_STORAGE_KEY = "multiscreen.session";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isAudio = (value: unknown): value is AudioState =>
  isRecord(value) && typeof value.muted === "boolean" && isFiniteNumber(value.volume);
const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
const isView = (value: unknown): value is PaneView =>
  isRecord(value) &&
  isOptionalBoolean(value.fill) &&
  isOptionalBoolean(value.loop) &&
  (value.rotation === undefined ||
    (isRecord(value.rotation) &&
      typeof value.rotation.itemId === "string" &&
      (value.rotation.turns === 1 || value.rotation.turns === 2 || value.rotation.turns === 3))) &&
  (value.flip === undefined ||
    (isRecord(value.flip) &&
      typeof value.flip.itemId === "string" &&
      typeof value.flip.x === "boolean" &&
      typeof value.flip.y === "boolean"));
const isPane = (value: unknown): value is SavedPane =>
  isRecord(value) &&
  typeof value.itemId === "string" &&
  (value.item === undefined ||
    (isRecord(value.item) && value.item.id === value.itemId && isRecord(value.item.scene))) &&
  isFiniteNumber(value.page) &&
  value.page >= 1 &&
  (value.time === undefined || (isFiniteNumber(value.time) && value.time >= 0)) &&
  (value.audio === undefined || isAudio(value.audio)) &&
  (value.view === undefined || isView(value.view));
export const isSession = (value: unknown): value is SavedSession =>
  isRecord(value) &&
  (value.context === null || isMultiscreenLaunchContext(value.context)) &&
  typeof value.queue === "string" &&
  (value.sort === undefined || typeof value.sort === "string") &&
  isFiniteNumber(value.seed) &&
  isFiniteNumber(value.now) &&
  Array.isArray(value.panes) &&
  value.panes.every(pane => pane === null || isPane(pane)) &&
  (value.order === undefined || (Array.isArray(value.order) && value.order.every(isFiniteNumber))) &&
  (value.recent === undefined || isFiniteNumber(value.recent));

/** Every screen's place in the grid: the saved places while they still hold each screen once, else the dealt order. */
export function screenOrder(saved: number[] | undefined, count: number) {
  if (
    saved &&
    saved.length === count &&
    new Set(saved).size === count &&
    saved.every(place => Number.isInteger(place) && place >= 0 && place < count)
  )
    return saved.slice();
  return Array.from({ length: count }, (_, index) => index);
}

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
