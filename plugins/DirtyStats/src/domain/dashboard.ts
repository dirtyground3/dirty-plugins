import { hub } from "../runtime";
import type { SavedFilter } from "../runtime";
import type {
  DashboardResource,
  DashboardWidgetModel,
  SettingValue,
  StatsDefinition,
  StatsPerformer,
  StatsScene,
  WidgetOptions,
} from "../types";
import { fetchAllPages } from "./data";
import { widgetOrder, widgets } from "./registry";
export const SIZES = ["small", "medium", "large"];
export const SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" };
export const DASHBOARD_VERSION = 2;
export const MAX_WIDGETS = 24;
export const MAX_CARD_COUNT = 500;
export const FREE_COUNT = "freeCount";
const EMPTY_FILTER = { find: {}, object: {}, count: 0 };
export const DEFAULT_WIDGETS = [
  { id: "dashboard-ratings", statistic: "ratings", size: "medium", options: { rounding: 0.5 } },
  { id: "dashboard-performer-ratings", statistic: "performerRatings", size: "medium", options: { rounding: 0.5 } },
  {
    id: "dashboard-growth",
    statistic: "growth",
    size: "large",
    options: { dateBasis: "created_at", grouping: "month", showCapacity: true, showForecast: false },
  },
  { id: "dashboard-origin", statistic: "origin", size: "medium", options: { showNumbers: false } },
  { id: "dashboard-birthdays", statistic: "birthdays", size: "medium", options: { upcomingCount: 6 } },
];
export const WIDGETS = widgets,
  WIDGET_ORDER = widgetOrder;
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function allowed(values: SettingValue[], value: unknown) {
  for (let index = 0; index < values.length; index += 1)
    if (values[index] === value || String(values[index]) === String(value)) return values[index];
  return undefined;
}

export function normalizeOptions(definition: Required<StatsDefinition>, value: unknown): WidgetOptions {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const result = clone(definition.options);
  Object.keys(definition.choices).forEach(name => {
    const choice = definition.choices[name];
    let parsed;
    if (choice === FREE_COUNT) {
      const raw = source[name];
      const count = raw == null ? NaN : typeof raw === "number" ? raw : Number(String(raw).trim());
      parsed = Number.isInteger(count) && count >= 1 && count <= MAX_CARD_COUNT ? count : undefined;
    } else {
      parsed = allowed(choice as SettingValue[], source[name]);
    }
    if (parsed !== undefined) result[name] = parsed;
  });
  return result as WidgetOptions;
}

export function normalizeFilter(value: unknown) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<SavedFilter>) : EMPTY_FILTER;
  const find: Record<string, unknown> =
    source.find && typeof source.find === "object" && !Array.isArray(source.find)
      ? clone(source.find as Record<string, unknown>)
      : {};
  const object: Record<string, unknown> =
    source.object && typeof source.object === "object" && !Array.isArray(source.object)
      ? clone(source.object as Record<string, unknown>)
      : {};
  delete find.page;
  delete find.per_page;
  return { find, object, count: Math.max(0, Number(source.count) || 0) };
}

export function normalizeTitle(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

export function widgetTitle(widget: Pick<DashboardWidgetModel, "title" | "statistic">) {
  return normalizeTitle(widget.title) || WIDGETS[widget.statistic].label;
}

export function widgetHeightUnits(widget: Pick<DashboardWidgetModel, "size" | "statistic" | "options">) {
  if (widget.size === "small") return 1;
  if (widget.size === "medium") return widget.statistic === "birthdays" ? 2 : 1;
  return widget.statistic === "birthdays" ||
    (widget.statistic === "performerCards" && Number(widget.options.cardCount) > 12)
    ? 3
    : 2;
}

export function normalizeWidgets(value: unknown, useDefaults: boolean = true) {
  const source = Array.isArray(value) ? value : useDefaults === false ? [] : clone(DEFAULT_WIDGETS);
  const result: DashboardWidgetModel[] = [],
    usedIds = new Set();
  source.slice(0, MAX_WIDGETS).forEach((candidate: Partial<DashboardWidgetModel> | null) => {
    const statistic = candidate ? String(candidate.statistic || "") : "";
    if (!candidate || !WIDGETS[statistic]) return;
    let id = candidate.id == null ? "dashboard-" + statistic : String(candidate.id);
    if (!id || usedIds.has(id)) {
      let base = "dashboard-" + statistic,
        suffix = 2;
      id = base;
      while (usedIds.has(id)) {
        id = base + "-" + suffix;
        suffix += 1;
      }
    }
    usedIds.add(id);
    result.push({
      id,
      statistic,
      title: normalizeTitle(candidate.title),
      size: SIZES.indexOf(candidate.size || "") >= 0 ? candidate.size! : WIDGETS[statistic].size,
      options: normalizeOptions(WIDGETS[statistic], candidate.options),
      filter: normalizeFilter(candidate.filter),
    });
  });
  return result;
}

export function dashboardNeedsInitialSave(version: unknown, widgets: unknown) {
  return version !== DASHBOARD_VERSION || !Array.isArray(widgets);
}

export function nextWidgetId(statistic: string, widgets: DashboardWidgetModel[]) {
  const usedIds = new Set((widgets || []).map(widget => widget.id));
  let base = "dashboard-" + statistic,
    id = base,
    suffix = 2;
  while (usedIds.has(id)) {
    id = base + "-" + suffix;
    suffix += 1;
  }
  return id;
}

export function requiredGroups(widgets: DashboardWidgetModel[]) {
  return Array.from(new Set(widgets.map(widget => WIDGETS[widget.statistic].group))).sort();
}

export function resourceKey(widget: DashboardWidgetModel) {
  return (
    WIDGETS[widget.statistic].group +
    "|" +
    JSON.stringify(normalizeFilter(widget.filter)) +
    (widget.statistic === "performerCards" ? "|" + widget.options.cardCount : "")
  );
}

export function requiredResources(widgets: DashboardWidgetModel[]) {
  const resources: DashboardResource[] = [],
    used = new Set();
  widgets.forEach(widget => {
    const key = resourceKey(widget);
    if (used.has(key)) return;
    used.add(key);
    resources.push({
      key,
      group: WIDGETS[widget.statistic].group,
      filter: normalizeFilter(widget.filter),
      limit: widget.statistic === "performerCards" ? Number(widget.options.cardCount) : 0,
    });
  });
  return resources.sort((a, b) => a.key.localeCompare(b.key));
}

export function reorderWidgets(widgets: DashboardWidgetModel[], from: number, to: number) {
  if (!Array.isArray(widgets) || from === to || from < 0 || to < 0 || from >= widgets.length || to >= widgets.length)
    return widgets;
  const reordered = widgets.slice();
  const widget = reordered.splice(from, 1)[0];
  reordered.splice(to, 0, widget);
  return reordered;
}

export async function fetchPages(group: string, savedFilter: SavedFilter, signal: AbortSignal, limit: number) {
  let query: string, root: "findScenes" | "findPerformers", variables: (number: number) => Record<string, unknown>;
  if (group === "performerCards") {
    query =
      "query DirtyStatsDashboardPerformerCards($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id death_date}}}";
    root = "findPerformers";
    variables = () => ({
      filter: Object.assign({ sort: "name", direction: "ASC" }, savedFilter.find, { page: 1, per_page: limit }),
      performerFilter: savedFilter.object,
    });
  } else if (group === "performers") {
    query =
      "query DirtyStatsDashboardPerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id name country rating100 scene_count birthdate death_date image_path}}}";
    root = "findPerformers";
    variables = (number: number) => ({
      filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }),
      performerFilter: savedFilter.object,
    });
  } else if (group === "scenes") {
    query =
      "query DirtyStatsDashboardScenes($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id title rating100 play_count o_counter studio{id name image_path} files{id size duration}}}}";
    root = "findScenes";
    variables = (number: number) => ({
      filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }),
      sceneFilter: savedFilter.object,
    });
  } else if (group === "tags") {
    query =
      "query DirtyStatsDashboardTags($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100 play_count tags{id name}}}}";
    root = "findScenes";
    variables = (number: number) => ({
      filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }),
      sceneFilter: savedFilter.object,
    });
  } else if (group === "growth") {
    query =
      "query DirtyStatsDashboardGrowth($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id created_at date files{id size mod_time}}}}";
    root = "findScenes";
    variables = (number: number) => ({
      filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }),
      sceneFilter: savedFilter.object,
    });
  } else {
    query =
      "query DirtyStatsDashboardCast($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id date performers{id name gender birthdate}}}}";
    root = "findScenes";
    variables = (number: number) => ({
      filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }),
      sceneFilter: savedFilter.object,
    });
  }
  return fetchAllPages<StatsScene & StatsPerformer>({
    graphql: hub.graphql,
    query,
    variables,
    signal,
    singlePage: group === "performerCards",
    collection: response => {
      const batch = response[root]!;
      return {
        count: batch.count,
        rows: root === "findScenes" ? response.findScenes!.scenes : response.findPerformers!.performers,
      };
    },
    failureLabel: "The library changed while the dashboard was loading. Refresh to try again.",
  });
}

export function filterSummary(filter: SavedFilter, entity: string) {
  const normalized = normalizeFilter(filter);
  if (!normalized.count) return "All " + entity;
  return normalized.count + " active " + (normalized.count === 1 ? "filter" : "filters");
}
