import { isMultiscreenLaunchContext, isRecord } from "./context";
import { isCustomLayout } from "./custom";
import type { AudioState, GridSize, PaneView, SavedPane, SavedSession, Settings } from "../types";

const SESSION_STORAGE_KEY = "multiscreen.session";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isAudio = (value: unknown): value is AudioState =>
  isRecord(value) && typeof value.muted === "boolean" && isFiniteNumber(value.volume);
const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === "boolean";
const isPercent = (value: unknown) => isFiniteNumber(value) && value >= 0 && value <= 100;
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
      typeof value.flip.y === "boolean")) &&
  (value.crop === undefined ||
    (isRecord(value.crop) &&
      typeof value.crop.itemId === "string" &&
      isPercent(value.crop.x) &&
      isPercent(value.crop.y)));
const isGridSize = (value: unknown): value is GridSize =>
  isRecord(value) &&
  Number.isInteger(value.rows) &&
  Number.isInteger(value.columns) &&
  (value.rows as number) > 0 &&
  (value.columns as number) > 0;
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
  (value.closed === undefined || (Array.isArray(value.closed) && value.closed.every(isFiniteNumber))) &&
  (value.layout === undefined || isCustomLayout(value.layout)) &&
  (value.deal === undefined || isGridSize(value.deal)) &&
  (value.recent === undefined || isFiniteNumber(value.recent));

/** The closed screens that exist among `count`, once each and in the order they closed. One screen stays open. */
export function closedScreens(saved: readonly number[] | undefined, count: number) {
  const closed = Array.from(new Set(saved ?? [])).filter(
    index => Number.isInteger(index) && index >= 0 && index < count,
  );
  return closed.length < count ? closed : [];
}

/**
 * Every screen's place in the grid: the saved places while they still hold each screen once, else the dealt order.
 * Screens added to a grown grid take the new places after them.
 */
export function screenOrder(saved: number[] | undefined, count: number) {
  const known = saved?.length ?? 0;
  const kept =
    saved &&
    known <= count &&
    new Set(saved).size === known &&
    saved.every(place => Number.isInteger(place) && place >= 0 && place < known);
  return kept
    ? [...saved, ...Array.from({ length: count - known }, (_, index) => known + index)]
    : Array.from({ length: count }, (_, index) => index);
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
