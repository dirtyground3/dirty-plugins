import { isMultiscreenLaunchContext, parseAnnouncement } from "./domain/context";
import type { Announcement, LaunchContext, ListContext, ListSettings } from "./types";
const LAUNCH_CONTEXT_STORAGE_KEY = "multiscreen.launchContext";
/** The `source` of plugins whose lists Known plugins only accepts, lower case. */
const KNOWN_LIST_SOURCES = new Set(["cherrypick"]);
type HeldList = Announcement & { ids: string[] };
/** Each native list route, its captured context, and the launch sources it produces. */
const LISTS = new Map([
  [
    "/scenes/markers",
    { key: "marker-list", selection: "marker-selection", filter: "marker-filter", filterKey: "markerFilter" },
  ],
  ["/scenes", { key: "scene-list", selection: "selection", filter: "filter", filterKey: "sceneFilter" }],
  [
    "/performers",
    {
      key: "performer-list",
      selection: "performer-selection",
      filter: "performer-filter",
      filterKey: "performerFilter",
    },
  ],
  [
    "/studios",
    { key: "studio-list", selection: "studio-selection", filter: "studio-filter", filterKey: "studioFilter" },
  ],
  ["/tags", { key: "tag-list", selection: "tag-selection", filter: "tag-filter", filterKey: "tagFilter" }],
]);
const DETAILS = [
  {
    pattern: /^\/performers\/([^/]+)/,
    key: "performer-detail",
    context: (performerId: string): LaunchContext => ({ source: "performer-detail", performerId }),
  },
  {
    pattern: /^\/studios\/([^/]+)/,
    key: "studio-detail",
    context: (studioId: string): LaunchContext => ({ source: "studio-detail", studioId }),
  },
  {
    pattern: /^\/tags\/([^/]+)/,
    key: "tag-detail",
    context: (tagId: string): LaunchContext => ({ source: "tag-detail", tagId }),
  },
];

function unpaginated(filter: ListContext["filter"]) {
  const { page: _page, per_page: _perPage, ...unpaginatedFilter } = filter.makeFindFilter();
  return unpaginatedFilter;
}
/** Pages whose lists Multiscreen reads from Stash itself; another plugin cannot replace them. */
const readsItself = (path: string) => LISTS.has(path) || DETAILS.some(detail => detail.pattern.test(path));
const sameList = (held: HeldList, next: Announcement) =>
  held.kind === next.kind &&
  held.keepOrder === next.keepOrder &&
  held.label === next.label &&
  !!next.ids &&
  held.ids.length === next.ids.length &&
  held.ids.every((id, index) => id === next.ids![index]);

export function createContexts() {
  const timers = new Set<number>(),
    listeners = new Set<() => void>(),
    signatures = new Map<string, string>();
  const lists = new Map<string, ListContext>(),
    details = new Map<string, string>(),
    // Each plugin's latest list per path, most recent last, whatever the settings say.
    announced = new Map<string, HeldList[]>();
  let announcements = 0;
  function notifyContextChange(key: string, signature: string) {
    if (signatures.get(key) === signature) return;
    signatures.set(key, signature);
    const id = window.setTimeout(() => {
      timers.delete(id);
      listeners.forEach(listener => listener());
    }, 0);
    timers.add(id);
  }
  /** The most recent list the settings accept; when it is withdrawn, the previous one applies again. */
  function announcedList(pathname: string, settings: ListSettings): LaunchContext | null {
    if (settings.allow === "off") return null;
    const held = announced.get(pathname) ?? [];
    for (let index = held.length - 1; index >= 0; index--) {
      const { source, kind, ids, keepOrder, label } = held[index];
      if (settings.allow === "any" || KNOWN_LIST_SOURCES.has(source.toLowerCase()))
        return { source: "plugin-list", kind, ids: ids.slice(0, settings.limit), keepOrder, label };
    }
    return null;
  }
  /** Stash's own lists and pages first; elsewhere another plugin's list when `settings` are known. */
  function getLaunchContextForPath(pathname: string, settings?: ListSettings): LaunchContext | null {
    const list = LISTS.get(pathname);
    if (list) {
      const context = lists.get(list.key);
      if (!context) return null;
      const selectedIds = Array.from(context.selectedIds);
      if (selectedIds.length > 0) return { source: list.selection, selectedIds } as LaunchContext;
      return {
        source: list.filter,
        filter: unpaginated(context.filter),
        [list.filterKey]: context.filter.makeFilter(),
      } as LaunchContext;
    }
    for (const detail of DETAILS) {
      const id = pathname.match(detail.pattern)?.[1];
      if (id && id !== "new" && id === details.get(detail.key)) return detail.context(id);
    }
    return settings ? announcedList(pathname, settings) : null;
  }
  function storeLaunchContext(context: LaunchContext | null) {
    try {
      if (context) window.sessionStorage.setItem(LAUNCH_CONTEXT_STORAGE_KEY, JSON.stringify(context));
      else window.sessionStorage.removeItem(LAUNCH_CONTEXT_STORAGE_KEY);
    } catch {}
  }
  function readLaunchContext() {
    try {
      const storedContext = window.sessionStorage.getItem(LAUNCH_CONTEXT_STORAGE_KEY);
      if (!storedContext) return null;
      const parsedContext = JSON.parse(storedContext);
      return isMultiscreenLaunchContext(parsedContext) ? parsedContext : null;
    } catch {
      return null;
    }
  }
  return {
    getLaunchContextForPath,
    storeLaunchContext,
    readLaunchContext,
    subscribeToContextChanges(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    captureList(key: string, context: ListContext) {
      lists.set(key, context);
      notifyContextChange(
        key,
        JSON.stringify({
          filter: unpaginated(context.filter),
          objectFilter: context.filter.makeFilter(),
          selectedIds: Array.from(context.selectedIds),
        }),
      );
    },
    captureDetail(key: string, id: string) {
      details.set(key, id);
      notifyContextChange(key, id);
    },
    /** Keeps a `stash-scenes:context` announcement, or forgets the plugin's list when it withdraws. */
    announce(detail: unknown) {
      const next = parseAnnouncement(detail);
      if (!next || readsItself(next.path)) return;
      const held = announced.get(next.path) ?? [];
      const previous = held.find(entry => entry.source === next.source);
      if (previous ? sameList(previous, next) : !next.ids) return;
      const kept = held.filter(entry => entry !== previous);
      if (next.ids) kept.push(next as HeldList);
      if (kept.length) announced.set(next.path, kept);
      else announced.delete(next.path);
      notifyContextChange("announced", String(++announcements));
    },
  };
}
