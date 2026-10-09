import type { SavedFilter, StatsFilter } from "../runtime";
import type { Settings } from "../settings";
export function createFilters(dependencies: Settings & Pick<import("../runtime").Runtime, "hub">) {
  const { getStatsSettingExtra, hub } = dependencies;
  function nativeFilterQuery(search: unknown, keepPage?: boolean) {
    var keys: Record<string, boolean> = { q: true, c: true, sortby: true, sortdir: true, perPage: true, disp: true, z: true, p: Boolean(keepPage) };
    // Keep Stash's original encoding, including repeated and compound criteria.
    return typeof search === "string" ? search.replace(/^\?/, "").split("&").filter(function (pair) {
      var key = pair.split("=")[0];
      return Object.prototype.hasOwnProperty.call(keys, key) && keys[key];
    }).join("&") : "";
  }

  function statisticFilterSearch(statistic: string, search: string) {
    if (nativeFilterQuery(search, true)) return search;
    var saved = nativeFilterQuery(getStatsSettingExtra("statisticFilter_" + statistic, ""));
    if (!saved) return search || "";
    var extra = (search || "").replace(/^\?/, "");
    return "?" + saved + (extra ? "&" + extra : "");
  }

  function restoredPerformerFilter() {
    var saved = getStatsSettingExtra<SavedFilter | null>("agePerformerFilter", null);
    if (!saved || !saved!.find || !saved!.object || (!saved!.find.q && !Object.keys(saved!.object).length)) return null;
    return {
      makeFindFilter: function () { return Object.assign({}, saved!.find); },
      makeFilter: function () { return JSON.parse(JSON.stringify(saved!.object)); },
      count: function () { return Math.max(0, (Number(saved!.count) || 0) - (saved!.find.q ? 1 : 0)); }
    };
  }

  function serializeDashboardFilter(filter: Partial<StatsFilter> | null) {
    var find = filter && typeof filter.makeFindFilter === "function" ? filter.makeFindFilter() : {};
    var object = filter && typeof filter.makeFilter === "function" ? filter.makeFilter() : {};
    var cleanFind = Object.assign({}, find || {});
    delete cleanFind.page;
    delete cleanFind.per_page;
    var serialized: SavedFilter = {
      find: JSON.parse(JSON.stringify(cleanFind)),
      object: JSON.parse(JSON.stringify(object || {})),
      count: filter && typeof filter.count === "function" ? filter.count() + (cleanFind.q ? 1 : 0) : (cleanFind.q ? 1 : 0)
    };
    if (filter && typeof filter.makeQueryParameters === "function") serialized.query = nativeFilterQuery(filter.makeQueryParameters());
    return serialized;
  }

  function docsCaptureEnabled(search?: string) {
    if (hub.captureEnabled) return hub.captureEnabled(search);
    try { return new URLSearchParams(search || "").get("docsCapture") === "1"; } catch (err) { return false; }
  }
  return { nativeFilterQuery, statisticFilterSearch, restoredPerformerFilter, serializeDashboardFilter, docsCaptureEnabled };
}
export type Filters = ReturnType<typeof createFilters>;
