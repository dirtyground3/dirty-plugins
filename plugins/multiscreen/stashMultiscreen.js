(() => {
  // plugins/stash-multiscreen/src/stashReactShim.ts
  var React = window.PluginApi.React;
  var Children = React.Children;
  var Component = React.Component;
  var Fragment = React.Fragment;
  var Profiler = React.Profiler;
  var PureComponent = React.PureComponent;
  var StrictMode = React.StrictMode;
  var Suspense = React.Suspense;
  var cloneElement = React.cloneElement;
  var createContext = React.createContext;
  var createElement = React.createElement;
  var createFactory = React.createFactory;
  var createRef = React.createRef;
  var forwardRef = React.forwardRef;
  var isValidElement = React.isValidElement;
  var lazy = React.lazy;
  var memo = React.memo;
  var startTransition = React.startTransition;
  var useCallback = React.useCallback;
  var useContext = React.useContext;
  var useDebugValue = React.useDebugValue;
  var useDeferredValue = React.useDeferredValue;
  var useEffect = React.useEffect;
  var useId = React.useId;
  var useImperativeHandle = React.useImperativeHandle;
  var useInsertionEffect = React.useInsertionEffect;
  var useLayoutEffect = React.useLayoutEffect;
  var useMemo = React.useMemo;
  var useReducer = React.useReducer;
  var useRef = React.useRef;
  var useState = React.useState;
  var useSyncExternalStore = React.useSyncExternalStore;
  var useTransition = React.useTransition;
  var version = React.version;

  // src/shared/multiscreen/playlists.ts
  var shuffleMultiscreenItems = (items) => {
    const shuffledItems = [...items];
    for (let i = shuffledItems.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledItems[i], shuffledItems[j]] = [shuffledItems[j], shuffledItems[i]];
    }
    return shuffledItems;
  };
  var splitMultiscreenItemsByIndex = (items, total) => {
    const groups = Array.from({ length: Math.max(0, total) }, () => []);
    items.forEach((item, index) => {
      groups[index % total]?.push(item);
    });
    return groups;
  };
  var createMultiscreenPlaylists = (items, totalScreens, randomize, splitItems) => {
    if (items.length === 0) {
      return Array.from({ length: Math.max(0, totalScreens) }, () => []);
    }
    if (splitItems) {
      const sourceItems = randomize ? shuffleMultiscreenItems(items) : [...items];
      return splitMultiscreenItemsByIndex(sourceItems, totalScreens);
    }
    return Array.from(
      { length: Math.max(0, totalScreens) },
      () => randomize ? shuffleMultiscreenItems(items) : [...items]
    );
  };

  // plugins/stash-multiscreen/src/stashMultiscreen.tsx
  var PluginApi = window.PluginApi;
  var GQL = PluginApi.GQL;
  var { Button } = PluginApi.libraries.Bootstrap;
  var { NavLink, useLocation } = PluginApi.libraries.ReactRouterDOM;
  var FontAwesomeIcon = PluginApi.libraries.ReactFontAwesome?.FontAwesomeIcon;
  var solidIcons = PluginApi.libraries.FontAwesomeSolid ?? {};
  var PLUGIN_ID = "stashMultiscreen";
  var ROUTE_PATH = "/plugins/multiscreen";
  var SCENES_ROUTE_PATH = "/scenes";
  var MARKERS_ROUTE_PATH = "/scenes/markers";
  var PERFORMERS_ROUTE_PATH = "/performers";
  var STUDIOS_ROUTE_PATH = "/studios";
  var LAUNCH_CONTEXT_STORAGE_KEY = "stashMultiscreen.launchContext";
  var MAX_SCENE_PAGE_SIZE = 240;
  var PLUGIN_SETTING_ORDER = [
    "totalScreens",
    "rows",
    "columns",
    "randomize",
    "splitScenes",
    "startMuted",
    "randomStart",
    "loopScenes",
    "markerDuration",
    "pauseWhenHidden"
  ];
  var PLUGIN_SETTING_ORDER_INDEX = new Map(
    PLUGIN_SETTING_ORDER.map((name, order) => [name, order])
  );
  var latestSceneListContext = null;
  var latestMarkerListContext = null;
  var latestPerformerListContext = null;
  var latestPerformerDetailId = null;
  var latestStudioListContext = null;
  var latestStudioDetailId = null;
  var contextChangeListeners = /* @__PURE__ */ new Set();
  var contextSignatures = /* @__PURE__ */ new Map();
  var sceneCountCache = /* @__PURE__ */ new Map();
  var SCENE_COUNT_CACHE_MS = 3e4;
  var SCENE_COUNT_DEBOUNCE_MS = 300;
  var MAX_SCENE_COUNT_CACHE_ENTRIES = 100;
  var NON_RANDOM_SCENE_SORT = "title";
  var DEFAULT_SETTINGS = {
    totalScreens: 4,
    rows: 2,
    columns: 2,
    randomize: true,
    splitScenes: false,
    startMuted: true,
    randomStart: false,
    loopScenes: true,
    markerDuration: 30,
    pauseWhenHidden: false
  };
  var ICONS = {
    close: solidIcons.faXmark ?? solidIcons.faTimes,
    error: solidIcons.faTriangleExclamation ?? solidIcons.faExclamationTriangle,
    oCounter: solidIcons.faDroplet ?? solidIcons.faTint,
    reload: solidIcons.faRotateRight ?? solidIcons.faRedo,
    success: solidIcons.faCheck
  };
  var Glyph = ({ icon, fallback }) => {
    if (FontAwesomeIcon && icon) {
      return /* @__PURE__ */ createElement(FontAwesomeIcon, { icon });
    }
    return /* @__PURE__ */ createElement("span", { "aria-hidden": "true" }, fallback);
  };
  var PluginIconButton = ({ ariaLabel, disabled = false, fallback, icon, onClick }) => /* @__PURE__ */ createElement(
    "button",
    {
      type: "button",
      className: "ms-button",
      "aria-label": ariaLabel,
      title: ariaLabel,
      disabled,
      onClick
    },
    /* @__PURE__ */ createElement(Glyph, { icon, fallback })
  );
  var clampInteger = (value, fallback, min, max) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(next)));
  };
  var coerceBoolean = (value, fallback) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalizedValue = value.trim().toLowerCase();
      if (normalizedValue === "true") return true;
      if (normalizedValue === "false") return false;
    }
    return fallback;
  };
  var parseMaybeJson = (value) => {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  };
  var getPluginSettingsMap = (pluginsConfig) => {
    const parsedConfig = parseMaybeJson(pluginsConfig);
    if (!parsedConfig || typeof parsedConfig !== "object") return {};
    const configRecord = parsedConfig;
    const nestedConfig = configRecord[PLUGIN_ID];
    if (nestedConfig && typeof nestedConfig === "object") {
      return nestedConfig;
    }
    return configRecord;
  };
  var normalizeSettings = (rawSettings) => ({
    totalScreens: clampInteger(rawSettings.totalScreens, DEFAULT_SETTINGS.totalScreens, 1, 36),
    rows: clampInteger(rawSettings.rows, DEFAULT_SETTINGS.rows, 1, 12),
    columns: clampInteger(rawSettings.columns, DEFAULT_SETTINGS.columns, 1, 12),
    randomize: coerceBoolean(rawSettings.randomize, DEFAULT_SETTINGS.randomize),
    splitScenes: coerceBoolean(rawSettings.splitScenes, DEFAULT_SETTINGS.splitScenes),
    startMuted: coerceBoolean(rawSettings.startMuted, DEFAULT_SETTINGS.startMuted),
    randomStart: coerceBoolean(rawSettings.randomStart, DEFAULT_SETTINGS.randomStart),
    loopScenes: coerceBoolean(rawSettings.loopScenes, DEFAULT_SETTINGS.loopScenes),
    markerDuration: clampInteger(rawSettings.markerDuration, DEFAULT_SETTINGS.markerDuration, 1, 600),
    pauseWhenHidden: coerceBoolean(rawSettings.pauseWhenHidden, DEFAULT_SETTINGS.pauseWhenHidden)
  });
  var getPlaybackSettings = (settings) => ({
    startMuted: settings.startMuted,
    randomStart: settings.randomStart,
    loop: settings.loopScenes,
    pauseWhenHidden: settings.pauseWhenHidden
  });
  var getSceneLimit = (settings) => {
    const multiplier = settings.splitScenes ? 8 : 12;
    return Math.min(MAX_SCENE_PAGE_SIZE, Math.max(settings.totalScreens, settings.totalScreens * multiplier));
  };
  var getSceneSort = (settings) => {
    if (settings.randomize) return "random";
    return NON_RANDOM_SCENE_SORT;
  };
  var subscribeToContextChanges = (listener) => {
    contextChangeListeners.add(listener);
    return () => {
      contextChangeListeners.delete(listener);
    };
  };
  var notifyContextChange = (key, signature) => {
    if (contextSignatures.get(key) === signature) return;
    contextSignatures.set(key, signature);
    window.setTimeout(() => {
      contextChangeListeners.forEach((listener) => listener());
    }, 0);
  };
  var getUnpaginatedFindFilter = (filter) => {
    const { page: _page, per_page: _perPage, ...unpaginatedFilter } = filter.makeFindFilter();
    return unpaginatedFilter;
  };
  var getListContextSignature = (context) => {
    return JSON.stringify({
      filter: getUnpaginatedFindFilter(context.filter),
      objectFilter: context.filter.makeFilter(),
      selectedIds: Array.from(context.selectedIds)
    });
  };
  var updateListContext = (key, context, update) => {
    update(context);
    notifyContextChange(key, getListContextSignature(context));
  };
  var updateDetailContext = (key, id, update) => {
    update(id);
    notifyContextChange(key, id);
  };
  var isRecord = (value) => {
    return !!value && typeof value === "object" && !Array.isArray(value);
  };
  var isMultiscreenLaunchContext = (value) => {
    if (!isRecord(value)) return false;
    if (value.source === "selection") {
      return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id) => typeof id === "string");
    }
    if (value.source === "filter") {
      return isRecord(value.filter) && isRecord(value.sceneFilter);
    }
    if (value.source === "performer-selection") {
      return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id) => typeof id === "string");
    }
    if (value.source === "performer-filter") {
      return isRecord(value.filter) && isRecord(value.performerFilter);
    }
    if (value.source === "performer-detail") {
      return typeof value.performerId === "string";
    }
    if (value.source === "studio-selection") {
      return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id) => typeof id === "string");
    }
    if (value.source === "studio-filter") {
      return isRecord(value.filter) && isRecord(value.studioFilter);
    }
    if (value.source === "studio-detail") {
      return typeof value.studioId === "string";
    }
    if (value.source === "marker-selection") {
      return Array.isArray(value.selectedIds) && value.selectedIds.length > 0 && value.selectedIds.every((id) => typeof id === "string");
    }
    return value.source === "marker-filter" && isRecord(value.filter) && isRecord(value.markerFilter);
  };
  var getCurrentSceneLaunchContext = () => {
    if (!latestSceneListContext) return null;
    const selectedIds = Array.from(latestSceneListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "selection",
        selectedIds
      };
    }
    return {
      source: "filter",
      filter: getUnpaginatedFindFilter(latestSceneListContext.filter),
      sceneFilter: latestSceneListContext.filter.makeFilter()
    };
  };
  var getCurrentMarkerLaunchContext = () => {
    if (!latestMarkerListContext) return null;
    const selectedIds = Array.from(latestMarkerListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "marker-selection",
        selectedIds
      };
    }
    return {
      source: "marker-filter",
      filter: getUnpaginatedFindFilter(latestMarkerListContext.filter),
      markerFilter: latestMarkerListContext.filter.makeFilter()
    };
  };
  var getCurrentPerformerLaunchContext = () => {
    if (!latestPerformerListContext) return null;
    const selectedIds = Array.from(latestPerformerListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "performer-selection",
        selectedIds
      };
    }
    return {
      source: "performer-filter",
      filter: getUnpaginatedFindFilter(latestPerformerListContext.filter),
      performerFilter: latestPerformerListContext.filter.makeFilter()
    };
  };
  var getCurrentStudioLaunchContext = () => {
    if (!latestStudioListContext) return null;
    const selectedIds = Array.from(latestStudioListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "studio-selection",
        selectedIds
      };
    }
    return {
      source: "studio-filter",
      filter: getUnpaginatedFindFilter(latestStudioListContext.filter),
      studioFilter: latestStudioListContext.filter.makeFilter()
    };
  };
  var getLaunchContextForPath = (pathname) => {
    if (pathname === MARKERS_ROUTE_PATH) {
      return getCurrentMarkerLaunchContext();
    }
    if (pathname === SCENES_ROUTE_PATH) {
      return getCurrentSceneLaunchContext();
    }
    if (pathname === PERFORMERS_ROUTE_PATH) {
      return getCurrentPerformerLaunchContext();
    }
    const performerPathId = pathname.match(/^\/performers\/([^/]+)/)?.[1];
    if (performerPathId && performerPathId !== "new" && performerPathId === latestPerformerDetailId) {
      return {
        source: "performer-detail",
        performerId: performerPathId
      };
    }
    if (pathname === STUDIOS_ROUTE_PATH) {
      return getCurrentStudioLaunchContext();
    }
    const studioPathId = pathname.match(/^\/studios\/([^/]+)/)?.[1];
    if (studioPathId && studioPathId !== "new" && studioPathId === latestStudioDetailId) {
      return {
        source: "studio-detail",
        studioId: studioPathId
      };
    }
    return null;
  };
  var storeLaunchContext = (context) => {
    try {
      if (context) {
        window.sessionStorage.setItem(LAUNCH_CONTEXT_STORAGE_KEY, JSON.stringify(context));
      } else {
        window.sessionStorage.removeItem(LAUNCH_CONTEXT_STORAGE_KEY);
      }
    } catch {
    }
  };
  var readLaunchContext = () => {
    try {
      const storedContext = window.sessionStorage.getItem(LAUNCH_CONTEXT_STORAGE_KEY);
      if (!storedContext) return null;
      const parsedContext = JSON.parse(storedContext);
      return isMultiscreenLaunchContext(parsedContext) ? parsedContext : null;
    } catch {
      return null;
    }
  };
  var getPerformerIds = async (launchContext) => {
    const data = await graphqlRequest(findPerformersQuery, {
      filter: {
        ...launchContext.filter,
        page: 1,
        per_page: -1
      },
      performer_filter: launchContext.performerFilter
    });
    return data.findPerformers.performers.map((performer) => performer.id);
  };
  var getStudioIds = async (launchContext) => {
    const data = await graphqlRequest(findStudiosQuery, {
      filter: {
        ...launchContext.filter,
        page: 1,
        per_page: -1
      },
      studio_filter: launchContext.studioFilter
    });
    return data.findStudios.studios.map((studio) => studio.id);
  };
  var getSceneQueryVariables = async (settings, launchContext) => {
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
    if (launchContext?.source === "performer-selection" || launchContext?.source === "performer-detail" || launchContext?.source === "performer-filter") {
      const performerIds = launchContext.source === "performer-selection" ? launchContext.selectedIds : launchContext.source === "performer-detail" ? [launchContext.performerId] : await getPerformerIds(launchContext);
      if (performerIds.length === 0) return null;
      return {
        filter: {
          page: 1,
          per_page: -1,
          sort: getSceneSort(settings)
        },
        scene_filter: {
          performers: {
            value: performerIds,
            modifier: "INCLUDES"
          }
        }
      };
    }
    if (launchContext?.source === "studio-selection" || launchContext?.source === "studio-detail" || launchContext?.source === "studio-filter") {
      const studioIds = launchContext.source === "studio-selection" ? launchContext.selectedIds : launchContext.source === "studio-detail" ? [launchContext.studioId] : await getStudioIds(launchContext);
      if (studioIds.length === 0) return null;
      return {
        filter: {
          page: 1,
          per_page: -1,
          sort: getSceneSort(settings)
        },
        scene_filter: {
          studios: {
            value: studioIds,
            modifier: "INCLUDES",
            depth: 0
          }
        }
      };
    }
    return {
      filter: {
        page: 1,
        per_page: getSceneLimit(settings),
        sort: getSceneSort(settings)
      }
    };
  };
  var isMarkerLaunchContext = (launchContext) => {
    return launchContext?.source === "marker-filter" || launchContext?.source === "marker-selection";
  };
  var getMarkerQueryVariables = (settings, launchContext) => {
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
  var getSceneTitle = (scene) => {
    const title = scene.title?.trim();
    return title && title.length > 0 ? title : `Scene ${scene.id}`;
  };
  var getSceneStreamUrl = (scene) => {
    const directStream = scene.paths?.stream;
    if (directStream) return directStream;
    return scene.sceneStreams?.find((stream) => !!stream.url)?.url ?? "";
  };
  var getSceneItem = (scene) => {
    if (!getSceneStreamUrl(scene)) return null;
    return {
      id: scene.id,
      title: getSceneTitle(scene),
      scene
    };
  };
  var getMarkerItem = (marker, fallbackDuration) => {
    if (!getSceneStreamUrl(marker.scene)) return null;
    const title = marker.title.trim() || marker.primary_tag.name.trim() || `${getSceneTitle(marker.scene)} @ ${Math.floor(marker.seconds)}s`;
    const requestedEnd = marker.end_seconds ?? marker.seconds + fallbackDuration;
    const end = requestedEnd > marker.seconds ? requestedEnd : marker.seconds + fallbackDuration;
    return {
      id: `marker-${marker.id}`,
      title,
      playbackRange: {
        start: marker.seconds,
        end
      },
      scene: marker.scene
    };
  };
  var graphqlRequest = async (query, variables) => {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
      throw new Error(`GraphQL request failed with HTTP ${response.status}`);
    }
    const result = await response.json();
    if (result.errors?.length) {
      throw new Error(result.errors.map((error) => error.message).join("; "));
    }
    if (!result.data) {
      throw new Error("GraphQL response did not include data.");
    }
    return result.data;
  };
  var findPerformersQuery = `
  query StashMultiscreenPerformers(
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
  var findStudiosQuery = `
  query StashMultiscreenStudios(
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
  var findScenesQuery = `
  query StashMultiscreenScenes(
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
  var findSceneMarkersQuery = `
  query StashMultiscreenMarkers(
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
  var findSceneCountQuery = `
  query StashMultiscreenSceneCount(
    $filter: FindFilterType
    $scene_filter: SceneFilterType
    $ids: [ID!]
  ) {
    findScenes(filter: $filter, scene_filter: $scene_filter, ids: $ids) {
      count
    }
  }
`;
  var findSceneMarkerCountQuery = `
  query StashMultiscreenMarkerCount(
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
  var incrementSceneOQuery = `
  mutation StashMultiscreenIncrementSceneO($id: ID!) {
    sceneIncrementO(id: $id)
  }
`;
  var getCachedSceneCount = (key) => {
    const cachedCount = sceneCountCache.get(key);
    if (!cachedCount || Date.now() - cachedCount.timestamp > SCENE_COUNT_CACHE_MS) {
      return null;
    }
    return cachedCount.count;
  };
  var cacheSceneCount = (key, count) => {
    sceneCountCache.set(key, {
      count,
      timestamp: Date.now()
    });
    if (sceneCountCache.size > MAX_SCENE_COUNT_CACHE_ENTRIES) {
      const oldestKey = sceneCountCache.keys().next().value;
      if (oldestKey) sceneCountCache.delete(oldestKey);
    }
  };
  var getLiveSceneCount = async (launchContext) => {
    if (launchContext.source === "selection" || launchContext.source === "marker-selection") {
      return launchContext.selectedIds.length;
    }
    if (launchContext.source === "marker-filter") {
      const queryVariables2 = getMarkerQueryVariables(DEFAULT_SETTINGS, launchContext);
      const data2 = await graphqlRequest(
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
    const data = await graphqlRequest(findSceneCountQuery, {
      ...queryVariables,
      filter: {
        ...queryVariables.filter,
        page: 1,
        per_page: 0
      }
    });
    return data.findScenes.count;
  };
  var useSceneQuery = (settings, launchContext, enabled) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState({ count: 0, scenes: [] });
    const requestKey = `${enabled ? "on" : "off"}:${JSON.stringify({ launchContext, settings })}`;
    const loadScenes = useCallback(async () => {
      if (!enabled) return;
      setLoading(true);
      setError(null);
      try {
        const queryVariables = await getSceneQueryVariables(settings, launchContext);
        if (!queryVariables) {
          setResult({ count: 0, scenes: [] });
          return;
        }
        const data = await graphqlRequest(findScenesQuery, queryVariables);
        const playableScenes = data.findScenes.scenes.filter((scene) => !!getSceneStreamUrl(scene));
        const sceneById = new Map(playableScenes.map((scene) => [scene.id, scene]));
        const orderedScenes = queryVariables.ids ? queryVariables.ids.map((id) => sceneById.get(id)).filter((scene) => !!scene) : playableScenes;
        setResult({
          count: data.findScenes.count,
          scenes: orderedScenes
        });
      } catch (sceneError) {
        setError(sceneError instanceof Error ? sceneError : new Error(String(sceneError)));
        setResult({ count: 0, scenes: [] });
      } finally {
        setLoading(false);
      }
    }, [enabled, launchContext, requestKey, settings]);
    useEffect(() => {
      void loadScenes();
    }, [loadScenes]);
    return {
      error,
      loading,
      refresh: loadScenes,
      result
    };
  };
  var useMarkerQuery = (settings, launchContext, enabled) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState({
      count: 0,
      scene_markers: []
    });
    const requestKey = `${enabled ? "on" : "off"}:${JSON.stringify({ launchContext, settings })}`;
    const loadMarkers = useCallback(async () => {
      if (!enabled || !isMarkerLaunchContext(launchContext)) return;
      setLoading(true);
      setError(null);
      try {
        const queryVariables = getMarkerQueryVariables(settings, launchContext);
        const data = await graphqlRequest(
          findSceneMarkersQuery,
          queryVariables
        );
        const playableMarkers = data.findSceneMarkers.scene_markers.filter(
          (marker) => !!getSceneStreamUrl(marker.scene)
        );
        const markerById = new Map(playableMarkers.map((marker) => [marker.id, marker]));
        const orderedMarkers = queryVariables.ids ? queryVariables.ids.map((id) => markerById.get(id)).filter((marker) => !!marker) : playableMarkers;
        setResult({
          count: data.findSceneMarkers.count,
          scene_markers: orderedMarkers
        });
      } catch (markerError) {
        setError(markerError instanceof Error ? markerError : new Error(String(markerError)));
        setResult({ count: 0, scene_markers: [] });
      } finally {
        setLoading(false);
      }
    }, [enabled, launchContext, requestKey, settings]);
    useEffect(() => {
      void loadMarkers();
    }, [loadMarkers]);
    return {
      error,
      loading,
      refresh: loadMarkers,
      result
    };
  };
  var useNativePlayerComponent = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [revision, setRevision] = useState(0);
    const [component, setComponent] = useState(
      () => PluginApi.components?.ScenePlayer ?? null
    );
    useEffect(() => {
      let cancelled = false;
      const loadScenePlayer = PluginApi.loadableComponents?.ScenePlayer;
      const loadComponents = PluginApi.utils?.loadComponents;
      if (!PluginApi.components || !loadScenePlayer || !loadComponents || !PluginApi.utils?.StashService?.useFindScene) {
        setError(new Error("This Stash version does not expose the native ScenePlayer plugin API."));
        return;
      }
      if (component) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      void loadComponents([loadScenePlayer]).then(() => {
        if (cancelled) return;
        const loadedComponent = PluginApi.components?.ScenePlayer;
        if (!loadedComponent) {
          throw new Error("Stash loaded the native player module without registering ScenePlayer.");
        }
        setComponent(() => loadedComponent);
      }).catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError : new Error(String(loadError)));
        }
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [component, revision]);
    return {
      component,
      error,
      loading,
      refresh: () => {
        setError(null);
        setRevision((currentRevision) => currentRevision + 1);
      }
    };
  };
  var LoadedNativePlayer = ({
    audioState,
    item,
    nativePlayer: NativePlayer,
    nextItem,
    onAudioStateChange,
    playback,
    previousItem,
    scene
  }) => {
    const tileRef = useRef(null);
    const setTimestampRef = useRef(null);
    const rangeEndHandledRef = useRef(false);
    const audioStateRef = useRef(audioState);
    const onAudioStateChangeRef = useRef(onAudioStateChange);
    const sceneId = item.scene?.id ?? item.id;
    audioStateRef.current = audioState;
    onAudioStateChangeRef.current = onAudioStateChange;
    const [initialTimestamp] = useState(() => {
      if (item.playbackRange) return item.playbackRange.start;
      if (!playback.randomStart) return 0;
      const duration = Number(scene?.files?.[0]?.duration);
      return Number.isFinite(duration) && duration > 0 ? Math.random() * duration : 0;
    });
    const handleComplete = useCallback(() => {
      if (playback.loop) {
        setTimestampRef.current?.(item.playbackRange?.start ?? 0);
        return;
      }
      nextItem();
    }, [item.playbackRange, nextItem, playback.loop]);
    useEffect(() => {
      const tile = tileRef.current;
      const playbackRange = item.playbackRange;
      const rangeEnd = playbackRange?.end;
      if (!tile || !playbackRange || rangeEnd === void 0 || !Number.isFinite(rangeEnd)) return;
      let videoElement = null;
      const handleTimeUpdate = () => {
        if (!videoElement) return;
        if (videoElement.currentTime < rangeEnd) {
          rangeEndHandledRef.current = false;
          return;
        }
        if (rangeEndHandledRef.current) return;
        rangeEndHandledRef.current = true;
        if (playback.loop) {
          setTimestampRef.current?.(playbackRange.start);
        } else {
          nextItem();
        }
      };
      const attachVideoElement = () => {
        const nextVideoElement = tile.querySelector("video");
        if (nextVideoElement === videoElement) return;
        videoElement?.removeEventListener("timeupdate", handleTimeUpdate);
        videoElement = nextVideoElement;
        videoElement?.addEventListener("timeupdate", handleTimeUpdate);
      };
      attachVideoElement();
      const observer = new MutationObserver(attachVideoElement);
      observer.observe(tile, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        videoElement?.removeEventListener("timeupdate", handleTimeUpdate);
      };
    }, [item.playbackRange, nextItem, playback.loop]);
    useEffect(() => {
      const tile = tileRef.current;
      if (!tile) return;
      let player = null;
      let applyingAudioState = false;
      const isDisposed = () => !player || player.isDisposed?.();
      const disableSharedVolumePersistence = () => {
        if (isDisposed()) return;
        const persistVolume = player.persistVolume?.();
        if (persistVolume) {
          persistVolume.enabled = false;
          persistVolume.ready = () => void 0;
        }
      };
      const applyAudioState = () => {
        if (isDisposed()) return;
        disableSharedVolumePersistence();
        const desiredAudioState = audioStateRef.current;
        applyingAudioState = true;
        try {
          if (player.volume() !== desiredAudioState.volume) {
            player.volume(desiredAudioState.volume);
          }
          if (player.muted() !== desiredAudioState.muted) {
            player.muted(desiredAudioState.muted);
          }
        } finally {
          applyingAudioState = false;
        }
      };
      const handleVolumeChange = () => {
        if (isDisposed() || applyingAudioState) return;
        const nextVolume = Number(player.volume());
        const nextAudioState = {
          muted: !!player.muted(),
          volume: Number.isFinite(nextVolume) ? nextVolume : audioStateRef.current.volume
        };
        audioStateRef.current = nextAudioState;
        onAudioStateChangeRef.current(nextAudioState);
      };
      const detachPlayer = () => {
        player?.off?.("volumechange", handleVolumeChange);
        player = null;
      };
      const attachPlayer = () => {
        const playerElement = tile.querySelector("video-js");
        const nextPlayer = playerElement?.player ?? null;
        if (!nextPlayer || nextPlayer === player) return;
        detachPlayer();
        player = nextPlayer;
        disableSharedVolumePersistence();
        player.on("volumechange", handleVolumeChange);
        player.ready(() => {
          if (player !== nextPlayer || nextPlayer.isDisposed?.()) return;
          disableSharedVolumePersistence();
          applyAudioState();
        });
        applyAudioState();
      };
      attachPlayer();
      const observer = new MutationObserver(attachPlayer);
      observer.observe(tile, { childList: true, subtree: true });
      return () => {
        observer.disconnect();
        detachPlayer();
      };
    }, []);
    useEffect(() => {
      const playerElement = tileRef.current?.querySelector("video-js");
      const player = playerElement?.player;
      if (!player || player.isDisposed?.()) return;
      const persistVolume = player.persistVolume?.();
      if (persistVolume) {
        persistVolume.enabled = false;
        persistVolume.ready = () => void 0;
      }
      if (player.volume() !== audioState.volume) player.volume(audioState.volume);
      if (player.muted() !== audioState.muted) player.muted(audioState.muted);
    }, [audioState.muted, audioState.volume]);
    return /* @__PURE__ */ createElement("div", { className: "ms-native-tile", ref: tileRef }, /* @__PURE__ */ createElement(
      NavLink,
      {
        "aria-label": `Open scene page for ${item.title}`,
        className: "ms-title",
        rel: "noopener noreferrer",
        target: "_blank",
        title: `Open scene page: ${item.title}`,
        to: `${SCENES_ROUTE_PATH}/${sceneId}`
      },
      item.title
    ), /* @__PURE__ */ createElement(
      NativePlayer,
      {
        autoplay: true,
        hideScrubberOverride: true,
        initialTimestamp,
        onComplete: handleComplete,
        onNext: nextItem,
        onPrevious: previousItem,
        permitLoop: playback.loop,
        scene,
        sendSetTimestamp: (setTimestamp) => {
          setTimestampRef.current = setTimestamp;
        }
      }
    ));
  };
  var NativePlayerTile = ({ item, nativePlayer, nextItem, playback, previousItem, useFindScene }) => {
    const sceneId = item.scene?.id ?? item.id;
    const sceneQuery = useFindScene(sceneId);
    const [audioState, setAudioState] = useState(() => ({
      muted: playback.startMuted,
      volume: 1
    }));
    useEffect(() => {
      setAudioState({
        muted: playback.startMuted,
        volume: 1
      });
    }, [playback.startMuted]);
    if (sceneQuery.loading) {
      return /* @__PURE__ */ createElement("div", { className: "ms-error" }, /* @__PURE__ */ createElement("div", { className: "ms-error-content" }, "Loading scene"));
    }
    if (sceneQuery.error || !sceneQuery.data?.findScene) {
      return /* @__PURE__ */ createElement("div", { className: "ms-error" }, /* @__PURE__ */ createElement("div", { className: "ms-error-content" }, "The native Stash player could not load this scene.", sceneQuery.error?.message && /* @__PURE__ */ createElement("div", { className: "ms-error-detail" }, sceneQuery.error.message)));
    }
    return /* @__PURE__ */ createElement(
      LoadedNativePlayer,
      {
        key: item.id,
        audioState,
        item,
        nativePlayer,
        nextItem,
        onAudioStateChange: setAudioState,
        playback,
        previousItem,
        scene: sceneQuery.data.findScene
      }
    );
  };
  var NativeMultiscreenGrid = ({
    columns,
    nativePlayer,
    onVisibleSceneIdsChange,
    playback,
    playlists,
    rows,
    totalScreens,
    useFindScene
  }) => {
    const gridRef = useRef(null);
    const videosToResumeRef = useRef(/* @__PURE__ */ new Set());
    const [cursors, setCursors] = useState(
      () => Array.from({ length: totalScreens }, () => 0)
    );
    const playlistKey = useMemo(
      () => playlists.map((playlist) => playlist.map((item) => item.id).join(",")).join("|"),
      [playlists]
    );
    useEffect(() => {
      setCursors(Array.from({ length: totalScreens }, () => 0));
    }, [playlistKey, totalScreens]);
    const visibleSceneIds = useMemo(() => {
      const sceneIds = Array.from({ length: totalScreens }, (_, screenIndex) => {
        const playlist = playlists[screenIndex] ?? [];
        if (playlist.length === 0) return null;
        const currentIndex = Math.min(cursors[screenIndex] ?? 0, playlist.length - 1);
        const item = playlist[currentIndex];
        return item.scene?.id ?? null;
      }).filter((sceneId) => !!sceneId);
      return Array.from(new Set(sceneIds));
    }, [cursors, playlists, totalScreens]);
    useEffect(() => {
      onVisibleSceneIdsChange(visibleSceneIds);
    }, [onVisibleSceneIdsChange, visibleSceneIds]);
    useEffect(
      () => () => onVisibleSceneIdsChange([]),
      [onVisibleSceneIdsChange]
    );
    useEffect(() => {
      const grid = gridRef.current;
      if (!grid || !playback.pauseWhenHidden) {
        videosToResumeRef.current.clear();
        return;
      }
      const pauseVideo = (video) => {
        if (video.paused || video.ended) return;
        videosToResumeRef.current.add(video);
        video.pause();
      };
      const handleVisibilityChange = () => {
        if (document.hidden) {
          videosToResumeRef.current.clear();
          grid.querySelectorAll("video").forEach(pauseVideo);
          return;
        }
        const videosToResume = Array.from(videosToResumeRef.current);
        videosToResumeRef.current.clear();
        videosToResume.forEach((video) => {
          if (!video.isConnected || !grid.contains(video) || video.ended) return;
          void video.play().catch(() => void 0);
        });
      };
      const handlePlay = (event) => {
        if (!document.hidden || !(event.target instanceof HTMLVideoElement)) return;
        pauseVideo(event.target);
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      grid.addEventListener("play", handlePlay, true);
      handleVisibilityChange();
      return () => {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        grid.removeEventListener("play", handlePlay, true);
        videosToResumeRef.current.clear();
      };
    }, [playback.pauseWhenHidden]);
    const setCursor = useCallback((screenIndex, nextIndex) => {
      setCursors((previousCursors) => {
        const nextCursors = Array.from(
          { length: totalScreens },
          (_, index) => previousCursors[index] ?? 0
        );
        nextCursors[screenIndex] = nextIndex;
        return nextCursors;
      });
    }, [totalScreens]);
    return /* @__PURE__ */ createElement(
      "div",
      {
        className: "ms-grid ms-native-grid",
        ref: gridRef,
        style: {
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
        }
      },
      Array.from({ length: totalScreens }, (_, screenIndex) => {
        const playlist = playlists[screenIndex] ?? [];
        if (playlist.length === 0) return /* @__PURE__ */ createElement("div", { className: "ms-cell", key: `ms-native-${screenIndex}` });
        const currentIndex = Math.min(cursors[screenIndex] ?? 0, playlist.length - 1);
        const item = playlist[currentIndex];
        const nextItem = () => setCursor(screenIndex, (currentIndex + 1) % playlist.length);
        const previousItem = () => setCursor(
          screenIndex,
          currentIndex === 0 ? playlist.length - 1 : currentIndex - 1
        );
        return /* @__PURE__ */ createElement("div", { className: "ms-cell", key: `ms-native-${screenIndex}` }, /* @__PURE__ */ createElement(
          NativePlayerTile,
          {
            item,
            nativePlayer,
            nextItem,
            playback,
            previousItem,
            useFindScene
          }
        ));
      })
    );
  };
  var StateView = ({ detail, onRetry, title }) => /* @__PURE__ */ createElement("div", { className: "ms-state" }, /* @__PURE__ */ createElement("div", { className: "ms-state-panel" }, /* @__PURE__ */ createElement("div", { className: "ms-state-title" }, title), detail && /* @__PURE__ */ createElement("div", { className: "ms-state-detail" }, detail), onRetry && /* @__PURE__ */ createElement("div", { className: "ms-state-actions" }, /* @__PURE__ */ createElement(PluginIconButton, { ariaLabel: "Retry", fallback: "reload", icon: ICONS.reload, onClick: onRetry }))));
  var closeRoute = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign("/scenes");
  };
  var MultiscreenRoute = () => {
    const [visibleNativeSceneIds, setVisibleNativeSceneIds] = useState([]);
    const [oCounterStatus, setOCounterStatus] = useState("idle");
    const oCounterResetTimeout = useRef(null);
    const launchContext = useMemo(() => readLaunchContext(), []);
    const markerMode = isMarkerLaunchContext(launchContext);
    const configQuery = GQL.useConfigurationQuery({ fetchPolicy: "network-only" });
    const rawSettings = useMemo(
      () => getPluginSettingsMap(configQuery.data?.configuration?.plugins),
      [configQuery.data]
    );
    const settings = useMemo(() => normalizeSettings(rawSettings), [rawSettings]);
    const playbackSettings = useMemo(() => getPlaybackSettings(settings), [settings]);
    const nativePlayerQuery = useNativePlayerComponent();
    const scenesQuery = useSceneQuery(
      settings,
      launchContext,
      !configQuery.loading && !markerMode
    );
    const markersQuery = useMarkerQuery(
      settings,
      launchContext,
      !configQuery.loading && markerMode
    );
    const sceneItems = useMemo(
      () => scenesQuery.result.scenes.map(getSceneItem).filter((item) => item !== null),
      [scenesQuery.result.scenes]
    );
    const markerItems = useMemo(
      () => markersQuery.result.scene_markers.map((marker) => getMarkerItem(marker, settings.markerDuration)).filter((item) => item !== null),
      [markersQuery.result.scene_markers, settings.markerDuration]
    );
    const items = markerMode ? markerItems : sceneItems;
    const playlists = useMemo(
      () => createMultiscreenPlaylists(
        items,
        settings.totalScreens,
        settings.randomize,
        settings.splitScenes
      ),
      [items, settings.randomize, settings.splitScenes, settings.totalScreens]
    );
    const activeQuery = markerMode ? markersQuery : scenesQuery;
    const loading = configQuery.loading || activeQuery.loading || nativePlayerQuery.loading;
    const error = configQuery.error ?? activeQuery.error ?? nativePlayerQuery.error;
    const itemType = markerMode ? "markers" : "scenes";
    const visibleSceneCount = visibleNativeSceneIds.length;
    useEffect(() => () => {
      if (oCounterResetTimeout.current !== null) {
        window.clearTimeout(oCounterResetTimeout.current);
      }
    }, []);
    const incrementVisibleOCounters = useCallback(async () => {
      if (oCounterStatus === "loading" || visibleNativeSceneIds.length === 0) return;
      if (oCounterResetTimeout.current !== null) {
        window.clearTimeout(oCounterResetTimeout.current);
        oCounterResetTimeout.current = null;
      }
      const sceneIds = [...visibleNativeSceneIds];
      setOCounterStatus("loading");
      const results = await Promise.all(sceneIds.map(async (id) => {
        try {
          await graphqlRequest(incrementSceneOQuery, { id });
          return true;
        } catch (error2) {
          console.error(`Could not increment the O counter for scene ${id}.`, error2);
          return false;
        }
      }));
      setOCounterStatus(results.every(Boolean) ? "success" : "error");
      oCounterResetTimeout.current = window.setTimeout(() => {
        setOCounterStatus("idle");
        oCounterResetTimeout.current = null;
      }, results.every(Boolean) ? 2e3 : 4e3);
    }, [oCounterStatus, visibleNativeSceneIds]);
    const oCounterButtonLabel = oCounterStatus === "loading" ? `Increasing O counter for ${visibleSceneCount} visible scene${visibleSceneCount === 1 ? "" : "s"}` : oCounterStatus === "success" ? `Increased O counter for ${visibleSceneCount} visible scene${visibleSceneCount === 1 ? "" : "s"}` : oCounterStatus === "error" ? `Could not increase every visible scene O counter; click to retry` : `Increase O counter for ${visibleSceneCount} visible scene${visibleSceneCount === 1 ? "" : "s"}`;
    const oCounterButtonIcon = oCounterStatus === "success" ? ICONS.success : oCounterStatus === "error" ? ICONS.error : ICONS.oCounter;
    const oCounterButtonFallback = oCounterStatus === "loading" ? "..." : oCounterStatus === "success" ? "ok" : oCounterStatus === "error" ? "!" : "O";
    return /* @__PURE__ */ createElement("div", { className: "ms-route" }, loading && /* @__PURE__ */ createElement(StateView, { title: `Loading ${itemType}` }), !loading && error && /* @__PURE__ */ createElement(
      StateView,
      {
        title: "Could not load multiscreen",
        detail: error.message,
        onRetry: () => {
          void configQuery.refetch?.();
          void activeQuery.refresh();
          nativePlayerQuery.refresh();
        }
      }
    ), !loading && !error && items.length === 0 && /* @__PURE__ */ createElement(
      StateView,
      {
        title: `No playable ${itemType} found`,
        detail: markerMode ? "Add markers to scenes with streamable video files, then reload this plugin page." : "Add scenes with streamable video files, then reload this plugin page.",
        onRetry: activeQuery.refresh
      }
    ), !loading && !error && items.length > 0 && nativePlayerQuery.component && /* @__PURE__ */ createElement(
      NativeMultiscreenGrid,
      {
        rows: settings.rows,
        columns: settings.columns,
        totalScreens: settings.totalScreens,
        playlists,
        playback: playbackSettings,
        nativePlayer: nativePlayerQuery.component,
        onVisibleSceneIdsChange: setVisibleNativeSceneIds,
        useFindScene: PluginApi.utils.StashService.useFindScene
      }
    ), /* @__PURE__ */ createElement("div", { className: "ms-floating" }, visibleSceneCount > 0 && /* @__PURE__ */ createElement(
      PluginIconButton,
      {
        ariaLabel: oCounterButtonLabel,
        disabled: oCounterStatus === "loading",
        fallback: oCounterButtonFallback,
        icon: oCounterButtonIcon,
        onClick: () => void incrementVisibleOCounters()
      }
    ), /* @__PURE__ */ createElement(PluginIconButton, { ariaLabel: "Close multiscreen", fallback: "x", icon: ICONS.close, onClick: closeRoute })));
  };
  var ContextualMultiscreenNavLink = () => {
    const location = useLocation();
    const [contextRevision, setContextRevision] = useState(0);
    const [sceneCount, setSceneCount] = useState(null);
    const [countLoading, setCountLoading] = useState(false);
    const launchContext = useMemo(
      () => getLaunchContextForPath(location.pathname),
      [contextRevision, location.pathname]
    );
    const launchContextKey = useMemo(
      () => launchContext ? JSON.stringify(launchContext) : "",
      [launchContext]
    );
    useEffect(() => {
      return subscribeToContextChanges(() => {
        setContextRevision((revision) => revision + 1);
      });
    }, []);
    useEffect(() => {
      let cancelled = false;
      if (!launchContext || !launchContextKey) {
        setSceneCount(null);
        setCountLoading(false);
        return;
      }
      const cachedCount = getCachedSceneCount(launchContextKey);
      if (cachedCount !== null) {
        setSceneCount(cachedCount);
        setCountLoading(false);
        return;
      }
      setCountLoading(true);
      const debounceMs = launchContext.source === "selection" || launchContext.source === "marker-selection" ? 0 : SCENE_COUNT_DEBOUNCE_MS;
      const timeoutId = window.setTimeout(() => {
        void getLiveSceneCount(launchContext).then((count) => {
          cacheSceneCount(launchContextKey, count);
          if (!cancelled) setSceneCount(count);
        }).catch(() => {
          if (!cancelled) setSceneCount(null);
        }).finally(() => {
          if (!cancelled) setCountLoading(false);
        });
      }, debounceMs);
      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }, [launchContext, launchContextKey]);
    const formattedSceneCount = sceneCount?.toLocaleString();
    const countNoun = isMarkerLaunchContext(launchContext) ? "markers" : "scenes";
    const buttonTitle = formattedSceneCount ? `Multiscreen (${formattedSceneCount} ${countNoun})` : "Multiscreen";
    const handleClick = useCallback(() => {
      storeLaunchContext(launchContext);
    }, [launchContext]);
    return /* @__PURE__ */ createElement(NavLink, { className: "nav-utility ms-nav-link", exact: true, to: ROUTE_PATH, onClick: handleClick }, /* @__PURE__ */ createElement(Button, { className: "minimal d-flex align-items-center h-100 ms-nav-button", title: buttonTitle }, /* @__PURE__ */ createElement("span", { className: "ms-nav-icon", "aria-hidden": "true" }, /* @__PURE__ */ createElement("span", null), /* @__PURE__ */ createElement("span", null), /* @__PURE__ */ createElement("span", null), /* @__PURE__ */ createElement("span", null)), launchContext && /* @__PURE__ */ createElement(
      "span",
      {
        className: `ms-nav-count${countLoading ? " ms-loading" : ""}`,
        "aria-label": countLoading ? `Counting ${countNoun}` : `${formattedSceneCount ?? 0} ${countNoun}`
      },
      countLoading ? "\u2026" : formattedSceneCount ?? "?"
    )));
  };
  PluginApi.patch.before("PluginSettings", function(props) {
    if (props.pluginID !== PLUGIN_ID || !Array.isArray(props.settings)) {
      return [props];
    }
    const settings = [...props.settings].sort((left, right) => {
      const leftOrder = left.name ? PLUGIN_SETTING_ORDER_INDEX.get(left.name) : void 0;
      const rightOrder = right.name ? PLUGIN_SETTING_ORDER_INDEX.get(right.name) : void 0;
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
    });
    return [{ ...props, settings }];
  });
  PluginApi.register.route(ROUTE_PATH, MultiscreenRoute);
  PluginApi.patch.before("SceneMarkerList", function(props) {
    if (window.location.pathname === MARKERS_ROUTE_PATH && props.filter && props.selectedIds instanceof Set) {
      const context = {
        filter: props.filter,
        selectedIds: props.selectedIds
      };
      updateListContext("marker-list", context, (nextContext) => {
        latestMarkerListContext = nextContext;
      });
    }
    return [props];
  });
  PluginApi.patch.before("SceneList", function(props) {
    if (window.location.pathname === SCENES_ROUTE_PATH && props.filter && props.selectedIds instanceof Set) {
      const context = {
        filter: props.filter,
        selectedIds: props.selectedIds
      };
      updateListContext("scene-list", context, (nextContext) => {
        latestSceneListContext = nextContext;
      });
    }
    return [props];
  });
  PluginApi.patch.before("PerformerList", function(props) {
    if (window.location.pathname === PERFORMERS_ROUTE_PATH && props.filter && props.selectedIds instanceof Set) {
      const context = {
        filter: props.filter,
        selectedIds: props.selectedIds
      };
      updateListContext("performer-list", context, (nextContext) => {
        latestPerformerListContext = nextContext;
      });
    }
    return [props];
  });
  PluginApi.patch.before("PerformerPage", function(props) {
    if (window.location.pathname.startsWith(`${PERFORMERS_ROUTE_PATH}/`) && props.performer?.id) {
      updateDetailContext("performer-detail", props.performer.id, (nextId) => {
        latestPerformerDetailId = nextId;
      });
    }
    return [props];
  });
  PluginApi.patch.before("StudioList", function(props) {
    if (window.location.pathname === STUDIOS_ROUTE_PATH && props.filter && props.selectedIds instanceof Set) {
      const context = {
        filter: props.filter,
        selectedIds: props.selectedIds
      };
      updateListContext("studio-list", context, (nextContext) => {
        latestStudioListContext = nextContext;
      });
    }
    return [props];
  });
  PluginApi.patch.before("StudioPage", function(props) {
    if (window.location.pathname.startsWith(`${STUDIOS_ROUTE_PATH}/`) && props.studio?.id) {
      updateDetailContext("studio-detail", props.studio.id, (nextId) => {
        latestStudioDetailId = nextId;
      });
    }
    return [props];
  });
  PluginApi.patch.before("MainNavBar.UtilityItems", function(props) {
    return [
      {
        children: /* @__PURE__ */ createElement(Fragment, null, props.children, /* @__PURE__ */ createElement(ContextualMultiscreenNavLink, null))
      }
    ];
  });
})();
