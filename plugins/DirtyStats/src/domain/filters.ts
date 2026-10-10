import { hub } from "../runtime";
import { getStatsSettingExtra } from "../settings";
import type { SavedFilter, StatsFilter } from "../runtime";
export function nativeFilterQuery(search: unknown, keepPage?: boolean) {
  const keys: Record<string, boolean> = {
    q: true,
    c: true,
    sortby: true,
    sortdir: true,
    perPage: true,
    disp: true,
    z: true,
    p: Boolean(keepPage),
  };
  // Keep Stash's original encoding, including repeated and compound criteria.
  return typeof search === "string"
    ? search
        .replace(/^\?/, "")
        .split("&")
        .filter(pair => {
          const key = pair.split("=")[0];
          return Object.prototype.hasOwnProperty.call(keys, key) && keys[key];
        })
        .join("&")
    : "";
}

export function statisticFilterSearch(statistic: string, search: string) {
  if (nativeFilterQuery(search, true)) return search;
  const saved = nativeFilterQuery(getStatsSettingExtra("statisticFilter_" + statistic, ""));
  if (!saved) return search || "";
  const extra = (search || "").replace(/^\?/, "");
  return "?" + saved + (extra ? "&" + extra : "");
}

export function restoredPerformerFilter() {
  const saved = getStatsSettingExtra<SavedFilter | null>("agePerformerFilter", null);
  if (!saved || !saved!.find || !saved!.object || (!saved!.find.q && !Object.keys(saved!.object).length)) return null;
  return {
    makeFindFilter: () => Object.assign({}, saved!.find),
    makeFilter: () => JSON.parse(JSON.stringify(saved!.object)),
    count: () => Math.max(0, (Number(saved!.count) || 0) - (saved!.find.q ? 1 : 0)),
  };
}

export function serializeDashboardFilter(filter: Partial<StatsFilter> | null) {
  const find = filter && typeof filter.makeFindFilter === "function" ? filter.makeFindFilter() : {};
  const object = filter && typeof filter.makeFilter === "function" ? filter.makeFilter() : {};
  const cleanFind = Object.assign({}, find || {});
  delete cleanFind.page;
  delete cleanFind.per_page;
  const serialized: SavedFilter = {
    find: JSON.parse(JSON.stringify(cleanFind)),
    object: JSON.parse(JSON.stringify(object || {})),
    count: filter && typeof filter.count === "function" ? filter.count() + (cleanFind.q ? 1 : 0) : cleanFind.q ? 1 : 0,
  };
  if (filter && typeof filter.makeQueryParameters === "function")
    serialized.query = nativeFilterQuery(filter.makeQueryParameters());
  return serialized;
}

export function docsCaptureEnabled(search?: string) {
  return hub.captureEnabled(search);
}
