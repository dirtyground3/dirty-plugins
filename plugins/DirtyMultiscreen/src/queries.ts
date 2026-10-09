import type { Hub, Settings, LaunchContext, QueryVariables, QueryResult } from "./types";
import type { createSettingsDomain } from "./domain/settings";
export function createQueries(DirtyPlugins: Hub, settingsDomain: ReturnType<typeof createSettingsDomain>) {
  const { defaults: DEFAULT_SETTINGS, nonRandomSort: NON_RANDOM_SCENE_SORT, getSceneSort, getSceneLimit } = settingsDomain;
  async function relatedSceneVariables(settings: Settings, context: LaunchContext, entity: "performer" | "studio"): Promise<QueryVariables | null> {
    let ids: string[];
    if ("selectedIds" in context) ids = context.selectedIds;
    else if (context.source === "performer-detail") ids = [context.performerId];
    else if (context.source === "studio-detail") ids = [context.studioId];
    else if (context.source === "performer-filter" || context.source === "studio-filter") {
      const variables: Record<string, unknown> = { filter: { ...context.filter, page: 1, per_page: -1 } };
      if (context.source === "performer-filter") variables.performer_filter = context.performerFilter; else variables.studio_filter = context.studioFilter;
      const data = await graphqlRequest<QueryResult>(entity === "studio" ? findStudiosQuery : findPerformersQuery, variables);
      ids = (entity === "studio" ? data.findStudios.studios : data.findPerformers.performers).map(item => item.id);
    } else return null;
    if (!ids.length) return null;
    return { filter: { page: 1, per_page: -1, sort: getSceneSort(settings) }, scene_filter: { [entity === "studio" ? "studios" : "performers"]: { value: ids, modifier: "INCLUDES", ...(entity === "studio" ? { depth: 0 } : {}) } } };
  }
  const getSceneQueryVariables = async (settings: Settings, launchContext: LaunchContext | null): Promise<QueryVariables | null> => {
    if (launchContext?.source === "selection") {
      return {
        ids: launchContext.selectedIds,
        filter: {
          page: 1,
          per_page: -1
        }
      };
    }
    if (launchContext?.source === "filter") {
      const contextualSort = typeof launchContext.filter.sort === "string" ? launchContext.filter.sort : NON_RANDOM_SCENE_SORT;
      return {
        filter: {
          ...launchContext.filter,
          page: 1,
          per_page: -1,
          sort: settings.randomize ? "random" : contextualSort
        },
        scene_filter: launchContext.sceneFilter
      };
    }
    if (["performer-selection", "performer-detail", "performer-filter"].indexOf(launchContext?.source ?? "") >= 0) {
      return relatedSceneVariables(settings, launchContext!, "performer");
    }
    if (["studio-selection", "studio-detail", "studio-filter"].indexOf(launchContext?.source ?? "") >= 0) {
      return relatedSceneVariables(settings, launchContext!, "studio");
    }
    return {
      filter: {
        page: 1,
        per_page: getSceneLimit(settings),
        sort: getSceneSort(settings)
      }
    };
  };
  const getMarkerQueryVariables = (settings: Settings, launchContext: import("./types").MarkerContext): QueryVariables => {
    if (launchContext.source === "marker-selection") {
      return {
        ids: launchContext.selectedIds,
        filter: {
          page: 1,
          per_page: -1
        }
      };
    }
    const contextualSort = typeof launchContext.filter.sort === "string" ? launchContext.filter.sort : "title";
    return {
      filter: {
        ...launchContext.filter,
        page: 1,
        per_page: -1,
        sort: settings.randomize ? "random" : contextualSort
      },
      scene_marker_filter: launchContext.markerFilter
    };
  };
  const graphqlRequest = DirtyPlugins.graphql;
  const findPerformersQuery = `
  query MultiscreenPerformers(
    $filter: FindFilterType
    $performer_filter: PerformerFilterType
  ) {
    findPerformers(filter: $filter, performer_filter: $performer_filter) {
      performers {
        id
      }
    }
  }
`;
  const findStudiosQuery = `
  query MultiscreenStudios(
    $filter: FindFilterType
    $studio_filter: StudioFilterType
  ) {
    findStudios(filter: $filter, studio_filter: $studio_filter) {
      studios {
        id
      }
    }
  }
`;
  const findScenesQuery = `
  query MultiscreenScenes(
    $filter: FindFilterType
    $scene_filter: SceneFilterType
    $ids: [ID!]
  ) {
    findScenes(filter: $filter, scene_filter: $scene_filter, ids: $ids) {
      count
      scenes {
        id
        title
        paths {
          stream
        }
        sceneStreams {
          url
          mime_type
          label
        }
      }
    }
  }
`;
  const findSceneMarkersQuery = `
  query MultiscreenMarkers(
    $filter: FindFilterType
    $scene_marker_filter: SceneMarkerFilterType
    $ids: [ID!]
  ) {
    findSceneMarkers(
      filter: $filter
      scene_marker_filter: $scene_marker_filter
      ids: $ids
    ) {
      count
      scene_markers {
        id
        title
        seconds
        end_seconds
        primary_tag {
          name
        }
        scene {
          id
          title
          paths {
            stream
          }
          sceneStreams {
            url
            mime_type
            label
          }
        }
      }
    }
  }
`;
  const findSceneCountQuery = `
  query MultiscreenSceneCount(
    $filter: FindFilterType
    $scene_filter: SceneFilterType
    $ids: [ID!]
  ) {
    findScenes(filter: $filter, scene_filter: $scene_filter, ids: $ids) {
      count
    }
  }
`;
  const findSceneMarkerCountQuery = `
  query MultiscreenMarkerCount(
    $filter: FindFilterType
    $scene_marker_filter: SceneMarkerFilterType
    $ids: [ID!]
  ) {
    findSceneMarkers(
      filter: $filter
      scene_marker_filter: $scene_marker_filter
      ids: $ids
    ) {
      count
    }
  }
`;
  const incrementSceneOQuery = `
  mutation MultiscreenIncrementSceneO($id: ID!) {
    sceneIncrementO(id: $id)
  }
`;
  const getLiveSceneCount = async (launchContext: LaunchContext) => {
    if (launchContext.source === "selection" || launchContext.source === "marker-selection") {
      return launchContext.selectedIds.length;
    }
    if (launchContext.source === "marker-filter") {
      const queryVariables2 = getMarkerQueryVariables(DEFAULT_SETTINGS, launchContext);
      const data2 = await graphqlRequest<QueryResult>(
        findSceneMarkerCountQuery,
        {
          ...queryVariables2,
          filter: {
            ...queryVariables2.filter,
            page: 1,
            per_page: 0
          }
        }
      );
      return data2.findSceneMarkers.count;
    }
    const queryVariables = await getSceneQueryVariables(DEFAULT_SETTINGS, launchContext);
    if (!queryVariables) return 0;
    const data = await graphqlRequest<QueryResult>(findSceneCountQuery, {
      ...queryVariables,
      filter: {
        ...queryVariables.filter,
        page: 1,
        per_page: 0
      }
    });
    return data.findScenes.count;
  };
  return { getSceneQueryVariables, getMarkerQueryVariables, getLiveSceneCount, findScenesQuery, findSceneMarkersQuery, incrementSceneOQuery };
}
