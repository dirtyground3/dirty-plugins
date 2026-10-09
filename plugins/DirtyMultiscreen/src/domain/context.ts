import type { LaunchContext, MarkerContext } from "../types";
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};
export const isMultiscreenLaunchContext = (value: unknown): value is LaunchContext => {
  if (!isRecord(value)) return false;
  if (value.source === "selection") {
    return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id: unknown) => typeof id === "string");
  }
  if (value.source === "filter") {
    return isRecord(value.filter) && isRecord(value.sceneFilter);
  }
  if (value.source === "performer-selection") {
    return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id: unknown) => typeof id === "string");
  }
  if (value.source === "performer-filter") {
    return isRecord(value.filter) && isRecord(value.performerFilter);
  }
  if (value.source === "performer-detail") {
    return typeof value.performerId === "string";
  }
  if (value.source === "studio-selection") {
    return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id: unknown) => typeof id === "string");
  }
  if (value.source === "studio-filter") {
    return isRecord(value.filter) && isRecord(value.studioFilter);
  }
  if (value.source === "studio-detail") {
    return typeof value.studioId === "string";
  }
  if (value.source === "marker-selection") {
    return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id: unknown) => typeof id === "string");
  }
  return value.source === "marker-filter" && isRecord(value.filter) && isRecord(value.markerFilter);
};
export const isMarkerLaunchContext = (launchContext: LaunchContext | null): launchContext is MarkerContext => {
  return launchContext?.source === "marker-filter" || launchContext?.source === "marker-selection";
};
