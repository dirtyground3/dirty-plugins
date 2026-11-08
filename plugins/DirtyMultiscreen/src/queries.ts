import { playbackSort } from "./domain/order";
import { getSceneLimit, NON_RANDOM_SCENE_SORT, normalizeSettings } from "./domain/settings";
import type { Hub, LaunchContext, MarkerContext, QueryResult, QueryVariables, Settings } from "./types";

// Play history, ratings, dates, performers and studios feed the scene orders.
const SCENE_FIELDS =
  "id title paths{stream} sceneStreams{url mime_type label} play_count last_played_at o_counter rating100 created_at performers{id name image_path} studio{id}";
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

export function createQueries(DirtyPlugins: Pick<Hub, "graphql">) {
  const graphqlRequest: Hub["graphql"] = (query, variables, options) => DirtyPlugins.graphql(query, variables, options);
  const selection = (ids: string[]): QueryVariables => ({ ids, filter: { page: 1, per_page: -1 } });
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
    if (launchContext?.source === "selection") return selection(launchContext.selectedIds);
    if (launchContext?.source === "filter")
      return filtered(settings, launchContext.filter, launchContext.sceneFilter, "scene_filter");
    if (source.startsWith("performer-")) return relatedSceneVariables(settings, launchContext!, "performer");
    if (source.startsWith("studio-")) return relatedSceneVariables(settings, launchContext!, "studio");
    if (source.startsWith("tag-")) return relatedSceneVariables(settings, launchContext!, "tag");
    return { filter: { page: 1, per_page: getSceneLimit(settings), ...sortFor(settings, NON_RANDOM_SCENE_SORT) } };
  }
  function getMarkerQueryVariables(settings: Settings, launchContext: MarkerContext): QueryVariables {
    if (launchContext.source === "marker-selection") return selection(launchContext.selectedIds);
    return filtered(settings, launchContext.filter, launchContext.markerFilter, "scene_marker_filter");
  }
  /** Count without loading items: selections are known, filters request no rows. */
  async function getLiveSceneCount(launchContext: LaunchContext) {
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
    findScenesQuery: SCENES,
    searchSession: (scope: QueryVariables, marker: boolean, text: string, page: number, signal: AbortSignal) => {
      // Stash's ids argument bypasses filters; explicit selections are searched
      // from their already loaded session items instead.
      if (scope.ids) throw new Error("Selected session items must be searched locally.");
      // INCLUDES splits a phrase into alternative words. Escape a case-insensitive
      // literal regex so filtered sessions match the same substring as local pools.
      const literal = text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return graphqlRequest<QueryResult>(
        marker ? MARKER_SEARCH : SCENE_SEARCH,
        {
          ...scope,
          filter: { ...scope.filter, page, per_page: SEARCH_PAGE_SIZE, sort: "title", direction: "ASC" },
          ...narrowed(scope, marker, { title: { value: "(?i)" + literal, modifier: "MATCHES_REGEX" } }),
        },
        { signal },
      );
    },
    /** Every session item featuring the performer, in the session's sort. One performer's rows stay small. */
    findPerformerItems: (scope: QueryVariables, marker: boolean, performerId: string, signal: AbortSignal) => {
      if (scope.ids) throw new Error("Selected session items must be searched locally.");
      return graphqlRequest<QueryResult>(
        marker ? MARKERS_WITH_PERFORMER : SCENES_WITH_PERFORMER,
        {
          ...scope,
          filter: { ...scope.filter, page: 1, per_page: -1 },
          ...narrowed(scope, marker, { performers: { value: [performerId], modifier: "INCLUDES" } }),
        },
        { signal },
      );
    },
    findSceneMarkersQuery: MARKERS,
    incrementSceneOQuery: INCREMENT_O,
  };
}
