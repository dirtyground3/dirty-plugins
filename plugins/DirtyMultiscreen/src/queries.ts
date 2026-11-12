import { isRecord } from "./domain/context";
import { playbackSort } from "./domain/order";
import { getSceneLimit, NON_RANDOM_SCENE_SORT, normalizeSettings } from "./domain/settings";
import type {
  Hub,
  Item,
  LaunchContext,
  MarkerContext,
  QueryResult,
  QueryVariables,
  SearchCondition,
  Settings,
} from "./types";

// Play history, ratings, dates, performers and studios feed the scene orders.
const SCENE_FIELDS =
  "id title paths{stream} files{width height} sceneStreams{url mime_type label} play_count last_played_at o_counter rating100 created_at performers{id name image_path} studio{id}";
const SCENES =
  "query MultiscreenScenes($filter:FindFilterType,$scene_filter:SceneFilterType,$ids:[ID!]){findScenes(filter:$filter,scene_filter:$scene_filter,ids:$ids){count scenes{" +
  SCENE_FIELDS +
  "}}}";
const SCENE_COUNT =
  "query MultiscreenSceneCount($filter:FindFilterType,$scene_filter:SceneFilterType,$ids:[ID!]){findScenes(filter:$filter,scene_filter:$scene_filter,ids:$ids){count}}";
const SCENE_SEARCH =
  "query MultiscreenSceneSearch($filter:FindFilterType,$scene_filter:SceneFilterType,$ids:[ID!]){findScenes(filter:$filter,scene_filter:$scene_filter,ids:$ids){count scenes{" +
  SCENE_FIELDS +
  "}}}";
const MARKERS =
  "query MultiscreenMarkers($filter:FindFilterType,$scene_marker_filter:SceneMarkerFilterType,$ids:[ID!]){findSceneMarkers(filter:$filter,scene_marker_filter:$scene_marker_filter,ids:$ids){count scene_markers{id title seconds end_seconds primary_tag{name} scene{" +
  SCENE_FIELDS +
  "}}}}";
const MARKER_COUNT =
  "query MultiscreenMarkerCount($filter:FindFilterType,$scene_marker_filter:SceneMarkerFilterType,$ids:[ID!]){findSceneMarkers(filter:$filter,scene_marker_filter:$scene_marker_filter,ids:$ids){count}}";
const MARKER_SEARCH = MARKERS.replace("MultiscreenMarkers", "MultiscreenMarkerSearch");
const SCENES_WITH_PERFORMER = SCENES.replace("MultiscreenScenes", "MultiscreenPerformerScenes");
const MARKERS_WITH_PERFORMER = MARKERS.replace("MultiscreenMarkers", "MultiscreenPerformerMarkers");
const SCENE_IDS =
  "query MultiscreenSceneIds($filter:FindFilterType,$scene_filter:SceneFilterType){findScenes(filter:$filter,scene_filter:$scene_filter){scenes{id}}}";
const MARKER_IDS =
  "query MultiscreenMarkerIds($filter:FindFilterType,$scene_marker_filter:SceneMarkerFilterType){findSceneMarkers(filter:$filter,scene_marker_filter:$scene_marker_filter){scene_markers{id scene{id}}}}";
/** Library IDs per request when an ID list is matched against a condition. */
export const ID_PAGE_SIZE = 1000;
const MISSING_ID = /with id (\d+) not found/;
const EMPTY = {
  findScenes: { count: 0, scenes: [] },
  findSceneMarkers: { count: 0, scene_markers: [] },
} as unknown as QueryResult;
export const SEARCH_PAGE_SIZE = 20;
const PERFORMER_IDS =
  "query MultiscreenPerformers($filter:FindFilterType,$performer_filter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performer_filter){performers{id}}}";
const STUDIO_IDS =
  "query MultiscreenStudios($filter:FindFilterType,$studio_filter:StudioFilterType){findStudios(filter:$filter,studio_filter:$studio_filter){studios{id}}}";
const TAG_IDS =
  "query MultiscreenTags($filter:FindFilterType,$tag_filter:TagFilterType){findTags(filter:$filter,tag_filter:$tag_filter){tags{id}}}";
type Entity = "performer" | "studio" | "tag";
/** How a list of each entity resolves to IDs, and the scene criterion those IDs become. Studios and tags match only themselves. */
const RELATED: Record<
  Entity,
  { query: string; rows(data: QueryResult): { id: string }[]; criterion(ids: string[]): Record<string, unknown> }
> = {
  performer: {
    query: PERFORMER_IDS,
    rows: data => data.findPerformers.performers,
    criterion: ids => ({ performers: { value: ids, modifier: "INCLUDES" } }),
  },
  studio: {
    query: STUDIO_IDS,
    rows: data => data.findStudios.studios,
    criterion: ids => ({ studios: { value: ids, modifier: "INCLUDES", depth: 0 } }),
  },
  tag: {
    query: TAG_IDS,
    rows: data => data.findTags.tags,
    criterion: ids => ({ tags: { value: ids, modifier: "INCLUDES", depth: 0 } }),
  },
};
const INCREMENT_O = "mutation MultiscreenIncrementSceneO($id:ID!){sceneIncrementO(id:$id)}";
/** One seed per query keeps every continuation page of a random order disjoint. */
const sortFor = (settings: Settings, contextualSort: string) =>
  playbackSort(settings.sceneOrder, contextualSort, Math.floor(Math.random() * 2147483647));
// INCLUDES splits a phrase into alternative words. Escape a case-insensitive
// literal regex so filtered sessions match the same substring as local pools.
const titleMatching = (text: string) => ({
  title: { value: "(?i)" + text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), modifier: "MATCHES_REGEX" },
});
const searchText = (condition: SearchCondition) =>
  typeof condition.find?.q === "string" ? condition.find.q.trim() : "";
/** The scene sort Stash's controls chose; markers have none, since scene sorts do not apply to them. */
function chosenSort(condition: SearchCondition, marker: boolean) {
  const { sort, direction } = condition.find ?? {};
  return !marker && typeof sort === "string" && sort
    ? { sort, direction: direction === "ASC" ? "ASC" : "DESC" }
    : undefined;
}
const withCount = (data: QueryResult, marker: boolean, count: number): QueryResult =>
  marker
    ? { ...data, findSceneMarkers: { ...data.findSceneMarkers, count } }
    : { ...data, findScenes: { ...data.findScenes, count } };
type Listed = { id: string; sceneId: string };

export function createQueries(DirtyPlugins: Pick<Hub, "graphql">) {
  const graphqlRequest: Hub["graphql"] = (query, variables, options) => DirtyPlugins.graphql(query, variables, options);
  const selection = (ids: string[]): QueryVariables => ({ ids, filter: { page: 1, per_page: -1 } });
  /** Another plugin's list keeps its own order and loads one page of IDs at a time. */
  const listed = (settings: Settings, ids: string[]): QueryVariables | null =>
    ids.length ? { filter: { page: 1, per_page: getSceneLimit(settings) }, list: ids } : null;
  /** Items in the order of `ids`. Stash fails a whole request over one deleted item, so each missing ID is dropped. */
  async function findListed(marker: boolean, ids: string[], signal?: AbortSignal): Promise<QueryResult> {
    let remaining = ids;
    while (remaining.length) {
      try {
        return await graphqlRequest<QueryResult>(marker ? MARKERS : SCENES, selection(remaining), { signal });
      } catch (error) {
        const missing = MISSING_ID.exec(String(error))?.[1];
        if (!missing || !remaining.includes(missing)) throw error;
        remaining = remaining.filter(id => id !== missing);
      }
    }
    return EMPTY;
  }
  // Paging a search or stepping through a performer reuses the last scan.
  let scanned: { list: string[]; key: string; matches: Listed[] } | null = null;
  /**
   * The list's items that match a scene condition, in list order. Stash's ids argument ignores
   * filters, so the library's matching IDs are read 1,000 at a time and checked against the list.
   */
  async function matchListed(
    list: string[],
    marker: boolean,
    condition: Record<string, unknown>,
    signal: AbortSignal,
    q?: string,
    /** Results in this order instead of the list's. */
    sort?: { sort: string; direction: string },
  ) {
    const key = JSON.stringify([marker, condition, q, sort]);
    if (scanned?.list === list && scanned.key === key) return scanned.matches;
    const position = new Map(list.map((id, index) => [id, index]));
    const matches: Listed[] = [];
    for (let page = 1, found = ID_PAGE_SIZE; found === ID_PAGE_SIZE; page++) {
      const data = await graphqlRequest<QueryResult>(
        marker ? MARKER_IDS : SCENE_IDS,
        {
          filter: { page, per_page: ID_PAGE_SIZE, ...(sort ?? { sort: "id", direction: "ASC" }), ...(q ? { q } : {}) },
          ...(marker ? { scene_marker_filter: { scene_filter: condition } } : { scene_filter: condition }),
        },
        { signal },
      );
      const rows = marker
        ? data.findSceneMarkers.scene_markers.map(row => ({ id: row.id, sceneId: row.scene.id }))
        : data.findScenes.scenes.map(row => ({ id: row.id, sceneId: row.id }));
      found = rows.length;
      for (const row of rows) if (position.has(row.id)) matches.push(row);
    }
    if (!sort) matches.sort((left, right) => position.get(left.id)! - position.get(right.id)!);
    scanned = { list, key, matches };
    return matches;
  }
  /** A list is matched against the library only when something is searched, filtered or sorted. */
  async function searchList(
    list: string[],
    marker: boolean,
    condition: SearchCondition,
    page: number,
    signal: AbortSignal,
  ) {
    const q = searchText(condition),
      scene = condition.scene ?? {},
      sort = chosenSort(condition, marker);
    const matches =
      q || sort || Object.keys(scene).length
        ? (await matchListed(list, marker, scene, signal, q, sort)).map(row => row.id)
        : list;
    const shown = matches.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE);
    return withCount(await findListed(marker, shown, signal), marker, matches.length);
  }
  /** Only the performer's next item after `playing` in list order, skipping the playing scene's other markers. */
  async function nextListed(
    list: string[],
    marker: boolean,
    performerId: string,
    playing: Item | undefined,
    signal: AbortSignal,
  ) {
    const matches = await matchListed(
      list,
      marker,
      { performers: { value: [performerId], modifier: "INCLUDES" } },
      signal,
    );
    const playingId = marker ? playing?.id.replace(/^marker-/, "") : playing?.id;
    const at = matches.findIndex(row => row.id === playingId);
    for (let step = 1; step <= matches.length; step++) {
      const row = matches[(at + step) % matches.length];
      if (row.sceneId !== playing?.scene.id) return findListed(marker, [row.id], signal);
    }
    return EMPTY;
  }
  /** Keep the list's own sort and direction only for the list order. */
  function filtered(
    settings: Settings,
    filter: Record<string, unknown>,
    objectFilter: Record<string, unknown>,
    key: string,
  ): QueryVariables {
    const contextualSort = typeof filter.sort === "string" ? filter.sort : NON_RANDOM_SCENE_SORT;
    return {
      filter: { ...filter, page: 1, per_page: getSceneLimit(settings), ...sortFor(settings, contextualSort) },
      [key]: objectFilter,
    };
  }
  async function relatedSceneVariables(
    settings: Settings,
    context: LaunchContext,
    entity: Entity,
  ): Promise<QueryVariables | null> {
    const related = RELATED[entity];
    let ids: string[];
    if ("selectedIds" in context) ids = context.selectedIds;
    else if (context.source === "performer-detail") ids = [context.performerId];
    else if (context.source === "studio-detail") ids = [context.studioId];
    else if (context.source === "tag-detail") ids = [context.tagId];
    else if (
      context.source === "performer-filter" ||
      context.source === "studio-filter" ||
      context.source === "tag-filter"
    ) {
      const objectFilter =
        context.source === "performer-filter"
          ? context.performerFilter
          : context.source === "studio-filter"
            ? context.studioFilter
            : context.tagFilter;
      const data = await graphqlRequest<QueryResult>(related.query, {
        filter: { ...context.filter, page: 1, per_page: -1 },
        [entity + "_filter"]: objectFilter,
      });
      ids = related.rows(data).map(item => item.id);
    } else return null;
    if (!ids.length) return null;
    return {
      filter: { page: 1, per_page: getSceneLimit(settings), ...sortFor(settings, NON_RANDOM_SCENE_SORT) },
      scene_filter: related.criterion(ids),
    };
  }
  async function getSceneQueryVariables(
    settings: Settings,
    launchContext: LaunchContext | null,
  ): Promise<QueryVariables | null> {
    const source = launchContext?.source ?? "";
    if (launchContext?.source === "plugin-list") return listed(settings, launchContext.ids);
    if (launchContext?.source === "selection") return selection(launchContext.selectedIds);
    if (launchContext?.source === "filter")
      return filtered(settings, launchContext.filter, launchContext.sceneFilter, "scene_filter");
    if (source.startsWith("performer-")) return relatedSceneVariables(settings, launchContext!, "performer");
    if (source.startsWith("studio-")) return relatedSceneVariables(settings, launchContext!, "studio");
    if (source.startsWith("tag-")) return relatedSceneVariables(settings, launchContext!, "tag");
    return { filter: { page: 1, per_page: getSceneLimit(settings), ...sortFor(settings, NON_RANDOM_SCENE_SORT) } };
  }
  function getMarkerQueryVariables(settings: Settings, launchContext: MarkerContext): QueryVariables | null {
    if (launchContext.source === "plugin-list") return listed(settings, launchContext.ids);
    if (launchContext.source === "marker-selection") return selection(launchContext.selectedIds);
    return filtered(settings, launchContext.filter, launchContext.markerFilter, "scene_marker_filter");
  }
  /** Count without loading items: selections and announced lists are known, filters request no rows. */
  async function getLiveSceneCount(launchContext: LaunchContext) {
    if (launchContext.source === "plugin-list") return launchContext.ids.length;
    if (launchContext.source === "selection" || launchContext.source === "marker-selection")
      return launchContext.selectedIds.length;
    const marker = launchContext.source === "marker-filter";
    const variables = marker
      ? getMarkerQueryVariables(normalizeSettings({}), launchContext)
      : await getSceneQueryVariables(normalizeSettings({}), launchContext);
    if (!variables) return 0;
    const data = await graphqlRequest<QueryResult>(marker ? MARKER_COUNT : SCENE_COUNT, {
      ...variables,
      filter: { ...variables.filter, page: 1, per_page: 0 },
    });
    return marker ? data.findSceneMarkers.count : data.findScenes.count;
  }
  /** The session's own query narrowed by one more scene condition, so its scope and sort still apply. */
  const narrowed = (scope: QueryVariables, marker: boolean, condition: Record<string, unknown>) => {
    const existing = marker ? scope.scene_marker_filter?.scene_filter : scope.scene_filter;
    const sceneFilter = { ...condition, ...(existing ? { AND: existing } : {}) };
    return marker
      ? { scene_marker_filter: { ...scope.scene_marker_filter, scene_filter: sceneFilter } }
      : { scene_filter: sceneFilter };
  };
  return {
    getSceneQueryVariables,
    getMarkerQueryVariables,
    getLiveSceneCount,
    findListed,
    findScenesQuery: SCENES,
    /** The session's items that Stash's own search and filter controls choose. */
    searchSession: (
      scope: QueryVariables,
      marker: boolean,
      condition: SearchCondition,
      page: number,
      signal: AbortSignal,
    ) => {
      // Stash's ids argument bypasses filters, so a selection is matched like a list.
      const list = scope.list ?? scope.ids;
      if (list) return searchList(list, marker, condition, page, signal);
      const q = searchText(condition),
        sessionQ = typeof scope.filter.q === "string" && scope.filter.q.trim() ? scope.filter.q : "";
      // Stash keeps one search term: the session's own stays, and the searched one then matches titles.
      const scene = { ...condition.scene, ...(q && sessionQ ? titleMatching(q) : {}) };
      return graphqlRequest<QueryResult>(
        marker ? MARKER_SEARCH : SCENE_SEARCH,
        {
          ...scope,
          filter: {
            ...scope.filter,
            ...(q && !sessionQ ? { q } : {}),
            ...(chosenSort(condition, marker) ?? { sort: "title", direction: "ASC" }),
            page,
            per_page: SEARCH_PAGE_SIZE,
          },
          ...(Object.keys(scene).length ? narrowed(scope, marker, scene) : {}),
        },
        { signal },
      );
    },
    /** Find the clicked performer in the session's sort, retaining its other filters. */
    findPerformerItems: (
      scope: QueryVariables,
      marker: boolean,
      performerId: string,
      signal: AbortSignal,
      playing?: Item,
    ) => {
      if (scope.ids) throw new Error("Selected session items must be searched locally.");
      if (scope.list) return nextListed(scope.list, marker, performerId, playing, signal);
      const { performers: original, ...otherFilters } = scope.scene_filter ?? {};
      // Following another portrait replaces the positive performer criterion on a scene list.
      const replacePerformer =
        !marker && isRecord(original) && (original.modifier === "INCLUDES" || original.modifier === "INCLUDES_ALL");
      const lookup = replacePerformer
        ? { ...scope, scene_filter: Object.keys(otherFilters).length ? otherFilters : undefined }
        : scope;
      const performers = { ...(replacePerformer ? original : {}), value: [performerId], modifier: "INCLUDES" };
      return graphqlRequest<QueryResult>(
        marker ? MARKERS_WITH_PERFORMER : SCENES_WITH_PERFORMER,
        {
          ...lookup,
          filter: { ...scope.filter, page: 1, per_page: -1 },
          ...narrowed(lookup, marker, { performers }),
        },
        { signal },
      );
    },
    findSceneMarkersQuery: MARKERS,
    incrementSceneOQuery: INCREMENT_O,
  };
}
