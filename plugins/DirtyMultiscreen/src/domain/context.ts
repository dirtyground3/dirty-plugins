import type { LaunchContext, MarkerContext } from "../types";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const SELECTION_SOURCES = new Set(["selection", "performer-selection", "studio-selection", "marker-selection"]);
const FILTER_KEYS = new Map([
  ["filter", "sceneFilter"],
  ["performer-filter", "performerFilter"],
  ["studio-filter", "studioFilter"],
  ["marker-filter", "markerFilter"],
]);
const DETAIL_KEYS = new Map([
  ["performer-detail", "performerId"],
  ["studio-detail", "studioId"],
]);
export const isMultiscreenLaunchContext = (value: unknown): value is LaunchContext => {
  if (!isRecord(value) || typeof value.source !== "string") return false;
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
  return launchContext?.source === "marker-filter" || launchContext?.source === "marker-selection";
};
