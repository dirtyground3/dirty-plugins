import type { Announcement, LaunchContext, MarkerContext } from "../types";
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const SELECTION_SOURCES = new Set([
  "selection",
  "performer-selection",
  "studio-selection",
  "tag-selection",
  "marker-selection",
]);
const FILTER_KEYS = new Map([
  ["filter", "sceneFilter"],
  ["performer-filter", "performerFilter"],
  ["studio-filter", "studioFilter"],
  ["tag-filter", "tagFilter"],
  ["marker-filter", "markerFilter"],
]);
const DETAIL_KEYS = new Map([
  ["performer-detail", "performerId"],
  ["studio-detail", "studioId"],
  ["tag-detail", "tagId"],
]);
/** The highest List size limit: lists are kept whole up to it, so a raised limit applies to lists already held. */
export const MAX_LIST_IDS = 100000;
const MAX_LABEL = 80;
const STASH_ID = /^[0-9]+$/;
const isKind = (value: unknown) => value === "scenes" || value === "markers";
const isIdList = (value: unknown, pattern = /(?:)/): value is string[] =>
  Array.isArray(value) && value.every(id => typeof id === "string" && pattern.test(id));
export const isMultiscreenLaunchContext = (value: unknown): value is LaunchContext => {
  if (!isRecord(value) || typeof value.source !== "string") return false;
  if (value.source === "plugin-list")
    return (
      isKind(value.kind) &&
      isIdList(value.ids) &&
      typeof value.keepOrder === "boolean" &&
      typeof value.label === "string"
    );
  if (SELECTION_SOURCES.has(value.source)) {
    return (
      Array.isArray(value.selectedIds) &&
      value.selectedIds.length > 0 &&
      value.selectedIds.every((id: unknown) => typeof id === "string")
    );
  }
  const filterKey = FILTER_KEYS.get(value.source);
  if (filterKey) return isRecord(value.filter) && isRecord(value[filterKey]);
  const detailKey = DETAIL_KEYS.get(value.source);
  return !!detailKey && typeof value[detailKey] === "string";
};
export const isMarkerLaunchContext = (launchContext: LaunchContext | null): launchContext is MarkerContext => {
  return (
    launchContext?.source === "marker-filter" ||
    launchContext?.source === "marker-selection" ||
    (launchContext?.source === "plugin-list" && launchContext.kind === "markers")
  );
};
/**
 * A `stash-scenes:context` event's detail, or null when any field is malformed. Unknown fields are
 * ignored, a duplicate ID keeps its first position and lists stop at the highest List size limit.
 */
export function parseAnnouncement(detail: unknown): Announcement | null {
  if (!isRecord(detail) || detail.version !== 1) return null;
  const { source, path, kind, ids, keepOrder, label } = detail;
  if (typeof source !== "string" || !source.trim() || typeof path !== "string" || !path.startsWith("/")) return null;
  if (!isKind(kind) || (ids !== null && !isIdList(ids, STASH_ID))) return null;
  if ((keepOrder !== undefined && typeof keepOrder !== "boolean") || (label !== undefined && typeof label !== "string"))
    return null;
  return {
    source: source.trim(),
    path,
    kind: kind as Announcement["kind"],
    ids: ids && Array.from(new Set(ids)).slice(0, MAX_LIST_IDS),
    keepOrder: keepOrder === true,
    label: (label ?? "").trim().slice(0, MAX_LABEL),
  };
}
