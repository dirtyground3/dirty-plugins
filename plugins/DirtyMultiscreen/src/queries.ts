import { DEFAULT_SETTINGS, getSceneLimit, getSceneSort, NON_RANDOM_SCENE_SORT } from "./domain/settings";
import type { Hub, LaunchContext, MarkerContext, QueryResult, QueryVariables, Settings } from "./types";

const SCENE_FIELDS = "id title paths{stream} sceneStreams{url mime_type label}";
const SCENES =
  "query MultiscreenScenes($filter:FindFilterType,$scene_filter:SceneFilterType,$ids:[ID!]){findScenes(filter:$filter,scene_filter:$scene_filter,ids:$ids){count scenes{" +
  SCENE_FIELDS +
  "}}}";
const SCENE_COUNT =
  "query MultiscreenSceneCount($filter:FindFilterType,$scene_filter:SceneFilterType,$ids:[ID!]){findScenes(filter:$filter,scene_filter:$scene_filter,ids:$ids){count}}";
const MARKERS =
  "query MultiscreenMarkers($filter:FindFilterType,$scene_marker_filter:SceneMarkerFilterType,$ids:[ID!]){findSceneMarkers(filter:$filter,scene_marker_filter:$scene_marker_filter,ids:$ids){count scene_markers{id title seconds end_seconds primary_tag{name} scene{" +
  SCENE_FIELDS +
  "}}}}";
const MARKER_COUNT =
  "query MultiscreenMarkerCount($filter:FindFilterType,$scene_marker_filter:SceneMarkerFilterType,$ids:[ID!]){findSceneMarkers(filter:$filter,scene_marker_filter:$scene_marker_filter,ids:$ids){count}}";
const PERFORMER_IDS =
  "query MultiscreenPerformers($filter:FindFilterType,$performer_filter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performer_filter){performers{id}}}";
const STUDIO_IDS =
  "query MultiscreenStudios($filter:FindFilterType,$studio_filter:StudioFilterType){findStudios(filter:$filter,studio_filter:$studio_filter){studios{id}}}";
const INCREMENT_O = "mutation MultiscreenIncrementSceneO($id:ID!){sceneIncrementO(id:$id)}";

export function createQueries(DirtyPlugins: Pick<Hub, "graphql">) {
  const graphqlRequest: Hub["graphql"] = (query, variables, options) => DirtyPlugins.graphql(query, variables, options);
  const selection = (ids: string[]): QueryVariables => ({ ids, filter: { page: 1, per_page: -1 } });
  /** Keep the list's own sort unless playback is randomized. */
  function filtered(
    settings: Settings,
    filter: Record<string, unknown>,
    objectFilter: Record<string, unknown>,
    key: string,
  ): QueryVariables {
    const contextualSort = typeof filter.sort === "string" ? filter.sort : NON_RANDOM_SCENE_SORT;
    return {
      filter: { ...filter, page: 1, per_page: -1, sort: settings.randomize ? "random" : contextualSort },
      [key]: objectFilter,
    };
  }
  async function relatedSceneVariables(
    settings: Settings,
    context: LaunchContext,
    entity: "performer" | "studio",
  ): Promise<QueryVariables | null> {
    let ids: string[];
    if ("selectedIds" in context) ids = context.selectedIds;
    else if (context.source === "performer-detail") ids = [context.performerId];
    else if (context.source === "studio-detail") ids = [context.studioId];
    else if (context.source === "performer-filter" || context.source === "studio-filter") {
      const variables: Record<string, unknown> = { filter: { ...context.filter, page: 1, per_page: -1 } };
      if (context.source === "performer-filter") variables.performer_filter = context.performerFilter;
      else variables.studio_filter = context.studioFilter;
      const data = await graphqlRequest<QueryResult>(entity === "studio" ? STUDIO_IDS : PERFORMER_IDS, variables);
      ids = (entity === "studio" ? data.findStudios.studios : data.findPerformers.performers).map(item => item.id);
    } else return null;
    if (!ids.length) return null;
    return {
      filter: { page: 1, per_page: -1, sort: getSceneSort(settings) },
      scene_filter: {
        [entity === "studio" ? "studios" : "performers"]: {
          value: ids,
          modifier: "INCLUDES",
          ...(entity === "studio" ? { depth: 0 } : {}),
        },
      },
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
    return { filter: { page: 1, per_page: getSceneLimit(settings), sort: getSceneSort(settings) } };
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
      ? getMarkerQueryVariables(DEFAULT_SETTINGS, launchContext)
      : await getSceneQueryVariables(DEFAULT_SETTINGS, launchContext);
    if (!variables) return 0;
    const data = await graphqlRequest<QueryResult>(marker ? MARKER_COUNT : SCENE_COUNT, {
      ...variables,
      filter: { ...variables.filter, page: 1, per_page: 0 },
    });
    return marker ? data.findSceneMarkers.count : data.findScenes.count;
  }
  return {
    getSceneQueryVariables,
    getMarkerQueryVariables,
    getLiveSceneCount,
    findScenesQuery: SCENES,
    findSceneMarkersQuery: MARKERS,
    incrementSceneOQuery: INCREMENT_O,
  };
}
