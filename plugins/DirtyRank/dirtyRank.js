(function () {
  "use strict";

  var INSTANCE_KEY = "__dirtyRankPlugin";
  if (window[INSTANCE_KEY]) return;

  var PluginApi = window.PluginApi;
  var DirtyPlugins = window.DirtyPlugins;
  if (!PluginApi || !DirtyPlugins || !DirtyPlugins.graphql) return;

  var React = PluginApi.React;
  var h = React.createElement;
  var Fragment = React.Fragment;
  var useCallback = React.useCallback;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;
  var useIntl = PluginApi.libraries.Intl.useIntl;
  var Router = PluginApi.libraries.ReactRouterDOM;
  var NavLink = Router.NavLink;
  var Prompt = Router.Prompt;
  var SettingsCard = DirtyPlugins.react && DirtyPlugins.react.SettingsCard;
  var Section = DirtyPlugins.react && DirtyPlugins.react.SettingsSection;
  var Toggle = DirtyPlugins.react && DirtyPlugins.react.SettingsToggle;
  var StateView = DirtyPlugins.react && DirtyPlugins.react.StateView;
  var PLUGIN_ID = "dirtyRank";
  var ROUTE_PATH = "/plugins/dirty-rank";
  var GAUNTLET_ROUTE_PATH = "/plugins/dirty-rank/gauntlet/:performerId";
  var LEADERBOARDS_ROUTE_PATH = "/plugins/dirty-rank-leaderboards";
  var PERFORMERS_ROUTE_PATH = "/performers";
  var OVERALL_SORT_VALUE = "dirty_rank_overall";
  var OVERALL_SORT_LABEL = "Overall Elo";
  var OVERALL_SORT_MESSAGE_ID = "dirty_rank.overall_elo";
  var OVERALL_LEADERBOARD_ID = "__overall__";
  var OVERALL_SORT_ACTIVE = "__dirtyRankOverallSortActive";
  var OVERALL_SORT_PAGE = "__dirtyRankOverallSortPage";
  var OVERALL_SORT_PAGE_SIZE = "__dirtyRankOverallSortPageSize";
  var OVERALL_SORT_DIRECTION = "__dirtyRankOverallSortDirection";
  var GLICKO_SCALE = 173.7178;
  var ORDER_CONFIDENCE_Z = 0.84;
  var MATCHMAKER_FOCUS_LIMIT = 48;
  var UNDO_HISTORY_LIMIT = 25;
  var LEADERBOARD_TABLE_PAGE_SIZE = 25;
  var LEADERBOARD_GALLERY_PAGE_SIZE = 15;
  var CATEGORY_PREFERENCE_STORAGE_KEY = "dirtyRank:selectedCategoryByCohort";
  var CONFIGURATION_CHANGED_EVENT = "dirty-plugins:configuration-changed";
  var COHORTS = [
    ["FEMALE", "Female"],
    ["MALE", "Male"],
    ["TRANSGENDER_FEMALE", "Transgender female"],
    ["TRANSGENDER_MALE", "Transgender male"],
    ["INTERSEX", "Intersex"],
    ["NON_BINARY", "Non-binary"],
  ];
  var DEFAULT_CATEGORY_DEFINITIONS = [
    { id: "appearance", name: "Appearance", description: "Visual appeal and on-camera presence.", enabled: true, weight: 1 },
    { id: "performance", name: "Performance", description: "Technique, energy, chemistry, and engagement.", enabled: true, weight: 1 },
  ];

  function defaultCategoriesByCohort() {
    var result = {};
    COHORTS.forEach(function (cohort) {
      result[cohort[0]] = DEFAULT_CATEGORY_DEFINITIONS.map(function (category) {
        return Object.assign({}, category);
      });
    });
    return result;
  }

  var DEFAULT_SETTINGS = {
    categoriesByCohort: defaultCategoriesByCohort(),
    defaultCohort: "FEMALE",
    enabledCohorts: ["FEMALE"],
    showLeaderboardsInMenu: true,
    showRatingsBeforeVote: false,
    hidePerformerImages: false,
    includePerformersWithoutImages: false,
    confidenceGoal: "ranking",
    confidenceTopN: 20,
    avoidRepeatWindow: 12,
    calibrationPercent: 10,
    initialRating: 1000,
    initialDeviation: 350,
    initialVolatility: 0.06,
    evidenceWeight: 2,
    tau: 0.5,
    deviationFloor: 30,
    provisionalDeviation: 100,
  };
  var overallSortSettings = DEFAULT_SETTINGS;
  var overallSortRevision = 0;
  var overallSortListeners = new Set();
  var overallFilterHookCache = new WeakMap();
  var ratingStateIndex = new Map();
  var performerMediaCache = new Map();
  var ratingIndexRevision = 0;
  var ratingIndexPromise = null;

  function asObject(value) {
    return DirtyPlugins.values.asObject(value);
  }

  function parseMaybeJson(value) {
    return DirtyPlugins.values.parseMaybeJson(value);
  }

  function number(value, fallback, minimum, maximum) {
    var result = Number(value);
    if (!Number.isFinite(result)) return fallback;
    return Math.min(maximum, Math.max(minimum, result));
  }

  function integer(value, fallback, minimum, maximum) {
    return Math.floor(number(value, fallback, minimum, maximum));
  }

  function slug(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  }

  function parseCategoryList(value) {
    if (!Array.isArray(value)) value = DEFAULT_CATEGORY_DEFINITIONS;
    var used = new Set();
    var categories = [];
    value.slice(0, 24).forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      var name = String(raw.name || "").trim().slice(0, 80);
      var id = slug(raw.id || name);
      if (!name || !id || used.has(id)) return;
      categories.push({
        id: id,
        name: name,
        description: String(raw.description || "").trim().slice(0, 500),
        enabled: DirtyPlugins.values.coerceBoolean(raw.enabled, true),
        weight: number(raw.weight, 1, 0.01, 1000),
      });
      used.add(id);
    });
    return categories.length ? categories : DEFAULT_CATEGORY_DEFINITIONS.map(function (item) { return Object.assign({}, item); });
  }

  function parseCategoriesByCohort(value) {
    value = parseMaybeJson(value);
    var result = {};
    var source = value && typeof value === "object" ? value : {};
    COHORTS.forEach(function (cohort) {
      result[cohort[0]] = parseCategoryList(source[cohort[0]]);
    });
    return result;
  }

  function categoriesFor(settings, cohort) {
    return (settings.categoriesByCohort && settings.categoriesByCohort[cohort]) || [];
  }

  function categoryPreferences() {
    try {
      var stored = JSON.parse(window.localStorage.getItem(CATEGORY_PREFERENCE_STORAGE_KEY) || "{}");
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    } catch (_error) {
      return {};
    }
  }

  function rememberCategory(cohort, categoryId) {
    if (!cohort || !categoryId) return;
    try {
      var stored = categoryPreferences();
      stored[String(cohort).toUpperCase()] = String(categoryId);
      window.localStorage.setItem(CATEGORY_PREFERENCE_STORAGE_KEY, JSON.stringify(stored));
    } catch (_error) {
      // The in-memory selection still remains stable if browser storage is unavailable.
    }
  }

  function preferredCategoryId(settings, cohort, fallback) {
    var enabled = categoriesFor(settings, cohort).filter(function (category) { return category.enabled; });
    var remembered = categoryPreferences()[String(cohort).toUpperCase()];
    if (enabled.some(function (category) { return category.id === remembered; })) return remembered;
    if (enabled.some(function (category) { return category.id === fallback; })) return fallback;
    return enabled[0] ? enabled[0].id : "";
  }

  function parseEnabledCohorts(value, fallback) {
    value = parseMaybeJson(value);
    if (typeof value === "string") value = value.split(",");
    var requested = new Set(Array.isArray(value) ? value.map(function (item) {
      return String(item || "").trim().toUpperCase();
    }) : []);
    var result = COHORTS.filter(function (item) { return requested.has(item[0]); }).map(function (item) { return item[0]; });
    return result.length ? result : fallback.slice();
  }

  function settingsFromConfiguration(configuration) {
    var source = asObject(configuration);
    var initialDeviation = number(source.initialDeviation, 350, 30, 1000);
    var deviationFloor = number(source.deviationFloor, 30, 1, initialDeviation);
    var cohort = String(source.defaultCohort || "FEMALE").toUpperCase();
    if (!COHORTS.some(function (item) { return item[0] === cohort; })) cohort = "FEMALE";
    var enabledCohorts = parseEnabledCohorts(source.enabledCohorts, [cohort]);
    if (enabledCohorts.indexOf(cohort) === -1) cohort = enabledCohorts[0];
    var confidenceGoal = String(source.confidenceGoal || "ranking").toLowerCase();
    if (["all", "ranking", "top"].indexOf(confidenceGoal) === -1) confidenceGoal = "ranking";
    return {
      categoriesByCohort: parseCategoriesByCohort(source.categories),
      defaultCohort: cohort,
      enabledCohorts: enabledCohorts,
      showLeaderboardsInMenu: DirtyPlugins.values.coerceBoolean(source.showLeaderboardsInMenu, true),
      showRatingsBeforeVote: DirtyPlugins.values.coerceBoolean(source.showRatingsBeforeVote, false),
      hidePerformerImages: DirtyPlugins.values.coerceBoolean(source.hidePerformerImages, false),
      includePerformersWithoutImages: DirtyPlugins.values.coerceBoolean(source.includePerformersWithoutImages, false),
      confidenceGoal: confidenceGoal,
      confidenceTopN: integer(source.confidenceTopN, 20, 1, 1000),
      avoidRepeatWindow: integer(source.avoidRepeatWindow, 12, 0, 100),
      calibrationPercent: integer(source.calibrationPercent, 10, 0, 100),
      initialRating: number(source.initialRating, 1000, -100000, 100000),
      initialDeviation: initialDeviation,
      initialVolatility: number(source.initialVolatility, 0.06, 0.0001, 1),
      evidenceWeight: number(source.evidenceWeight, 2, 1, 3),
      tau: number(source.tau, 0.5, 0.01, 2),
      deviationFloor: deviationFloor,
      provisionalDeviation: number(source.provisionalDeviation, 100, deviationFloor, initialDeviation),
    };
  }

  function refreshOverallSortSettings() {
    return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), loadRatingIndex()]).then(function (values) {
      overallSortSettings = settingsFromConfiguration(values[0]);
      notifyRatingListeners();
    }).catch(function (error) {
      console.error("DirtyRank could not refresh Overall Elo sort settings", error);
    });
  }

  function subscribeToOverallSortSettings(listener) {
    overallSortListeners.add(listener);
    return function () { overallSortListeners.delete(listener); };
  }

  function serializedSettings(settings) {
    return {
      categories: JSON.stringify(Object.keys(settings.categoriesByCohort).reduce(function (result, cohort) {
        result[cohort] = settings.categoriesByCohort[cohort].map(function (category) {
          return {
            id: category.id,
            name: String(category.name || "").trim(),
            description: String(category.description || "").trim(),
            enabled: Boolean(category.enabled),
            weight: number(category.weight, 1, 0.01, 1000),
          };
        });
        return result;
      }, {})),
      defaultCohort: settings.defaultCohort,
      enabledCohorts: JSON.stringify(settings.enabledCohorts),
      showLeaderboardsInMenu: Boolean(settings.showLeaderboardsInMenu),
      showRatingsBeforeVote: Boolean(settings.showRatingsBeforeVote),
      hidePerformerImages: Boolean(settings.hidePerformerImages),
      includePerformersWithoutImages: Boolean(settings.includePerformersWithoutImages),
      confidenceGoal: settings.confidenceGoal,
      confidenceTopN: settings.confidenceTopN,
      avoidRepeatWindow: settings.avoidRepeatWindow,
      calibrationPercent: settings.calibrationPercent,
      initialRating: settings.initialRating,
      initialDeviation: settings.initialDeviation,
      initialVolatility: settings.initialVolatility,
      evidenceWeight: settings.evidenceWeight,
      tau: settings.tau,
      deviationFloor: settings.deviationFloor,
      provisionalDeviation: settings.provisionalDeviation,
    };
  }

  function comparableSettings(settings) {
    return JSON.stringify(serializedSettings(settings));
  }

  function runOperation(args) {
    return DirtyPlugins.runPluginOperation(PLUGIN_ID, args);
  }

  function notifyRatingListeners() {
    overallSortRevision += 1;
    overallSortListeners.forEach(function (listener) { listener(overallSortRevision); });
  }

  function applyRatingIndex(payload) {
    var states = payload && payload.states && typeof payload.states === "object" ? payload.states : {};
    ratingStateIndex.clear();
    Object.keys(states).forEach(function (performerId) {
      ratingStateIndex.set(String(performerId), states[performerId]);
    });
    ratingIndexRevision = Number(payload && payload.revision) || 0;
    notifyRatingListeners();
    return payload;
  }

  function loadRatingIndex() {
    if (ratingIndexPromise) return ratingIndexPromise;
    ratingIndexPromise = runOperation({ mode: "loadAll" })
      .then(applyRatingIndex)
      .finally(function () { ratingIndexPromise = null; });
    return ratingIndexPromise;
  }

  function queryPerformers() {
    return DirtyPlugins.graphql(
      "query DirtyRankPerformers($filter:FindFilterType){" +
        "findPerformers(filter:$filter){count performers{" +
          "id name gender image_path scene_count" +
        "}}}",
      { filter: { per_page: -1, sort: "name", direction: "ASC" } }
    ).then(function (data) {
      return (data.findPerformers && data.findPerformers.performers) || [];
    });
  }

  function loadPreferredMedia(performerId) {
    var cacheKey = String(performerId);
    if (performerMediaCache.has(cacheKey)) return performerMediaCache.get(cacheKey);
    var request = DirtyPlugins.graphql(
      "query DirtyRankPreferredMedia($filter:FindFilterType,$sceneFilter:SceneFilterType,$markerFilter:SceneMarkerFilterType){" +
        "top:findScenes(filter:$filter,scene_filter:$sceneFilter){scenes{" +
          "id title rating100 paths{stream} sceneStreams{url mime_type label}" +
        "}}" +
        "markers:findSceneMarkers(filter:{per_page:-1},scene_marker_filter:$markerFilter){scene_markers{" +
          "id title seconds end_seconds scene{id title rating100 paths{stream} sceneStreams{url mime_type label}}" +
        "}}}",
      {
        filter: { per_page: 1, sort: "rating", direction: "DESC" },
        sceneFilter: { performers: { value: [cacheKey], modifier: "INCLUDES" } },
        markerFilter: { performers: { value: [cacheKey], modifier: "INCLUDES" } },
      }
    ).then(function (data) {
      var markers = data.markers && Array.isArray(data.markers.scene_markers)
        ? data.markers.scene_markers.slice()
        : [];
      markers.sort(function (left, right) {
        var leftRating = Number(left.scene && left.scene.rating100);
        var rightRating = Number(right.scene && right.scene.rating100);
        if (!Number.isFinite(leftRating)) leftRating = -1;
        if (!Number.isFinite(rightRating)) rightRating = -1;
        if (rightRating !== leftRating) return rightRating - leftRating;
        return Number(left.seconds || 0) - Number(right.seconds || 0);
      });
      if (markers[0] && markers[0].scene) {
        return Object.assign({}, markers[0].scene, {
          marker: {
            id: markers[0].id,
            title: markers[0].title,
            seconds: Number(markers[0].seconds) || 0,
            end_seconds: Number(markers[0].end_seconds) || null,
          },
        });
      }
      return data.top && data.top.scenes && data.top.scenes[0] || null;
    }).catch(function (error) {
      performerMediaCache.delete(cacheKey);
      throw error;
    });
    performerMediaCache.set(cacheKey, request);
    return request;
  }

  function scenePlaybackUrl(scene) {
    var streams = scene && Array.isArray(scene.sceneStreams) ? scene.sceneStreams : [];
    var directPath = scene && scene.paths && scene.paths.stream;
    var preferred = streams.find(function (stream) {
      return stream.mime_type === "video/mp4" && /direct/i.test(stream.label || "");
    }) || streams.find(function (stream) {
      return stream.mime_type === "video/mp4" && /720p/i.test(stream.label || "");
    });
    return directPath || preferred && preferred.url || "";
  }

  function parseState(performer) {
    var state = performer && ratingStateIndex.get(String(performer.id));
    if (!state || typeof state !== "object" || Array.isArray(state)) return { version: 2, revision: ratingIndexRevision, pools: {} };
    return {
      version: 2,
      revision: Number(state.revision) || 0,
      pools: state.pools && typeof state.pools === "object" ? state.pools : {},
    };
  }

  function keyFor(categoryId, cohort) {
    return slug(categoryId) + "|" + String(cohort || "").toUpperCase();
  }

  function poolFor(performer, categoryId, cohort, settings) {
    var pool = parseState(performer).pools[keyFor(categoryId, cohort)];
    if (!pool || typeof pool !== "object") {
      return {
        rating: settings.initialRating,
        deviation: settings.initialDeviation,
        volatility: settings.initialVolatility,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
    }
    return {
      rating: number(pool.rating, settings.initialRating, -1000000, 1000000),
      deviation: number(pool.deviation, settings.initialDeviation, settings.deviationFloor, settings.initialDeviation),
      volatility: number(pool.volatility, settings.initialVolatility, 0.0001, 2),
      matches: integer(pool.matches, 0, 0, 2000000000),
      wins: integer(pool.wins, 0, 0, 2000000000),
      losses: integer(pool.losses, 0, 0, 2000000000),
      draws: integer(pool.draws, 0, 0, 2000000000),
      lastRatedAt: pool.lastRatedAt || null,
    };
  }

  function excellentDeviationThreshold(settings) {
    return Math.max(settings.deviationFloor, settings.provisionalDeviation * 0.6);
  }

  function precisionTier(pool, settings) {
    if (!pool || pool.matches <= 0 || pool.deviation > settings.provisionalDeviation) {
      return { id: "provisional", label: "Provisional" };
    }
    if (pool.deviation <= excellentDeviationThreshold(settings)) {
      return { id: "excellent", label: "Excellent" };
    }
    return { id: "refined", label: "Refined" };
  }

  function PrecisionBadge(props) {
    var tier = props.pool.precision || precisionTier(props.pool, props.settings);
    return h("span", {
      className: "badge badge-pill text-uppercase dirty-rank-status-" + tier.id,
      title: tier.label + " precision · RD " + props.pool.deviation.toFixed(1),
    }, tier.label);
  }

  function updatePerformerState(performer, state) {
    if (performer && state) {
      ratingStateIndex.set(String(performer.id), state);
      ratingIndexRevision = Math.max(ratingIndexRevision, Number(state.revision) || 0);
      notifyRatingListeners();
    }
    return performer;
  }

  function categoryEligible(performer, category, settings, cohort) {
    if (String(performer.gender || "").toUpperCase() !== cohort) return false;
    if (!settings.includePerformersWithoutImages && !performer.image_path) return false;
    return Boolean(category && category.enabled);
  }

  function pairToken(left, right) {
    return [String(left.id), String(right.id)].sort().join(":");
  }

  function rankPerformers(performers, categoryId, cohort, settings) {
    return performers.filter(function (performer) {
      return String(performer.gender || "").toUpperCase() === cohort &&
        poolFor(performer, categoryId, cohort, settings).matches > 0;
    }).sort(function (left, right) {
      return poolFor(right, categoryId, cohort, settings).rating -
        poolFor(left, categoryId, cohort, settings).rating;
    });
  }

  function overallPoolFor(performer, cohort, settings) {
    var categories = categoriesFor(settings, cohort).filter(function (category) {
      return category.enabled && Number(category.weight) > 0;
    });
    var totalWeight = categories.reduce(function (sum, category) {
      return sum + Number(category.weight);
    }, 0);
    if (!totalWeight) {
      return { rating: settings.initialRating, deviation: settings.initialDeviation, matches: 0 };
    }
    var totals = categories.reduce(function (result, category) {
      var pool = poolFor(performer, category.id, cohort, settings);
      var weight = Number(category.weight);
      result.rating += pool.rating * weight;
      result.deviation += pool.deviation * weight;
      result.matches += pool.matches;
      return result;
    }, { rating: 0, deviation: 0, matches: 0 });
    return {
      rating: totals.rating / totalWeight,
      deviation: totals.deviation / totalWeight,
      matches: totals.matches,
    };
  }

  function rankOverallPerformers(performers, cohort, settings) {
    return performers.filter(function (performer) {
      return String(performer.gender || "").toUpperCase() === cohort &&
        overallPoolFor(performer, cohort, settings).matches > 0;
    }).sort(function (left, right) {
      return overallPoolFor(right, cohort, settings).rating -
        overallPoolFor(left, cohort, settings).rating;
    });
  }

  function leaderboardPoolFor(performer, leaderboardId, cohort, settings) {
    if (leaderboardId !== OVERALL_LEADERBOARD_ID) {
      var categoryPool = poolFor(performer, leaderboardId, cohort, settings);
      var categoryPrecision = precisionTier(categoryPool, settings);
      return Object.assign({}, categoryPool, {
        precision: categoryPrecision,
        stable: categoryPrecision.id !== "provisional",
      });
    }

    var categories = categoriesFor(settings, cohort).filter(function (category) {
      return category.enabled && Number(category.weight) > 0;
    });
    var overall = overallPoolFor(performer, cohort, settings);
    var totals = categories.reduce(function (result, category) {
      var pool = poolFor(performer, category.id, cohort, settings);
      result.wins += pool.wins;
      result.losses += pool.losses;
      result.draws += pool.draws;
      return result;
    }, { wins: 0, losses: 0, draws: 0 });
    var categoryPrecisions = categories.map(function (category) {
      return precisionTier(poolFor(performer, category.id, cohort, settings), settings);
    });
    var overallPrecision = categoryPrecisions.length > 0 && categoryPrecisions.every(function (precision) {
      return precision.id === "excellent";
    }) ? { id: "excellent", label: "Excellent" } : categoryPrecisions.length > 0 && categoryPrecisions.every(function (precision) {
      return precision.id !== "provisional";
    }) ? { id: "refined", label: "Refined" } : { id: "provisional", label: "Provisional" };
    return Object.assign({}, overall, totals, {
      precision: overallPrecision,
      stable: categories.length > 0 && categories.every(function (category) {
        var pool = poolFor(performer, category.id, cohort, settings);
        return pool.matches > 0 && pool.deviation <= settings.provisionalDeviation;
      }),
    });
  }

  function leaderboardData(performers, leaderboardId, cohort, settings) {
    var eligible = performers.filter(function (performer) {
      return String(performer.gender || "").toUpperCase() === cohort &&
        (settings.includePerformersWithoutImages || Boolean(performer.image_path));
    });
    var ranked = leaderboardId === OVERALL_LEADERBOARD_ID
      ? rankOverallPerformers(eligible, cohort, settings)
      : rankPerformers(eligible, leaderboardId, cohort, settings);
    var pools = ranked.map(function (performer) {
      return leaderboardPoolFor(performer, leaderboardId, cohort, settings);
    });
    var deviations = pools.map(function (pool) { return pool.deviation; }).sort(function (left, right) { return left - right; });
    var completedBattles = Math.floor(pools.reduce(function (sum, pool) { return sum + pool.matches; }, 0) / 2);
    var drawBattles = pools.reduce(function (sum, pool) { return sum + pool.draws; }, 0) / 2;
    return {
      eligible: eligible.length,
      ranked: ranked,
      stats: {
        completedBattles: completedBattles,
        coverage: eligible.length ? ranked.length / eligible.length * 100 : 0,
        drawRate: completedBattles ? drawBattles / completedBattles * 100 : 0,
        medianDeviation: deviations.length ? deviations[Math.floor(deviations.length / 2)] : settings.initialDeviation,
        rated: ranked.length,
        ratingSpread: ranked.length > 1
          ? leaderboardPoolFor(ranked[0], leaderboardId, cohort, settings).rating -
            leaderboardPoolFor(ranked[ranked.length - 1], leaderboardId, cohort, settings).rating
          : 0,
        stable: pools.filter(function (pool) { return pool.stable; }).length,
        excellent: pools.filter(function (pool) { return pool.precision.id === "excellent"; }).length,
        refined: pools.filter(function (pool) { return pool.precision.id === "refined"; }).length,
      },
    };
  }

  function overallSortData(performer, settings) {
    var cohort = String(performer.gender || "").toUpperCase();
    var pool = overallPoolFor(performer, cohort, settings);
    return {
      performer: performer,
      rating: pool.rating,
      rated: pool.matches > 0,
    };
  }

  function sortPerformersByOverall(performers, direction, settings) {
    var descending = String(direction || "ASC").toUpperCase() === "DESC";
    return performers.map(function (performer) {
      return overallSortData(performer, settings);
    }).sort(function (left, right) {
      if (left.rated !== right.rated) return left.rated ? -1 : 1;
      if (left.rated && right.rated && left.rating !== right.rating) {
        return descending ? right.rating - left.rating : left.rating - right.rating;
      }
      var nameOrder = String(left.performer.name || "").localeCompare(
        String(right.performer.name || ""),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
      if (nameOrder) return nameOrder;
      return String(left.performer.id).localeCompare(String(right.performer.id), undefined, { numeric: true });
    }).map(function (item) { return item.performer; });
  }

  function isPerformerListRoute() {
    return window.location.pathname === PERFORMERS_ROUTE_PATH;
  }

  function addOverallSortOption(filter) {
    var options = filter && filter.options && filter.options.sortByOptions;
    if (!Array.isArray(options)) return;
    if (options.some(function (option) { return option.value === OVERALL_SORT_VALUE; })) return;
    options.push({
      messageID: OVERALL_SORT_MESSAGE_ID,
      value: OVERALL_SORT_VALUE,
    });
  }

  function applyOverallPerformerFilter(filter, originalHook) {
    addOverallSortOption(filter);
    var effective = originalHook ? originalHook(filter) : filter;
    if (!effective) effective = filter;
    if (filter.sortBy !== OVERALL_SORT_VALUE) return effective;

    var queryFilter = effective.clone();
    queryFilter.sortBy = "name";
    queryFilter.sortDirection = "ASC";
    queryFilter.currentPage = 1;
    queryFilter.itemsPerPage = -1;
    queryFilter[OVERALL_SORT_ACTIVE] = true;
    queryFilter[OVERALL_SORT_PAGE] = filter.currentPage;
    queryFilter[OVERALL_SORT_PAGE_SIZE] = filter.itemsPerPage;
    queryFilter[OVERALL_SORT_DIRECTION] = filter.sortDirection;
    return queryFilter;
  }

  function defaultOverallPerformerFilterHook(filter) {
    return applyOverallPerformerFilter(filter, null);
  }

  function overallPerformerFilterHook(originalHook) {
    if (typeof originalHook !== "function") return defaultOverallPerformerFilterHook;
    if (!overallFilterHookCache.has(originalHook)) {
      overallFilterHookCache.set(originalHook, function (filter) {
        return applyOverallPerformerFilter(filter, originalHook);
      });
    }
    return overallFilterHookCache.get(originalHook);
  }

  function DirtyRankPerformerListShell(props) {
    var intl = useIntl();
    if (intl.messages && !Object.prototype.hasOwnProperty.call(intl.messages, OVERALL_SORT_MESSAGE_ID)) {
      intl.messages[OVERALL_SORT_MESSAGE_ID] = OVERALL_SORT_LABEL;
    }
    return props.children;
  }

  function DirtyRankSortedPerformerList(props) {
    var revisionState = useState(overallSortRevision);
    var revision = revisionState[0];
    var setRevision = revisionState[1];
    useEffect(function () { return subscribeToOverallSortSettings(setRevision); }, []);

    var listProps = props.listProps;
    var filter = listProps.filter;
    var currentPage = Number(filter[OVERALL_SORT_PAGE]) || 1;
    var pageSize = Number(filter[OVERALL_SORT_PAGE_SIZE]) || 40;
    var direction = filter[OVERALL_SORT_DIRECTION] || "ASC";
    var pagePerformers = useMemo(function () {
      var sorted = sortPerformersByOverall(
        Array.isArray(listProps.performers) ? listProps.performers : [],
        direction,
        overallSortSettings
      );
      var start = Math.max(0, (currentPage - 1) * pageSize);
      return sorted.slice(start, start + pageSize);
    }, [currentPage, direction, listProps.performers, pageSize, revision]);

    return props.next(Object.assign({}, listProps, { performers: pagePerformers }));
  }

  function representativeOpponent(pool, opponentDeviation, settings) {
    return {
      rating: pool.rating,
      deviation: opponentDeviation,
      volatility: settings.initialVolatility,
      matches: 1,
    };
  }

  function estimatedMatchesToConfidence(pool, targetDeviation, opponent, settings) {
    if (pool.matches > 0 && pool.deviation <= targetDeviation) return 0;
    var subject = Object.assign({}, pool);
    var counterpart = Object.assign({}, opponent || representativeOpponent(pool, settings.initialDeviation, settings));
    for (var matches = 1; matches <= 1000; matches += 1) {
      var nextSubjectDeviation = expectedDeviationAfterBattle(subject, counterpart, settings);
      var nextOpponentDeviation = expectedDeviationAfterBattle(counterpart, subject, settings);
      subject = Object.assign({}, subject, { deviation: nextSubjectDeviation, matches: subject.matches + 1 });
      counterpart = Object.assign({}, counterpart, { deviation: nextOpponentDeviation, matches: counterpart.matches + 1 });
      if (nextSubjectDeviation <= targetDeviation) return matches;
    }
    return 1000;
  }

  function confidenceGoalLabel(settings) {
    if (settings.confidenceGoal === "all") return "Every performer";
    if (settings.confidenceGoal === "top") return "Top " + settings.confidenceTopN;
    return "Leaderboard order";
  }

  function confidenceProgress(completedBattles, remainingBattles) {
    var total = completedBattles + remainingBattles;
    return total > 0 ? completedBattles / total * 100 : 0;
  }

  function categoryEntries(performers, category, cohort, settings) {
    return performers.filter(function (performer) {
      return categoryEligible(performer, category, settings, cohort);
    }).map(function (performer) {
      return {
        performer: performer,
        pool: poolFor(performer, category.id, cohort, settings),
      };
    }).sort(function (left, right) {
      if (right.pool.rating !== left.pool.rating) return right.pool.rating - left.pool.rating;
      if (left.pool.matches !== right.pool.matches) return right.pool.matches - left.pool.matches;
      return String(left.performer.name || "").localeCompare(String(right.performer.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }

  function orderBoundary(left, right, settings, kind) {
    var bothRated = left.pool.matches > 0 && right.pool.matches > 0;
    var gap = Math.max(0, left.pool.rating - right.pool.rating);
    var combinedDeviation = Math.sqrt(
      left.pool.deviation * left.pool.deviation + right.pool.deviation * right.pool.deviation
    );
    var separation = combinedDeviation > 0 ? gap / combinedDeviation : ORDER_CONFIDENCE_Z;
    var probabilityProgress = bothRated ? Math.min(1, separation / ORDER_CONFIDENCE_Z) : 0;
    var refinedTie = bothRated && separation < ORDER_CONFIDENCE_Z &&
      left.pool.deviation <= settings.provisionalDeviation &&
      right.pool.deviation <= settings.provisionalDeviation;
    var tieProgress = bothRated && separation < ORDER_CONFIDENCE_Z
      ? Math.min(1, settings.provisionalDeviation / Math.max(left.pool.deviation, right.pool.deviation))
      : 0;
    return {
      confident: bothRated && (
        separation >= ORDER_CONFIDENCE_Z ||
        refinedTie
      ),
      kind: kind,
      left: left,
      progress: Math.max(probabilityProgress, tieProgress),
      right: right,
    };
  }

  function confidenceBoundaries(entries, settings) {
    var boundaries = [];
    if (settings.confidenceGoal === "all" || entries.length < 2) return boundaries;
    if (settings.confidenceGoal === "ranking") {
      for (var index = 0; index < entries.length - 1; index += 1) {
        boundaries.push(orderBoundary(entries[index], entries[index + 1], settings, "order"));
      }
      return boundaries;
    }

    var topCount = Math.min(settings.confidenceTopN, entries.length);
    for (var topIndex = 0; topIndex < topCount - 1; topIndex += 1) {
      boundaries.push(orderBoundary(entries[topIndex], entries[topIndex + 1], settings, "top-order"));
    }
    if (topCount < entries.length) {
      var cutoff = entries[topCount - 1];
      for (var outsideIndex = topCount; outsideIndex < entries.length; outsideIndex += 1) {
        boundaries.push(orderBoundary(cutoff, entries[outsideIndex], settings, "top-membership"));
      }
    }
    return boundaries;
  }

  function categoryConfidence(performers, category, cohort, settings) {
    var entries = categoryEntries(performers, category, cohort, settings);
    var activeWeights = new Map();
    entries.forEach(function (entry) { activeWeights.set(String(entry.performer.id), 0.02); });
    if (!entries.length) {
      return {
        activeWeights: activeWeights,
        completedBattles: 0,
        eligible: 0,
        entries: entries,
        excellent: 0,
        established: 0,
        goalLabel: confidenceGoalLabel(settings),
        goalTotal: 0,
        goalUnit: "performers",
        progress: 0,
        rated: 0,
        refined: 0,
        remainingBattles: 0,
      };
    }

    var pools = entries.map(function (entry) { return entry.pool; });
    var deviations = pools.map(function (pool) { return pool.deviation; }).sort(function (left, right) { return left - right; });
    var opponentDeviation = deviations[Math.floor(deviations.length / 2)] || settings.initialDeviation;
    var rated = pools.filter(function (pool) { return pool.matches > 0; }).length;
    var refined = pools.filter(function (pool) {
      return precisionTier(pool, settings).id !== "provisional";
    }).length;
    var excellent = pools.filter(function (pool) {
      return precisionTier(pool, settings).id === "excellent";
    }).length;
    var totalMatches = pools.reduce(function (sum, pool) { return sum + pool.matches; }, 0);

    if (settings.confidenceGoal === "all") {
      var established = 0;
      var remainingParticipations = 0;
      entries.forEach(function (entry) {
        var pool = entry.pool;
        var stable = pool.matches > 0 && pool.deviation <= settings.provisionalDeviation;
        if (stable) established += 1;
        if (!stable) {
          var uncertainty = Math.max(1, pool.deviation / settings.provisionalDeviation);
          activeWeights.set(String(entry.performer.id), pool.matches > 0 ? Math.min(12, 1 + uncertainty * uncertainty) : 8);
        }
        remainingParticipations += estimatedMatchesToConfidence(
          pool,
          settings.provisionalDeviation,
          representativeOpponent(pool, opponentDeviation, settings),
          settings
        );
      });
      var allCompletedBattles = Math.floor(totalMatches / 2);
      var allRemainingBattles = Math.ceil(remainingParticipations / 2);
      return {
        activeWeights: activeWeights,
        completedBattles: allCompletedBattles,
        eligible: entries.length,
        entries: entries,
        excellent: excellent,
        established: established,
        goalLabel: confidenceGoalLabel(settings),
        goalTotal: entries.length,
        goalUnit: "performers",
        progress: confidenceProgress(allCompletedBattles, allRemainingBattles),
        rated: rated,
        refined: refined,
        remainingBattles: allRemainingBattles,
      };
    }

    var boundaries = confidenceBoundaries(entries, settings);
    var stableBoundaries = boundaries.filter(function (boundary) { return boundary.confident; }).length;
    var needs = new Map();

    function addWeight(entry, amount) {
      var id = String(entry.performer.id);
      activeWeights.set(id, Math.min(12, (activeWeights.get(id) || 0) + amount));
    }

    function requireMatches(entry, opponent) {
      var id = String(entry.performer.id);
      var required = estimatedMatchesToConfidence(
        entry.pool,
        settings.provisionalDeviation,
        opponent ? opponent.pool : representativeOpponent(entry.pool, opponentDeviation, settings),
        settings
      );
      needs.set(id, Math.max(needs.get(id) || 0, Math.max(1, required)));
    }

    entries.forEach(function (entry) {
      if (entry.pool.matches === 0) {
        addWeight(entry, 8);
        requireMatches(entry, null);
      }
    });
    boundaries.forEach(function (boundary) {
      if (boundary.confident) return;
      var priority = 1 + (1 - boundary.progress) * 4;
      addWeight(boundary.left, priority);
      addWeight(boundary.right, priority);
      requireMatches(boundary.left, boundary.right);
      requireMatches(boundary.right, boundary.left);
    });

    var remainingParticipations = Array.from(needs.values()).reduce(function (sum, value) { return sum + value; }, 0);
    var completedBattles = Math.floor(totalMatches / 2);
    var remainingBattles = Math.ceil(remainingParticipations / 2);
    return {
      activeWeights: activeWeights,
      completedBattles: completedBattles,
      eligible: entries.length,
      entries: entries,
      excellent: excellent,
      established: stableBoundaries,
      goalLabel: confidenceGoalLabel(settings),
      goalTotal: boundaries.length,
      goalUnit: settings.confidenceGoal === "top" ? "top-list boundaries" : "order/tie boundaries",
      progress: confidenceProgress(completedBattles, remainingBattles),
      rated: rated,
      refined: refined,
      remainingBattles: remainingBattles,
    };
  }

  function expectedDeviationAfterBattle(pool, opponent, settings) {
    var phi = pool.deviation / GLICKO_SCALE;
    var phiStar = Math.sqrt(phi * phi + pool.volatility * pool.volatility);
    var opponentPhi = opponent.deviation / GLICKO_SCALE;
    var g = 1 / Math.sqrt(1 + 3 * opponentPhi * opponentPhi / (Math.PI * Math.PI));
    var expected = 1 / (1 + Math.exp(-g * (pool.rating - opponent.rating) / GLICKO_SCALE));
    var information = g * g * expected * (1 - expected) * settings.evidenceWeight;
    var nextPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + information);
    return Math.max(settings.deviationFloor, nextPhi * GLICKO_SCALE);
  }

  function pairInformationGain(leftPool, rightPool, settings) {
    var nextLeftDeviation = expectedDeviationAfterBattle(leftPool, rightPool, settings);
    var nextRightDeviation = expectedDeviationAfterBattle(rightPool, leftPool, settings);
    var leftGain = Math.max(0, Math.log(leftPool.deviation / nextLeftDeviation));
    var rightGain = Math.max(0, Math.log(rightPool.deviation / nextRightDeviation));
    return {
      entropyGain: leftGain + rightGain,
      leftGain: leftGain,
      nextLeftDeviation: nextLeftDeviation,
      nextRightDeviation: nextRightDeviation,
      rdReduction: Math.max(0, leftPool.deviation - nextLeftDeviation) + Math.max(0, rightPool.deviation - nextRightDeviation),
      rightGain: rightGain,
    };
  }

  function selectPair(performers, category, cohort, settings, recentTokens) {
    var confidence = categoryConfidence(performers, category, cohort, settings);
    var eligible = confidence.entries.map(function (entry) { return entry.performer; });
    if (eligible.length < 2) return { pair: null, eligible: eligible.length, ranks: {} };

    var rankList = rankPerformers(eligible, category.id, cohort, settings);
    var ranks = {};
    rankList.forEach(function (performer, index) { ranks[performer.id] = index + 1; });
    var focus = confidence.entries.slice().sort(function (left, right) {
      var priorityDifference = (confidence.activeWeights.get(String(right.performer.id)) || 0) -
        (confidence.activeWeights.get(String(left.performer.id)) || 0);
      if (priorityDifference) return priorityDifference;
      return right.pool.deviation - left.pool.deviation;
    }).slice(0, MATCHMAKER_FOCUS_LIMIT);
    var recent = new Set(recentTokens.slice(-settings.avoidRepeatWindow));
    var calibration = Math.random() * 100 < settings.calibrationPercent;
    var evaluated = new Set();
    var best = null;

    focus.forEach(function (leftEntry) {
      confidence.entries.forEach(function (rightEntry) {
        if (leftEntry.performer.id === rightEntry.performer.id) return;
        var token = pairToken(leftEntry.performer, rightEntry.performer);
        if (evaluated.has(token)) return;
        evaluated.add(token);
        var information = pairInformationGain(leftEntry.pool, rightEntry.pool, settings);
        var leftPriority = 0.25 + (confidence.activeWeights.get(String(leftEntry.performer.id)) || 0);
        var rightPriority = 0.25 + (confidence.activeWeights.get(String(rightEntry.performer.id)) || 0);
        var score = information.leftGain * leftPriority + information.rightGain * rightPriority;
        if (leftEntry.pool.matches === 0 && rightEntry.pool.matches === 0) score *= 1.12;
        if (recent.has(token)) score *= 0.04;
        if (calibration) {
          var ratingDistance = Math.abs(leftEntry.pool.rating - rightEntry.pool.rating);
          score *= 0.8 + Math.min(0.35, ratingDistance / Math.max(1, settings.initialDeviation * 4));
        }
        score *= 0.995 + Math.random() * 0.01;
        if (!best || score > best.score) {
          best = { information: information, left: leftEntry.performer, right: rightEntry.performer, score: score };
        }
      });
    });

    if (!best) return { pair: null, eligible: eligible.length, ranks: ranks };
    var orderedPair = Math.random() < 0.5 ? [best.left, best.right] : [best.right, best.left];
    return {
      calibration: calibration,
      eligible: eligible.length,
      expectedRdReduction: best.information.rdReduction,
      goalLabel: confidence.goalLabel,
      pair: orderedPair,
      ranks: ranks,
    };
  }

  function selectGauntletPair(performers, target, category, cohort, settings, recentTokens) {
    var eligible = performers.filter(function (performer) {
      return categoryEligible(performer, category, settings, cohort);
    });
    var targetEntry = eligible.find(function (performer) { return String(performer.id) === String(target.id); });
    var ranks = {};
    rankPerformers(eligible, category.id, cohort, settings).forEach(function (performer, index) {
      ranks[performer.id] = index + 1;
    });
    if (!targetEntry || eligible.length < 2) return { pair: null, eligible: eligible.length, ranks: ranks };

    var targetPool = poolFor(targetEntry, category.id, cohort, settings);
    var recent = new Set(recentTokens.slice(-settings.avoidRepeatWindow));
    var calibration = Math.random() * 100 < settings.calibrationPercent;
    var best = null;
    eligible.forEach(function (opponent) {
      if (String(opponent.id) === String(targetEntry.id)) return;
      var opponentPool = poolFor(opponent, category.id, cohort, settings);
      var information = pairInformationGain(targetPool, opponentPool, settings);
      var token = pairToken(targetEntry, opponent);
      var score = information.leftGain + information.rightGain * 0.08;
      if (recent.has(token)) score *= 0.04;
      if (calibration) {
        var ratingDistance = Math.abs(targetPool.rating - opponentPool.rating);
        score *= 0.8 + Math.min(0.35, ratingDistance / Math.max(1, settings.initialDeviation * 4));
      }
      score *= 0.995 + Math.random() * 0.01;
      if (!best || score > best.score) {
        best = { information: information, opponent: opponent, score: score };
      }
    });

    return {
      calibration: calibration,
      eligible: eligible.length,
      expectedRdReduction: best ? best.information.leftGain > 0
        ? Math.max(0, targetPool.deviation - best.information.nextLeftDeviation)
        : 0 : 0,
      goalLabel: "Target performer",
      pair: best ? [targetEntry, best.opponent] : null,
      ranks: ranks,
    };
  }

  function battleId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "dirty-rank-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function ratingDelta(after, before) {
    var value = Number(after) - Number(before);
    return (value >= 0 ? "+" : "") + value.toFixed(1);
  }

  function cohortLabel(cohort) {
    var match = COHORTS.find(function (item) { return item[0] === cohort; });
    return match ? match[1] : cohort;
  }

  function PerformerCard(props) {
    var performer = props.performer;
    var pool = props.pool;
    var reveal = props.reveal;
    var showImages = !props.settings.hidePerformerImages;
    var imageState = useState(!showImages || !performer.image_path);
    var imageReady = imageState[0];
    var setImageReady = imageState[1];
    var sceneState = useState(null);
    var scene = sceneState[0];
    var setScene = sceneState[1];
    var sceneLoadingState = useState(false);
    var sceneLoading = sceneLoadingState[0];
    var setSceneLoading = sceneLoadingState[1];
    var sceneErrorState = useState("");
    var sceneError = sceneErrorState[0];
    var setSceneError = sceneErrorState[1];
    var cardMountedRef = useRef(true);
    var showMedia = showImages || Boolean(scene) || sceneLoading;
    useEffect(function () {
      cardMountedRef.current = true;
      return function () { cardMountedRef.current = false; };
    }, []);
    function markerEndSeconds(media) {
      if (!media || !media.marker) return null;
      var start = Number(media.marker.seconds) || 0;
      var end = Number(media.marker.end_seconds);
      return Number.isFinite(end) && end > start ? end : start + 30;
    }
    function startMarkerPlayback(event) {
      if (!scene || !scene.marker) return;
      event.currentTarget.currentTime = Number(scene.marker.seconds) || 0;
      var playResult = event.currentTarget.play();
      if (playResult && typeof playResult.catch === "function") playResult.catch(function () {});
    }
    function keepMarkerPlaybackInRange(event) {
      if (!scene || !scene.marker) return;
      var start = Number(scene.marker.seconds) || 0;
      var end = markerEndSeconds(scene);
      if (event.currentTarget.currentTime < start || event.currentTarget.currentTime >= end) {
        event.currentTarget.currentTime = start;
      }
    }
    function stopAtMarkerEnd(event) {
      var end = markerEndSeconds(scene);
      if (end !== null && event.currentTarget.currentTime >= end) event.currentTarget.pause();
    }
    function chooseFromKeyboard(event) {
      if (props.disabled || event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        props.onChoose();
      }
    }
    function toggleTopScene(event) {
      event.preventDefault();
      event.stopPropagation();
      if (scene) {
        setScene(null);
        setSceneError("");
        return;
      }
      if (sceneLoading) return;
      setSceneLoading(true);
      setSceneError("");
      loadPreferredMedia(performer.id).then(function (result) {
        if (!cardMountedRef.current) return;
        if (!result || !scenePlaybackUrl(result)) {
          setSceneError("No playable scene found.");
          return;
        }
        setScene(result);
      }).catch(function (error) {
        if (!cardMountedRef.current) return;
        setSceneError(error.message || String(error));
      }).finally(function () {
        if (cardMountedRef.current) setSceneLoading(false);
      });
    }
    return h(
      "div",
      {
        "aria-disabled": props.disabled ? "true" : undefined,
        "aria-label": "Choose " + performer.name,
        className: "dirty-rank-card" + (showMedia ? "" : " dirty-rank-card-no-image") + (props.gauntletTarget ? " dirty-rank-card-gauntlet-target" : "") + (props.disabled ? " dirty-rank-card-disabled" : ""),
        onClick: props.disabled ? undefined : props.onChoose,
        onKeyDown: chooseFromKeyboard,
        role: "button",
        tabIndex: props.disabled ? -1 : 0,
      },
      showMedia && h(
        "div",
        {
          className: "dirty-rank-image-wrap" + (imageReady ? " dirty-rank-image-ready" : "") + (scene ? " dirty-rank-scene-playing" : ""),
          onClick: scene ? function (event) { event.stopPropagation(); } : undefined,
          onKeyDown: scene ? function (event) { event.stopPropagation(); } : undefined,
        },
        scene
          ? h("video", {
              autoPlay: !scene.marker,
              className: "dirty-rank-scene-player",
              controls: true,
              onLoadedMetadata: startMarkerPlayback,
              onPlay: keepMarkerPlaybackInRange,
              onTimeUpdate: stopAtMarkerEnd,
              playsInline: true,
              preload: "metadata",
              src: scenePlaybackUrl(scene),
            })
          : showImages && performer.image_path
          ? h("img", {
              alt: "",
              className: "dirty-rank-image",
              loading: "eager",
              onError: function () { setImageReady(true); },
              onLoad: function () { setImageReady(true); },
              src: performer.image_path,
            })
          : h("div", { className: "dirty-rank-image-placeholder d-flex flex-column align-items-center justify-content-center" },
              h("span", null, sceneLoading ? "…" : "◇"),
              h("span", null, sceneLoading ? "Loading top scene…" : "No performer image")
            ),
        !scene && showImages && performer.image_path && !imageReady && h("div", { "aria-hidden": "true", className: "dirty-rank-image-loading" }),
        scene && h("div", { className: "dirty-rank-scene-caption" },
          h("span", null, scene.marker
            ? "Marker · " + (scene.marker.title || scene.title || "Untitled")
            : scene.title || "Top-rated scene"),
          Number.isFinite(scene.rating100) && h("span", null, "Rating " + scene.rating100)
        ),
        reveal && props.rank && h("span", { className: "dirty-rank-rank" }, "#" + props.rank)
      ),
      !showImages && reveal && props.rank && h("span", { className: "dirty-rank-rank" }, "#" + props.rank),
      props.gauntletTarget && h("span", { className: "dirty-rank-gauntlet-target" }, "Gauntlet target"),
      h(
        "div",
        { className: "dirty-rank-card-body" },
        h("h2", { className: "dirty-rank-performer-name" },
          h(NavLink, {
            className: "dirty-rank-performer-link",
            onClick: function (event) { event.stopPropagation(); },
            title: "Open " + performer.name,
            to: "/performers/" + performer.id,
          }, performer.name)
        ),
        h("div", { className: "dirty-rank-card-meta d-flex flex-wrap align-items-center" },
          h("span", null, Number(performer.scene_count || 0).toLocaleString() + " scenes"),
          h("span", null, pool.matches.toLocaleString() + " battles")
        ),
        h("div", { className: "dirty-rank-scene-actions" },
          h("button", {
            className: "btn btn-sm btn-secondary dirty-ui-button dirty-rank-play-scene",
            disabled: props.disabled || sceneLoading || Number(performer.scene_count || 0) < 1,
            onClick: toggleTopScene,
            type: "button",
          }, sceneLoading ? "Loading…" : scene ? (scene.marker ? "Close marker" : "Close top scene") : "▶ Play top scene")
        ),
        sceneError && h("div", { className: "dirty-rank-scene-error dirty-ui-text-error", role: "alert" }, sceneError),
        h("div", { className: "dirty-rank-rating-row d-flex flex-wrap align-items-center" },
          reveal
            ? h(Fragment, null,
                h("span", { className: "dirty-rank-rating-value" }, Math.round(pool.rating).toLocaleString()),
                h("span", { className: "dirty-rank-card-meta" }, "RD " + pool.deviation.toFixed(1)),
                h(PrecisionBadge, { pool: pool, settings: props.settings })
              )
            : h("span", { className: "dirty-rank-hidden-rating" }, "Rating revealed after your choice")
        )
      )
    );
  }

  function Leaderboard(props) {
    var ranked = leaderboardData(
      props.performers,
      props.category.id,
      props.cohort,
      props.settings
    ).ranked.slice(0, 12);
    return h(
      "aside",
      { className: "dirty-rank-leaderboard dirty-ui-feature-card", "aria-label": "DirtyRank leaderboard" },
      h("div", { className: "dirty-rank-leaderboard-header" },
        h("div", { className: "dirty-rank-eyebrow" }, cohortLabel(props.cohort)),
        h("h2", null, props.category.name + " standings"),
        h("div", { className: "dirty-rank-leaderboard-note" }, "Current battle category · top 12")
      ),
      !ranked.length && h("div", { className: "dirty-rank-empty-standings" }, "Complete a battle to start this leaderboard."),
      ranked.map(function (performer, index) {
        var pool = leaderboardPoolFor(performer, props.category.id, props.cohort, props.settings);
        return h("div", { className: "dirty-rank-standing", key: performer.id },
          h("span", { className: "dirty-rank-standing-position" }, index + 1),
          h("span", { className: "dirty-rank-standing-name text-truncate", title: performer.name }, performer.name),
          h("span", { className: "dirty-rank-standing-rating" }, Math.round(pool.rating).toLocaleString() + (pool.precision.id === "provisional" ? "?" : ""))
        );
      })
    );
  }

  function ConfidenceIndicator(props) {
    var confidence = categoryConfidence(props.performers, props.category, props.cohort, props.settings);
    var target = props.settings.provisionalDeviation;
    var battlePurpose = props.settings.confidenceGoal === "all"
      ? "rating-refinement"
      : props.settings.confidenceGoal === "top" ? "top-list" : "order-separating";
    var remaining = confidence.remainingBattles > 0
      ? "≈" + confidence.remainingBattles.toLocaleString() + " more " + battlePurpose + " battles estimated"
      : "Selected confidence goal is statistically established";
    return h("section", {
      className: "dirty-rank-confidence",
      title: "Estimate based on current Glicko-2 rating deviations, expected information gain, and the selected confidence goal. Future results can change it.",
    },
      h("div", { className: "dirty-rank-confidence-copy" },
        h("div", { className: "dirty-rank-confidence-heading" },
          h("strong", null, "Category confidence · " + confidence.goalLabel),
          h("span", null, confidence.established.toLocaleString() + "/" + confidence.goalTotal.toLocaleString() + " " + confidence.goalUnit + " established")
        ),
        h("div", { className: "dirty-rank-confidence-detail" },
          remaining + " · " + confidence.refined.toLocaleString() + "/" + confidence.eligible.toLocaleString() + " refined · " +
          confidence.excellent.toLocaleString() + " excellent · target RD ≤ " + Number(target).toLocaleString() + " · " +
          confidence.completedBattles.toLocaleString() + " completed"
        )
      ),
      h("div", {
        "aria-label": "Confidence progress for " + confidence.goalLabel,
        "aria-valuemax": 100,
        "aria-valuemin": 0,
        "aria-valuenow": Math.round(confidence.progress),
        className: "dirty-rank-confidence-track",
        role: "progressbar",
      }, h("span", { style: { width: Math.max(0, Math.min(100, confidence.progress)) + "%" } }))
    );
  }

  function GauntletConfidenceIndicator(props) {
    var pool = poolFor(props.performer, props.category.id, props.cohort, props.settings);
    var opponents = categoryEntries(props.performers, props.category, props.cohort, props.settings).filter(function (entry) {
      return String(entry.performer.id) !== String(props.performer.id);
    });
    var deviations = opponents.map(function (entry) { return entry.pool.deviation; }).sort(function (left, right) { return left - right; });
    var opponentDeviation = deviations[Math.floor(deviations.length / 2)] || props.settings.initialDeviation;
    var remaining = estimatedMatchesToConfidence(
      pool,
      props.settings.provisionalDeviation,
      representativeOpponent(pool, opponentDeviation, props.settings),
      props.settings
    );
    var ranked = rankPerformers(props.performers.filter(function (performer) {
      return categoryEligible(performer, props.category, props.settings, props.cohort);
    }), props.category.id, props.cohort, props.settings);
    var rank = ranked.findIndex(function (performer) { return String(performer.id) === String(props.performer.id); }) + 1;
    var progress = pool.matches > 0
      ? Math.min(100, props.settings.provisionalDeviation / Math.max(props.settings.provisionalDeviation, pool.deviation) * 100)
      : 0;
    var tier = precisionTier(pool, props.settings);
    var status = remaining > 0
      ? "≈" + remaining.toLocaleString() + " more target battles estimated"
      : "Target rating precision is " + tier.label.toLowerCase();
    return h("section", {
      className: "dirty-rank-confidence dirty-rank-gauntlet-confidence" +
        (tier.id !== "provisional" ? " dirty-rank-gauntlet-established" : "") +
        (tier.id === "excellent" ? " dirty-rank-gauntlet-excellent" : ""),
      title: "Gauntlet reaches Refined at RD " + props.settings.provisionalDeviation.toLocaleString() +
        " and Excellent at RD " + excellentDeviationThreshold(props.settings).toLocaleString() + ".",
    },
      h("div", { className: "dirty-rank-confidence-copy" },
        h("div", { className: "dirty-rank-confidence-heading" },
          h("strong", null, "Target confidence · " + props.performer.name),
          h(PrecisionBadge, { pool: pool, settings: props.settings })
        ),
        h("div", { className: "dirty-rank-confidence-detail" },
          status + " · rating " + Math.round(pool.rating).toLocaleString() + " · RD " + pool.deviation.toFixed(1) +
          " · " + (rank ? "#" + rank + " · " : "") + pool.matches.toLocaleString() + " battles"
        )
      ),
      h("div", {
        "aria-label": "Gauntlet confidence for " + props.performer.name,
        "aria-valuemax": 100,
        "aria-valuemin": 0,
        "aria-valuenow": Math.round(progress),
        className: "dirty-rank-confidence-track",
        role: "progressbar",
      }, h("span", { style: { width: progress + "%" } }))
    );
  }

  function LeaderboardStat(props) {
    return h("div", { className: "dirty-rank-stat dirty-ui-feature-card" },
      h("span", { className: "dirty-rank-stat-label" }, props.label),
      h("strong", { className: "dirty-rank-stat-value" }, props.value),
      h("span", { className: "dirty-rank-stat-detail" }, props.detail)
    );
  }

  function OverallConfidence(props) {
    var categories = categoriesFor(props.settings, props.cohort).filter(function (category) {
      return category.enabled && Number(category.weight) > 0;
    });
    var rows = categories.map(function (category) {
      return {
        category: category,
        confidence: categoryConfidence(props.performers, category, props.cohort, props.settings),
      };
    });
    var totalWeight = rows.reduce(function (sum, row) { return sum + Number(row.category.weight); }, 0);
    var progress = totalWeight ? rows.reduce(function (sum, row) {
      return sum + row.confidence.progress * Number(row.category.weight);
    }, 0) / totalWeight : 0;
    var remaining = rows.reduce(function (sum, row) { return sum + row.confidence.remainingBattles; }, 0);
    var complete = rows.filter(function (row) { return row.confidence.remainingBattles === 0; }).length;
    return h("section", { className: "dirty-rank-overall-confidence dirty-ui-feature-card" },
      h("div", { className: "dirty-rank-panel-heading d-flex align-items-end justify-content-between" },
        h("div", null,
          h("div", { className: "dirty-rank-eyebrow" }, "Weighted category confidence"),
          h("h2", null, "Overall confidence")
        ),
        h("div", { className: "dirty-rank-panel-summary" },
          complete.toLocaleString() + "/" + rows.length.toLocaleString() + " categories established · ≈" + remaining.toLocaleString() + " battles remaining"
        )
      ),
      h("div", {
        "aria-label": "Weighted overall confidence progress",
        "aria-valuemax": 100,
        "aria-valuemin": 0,
        "aria-valuenow": Math.round(progress),
        className: "dirty-rank-confidence-track dirty-rank-overall-confidence-track",
        role: "progressbar",
      }, h("span", { style: { width: Math.max(0, Math.min(100, progress)) + "%" } })),
      h("div", { className: "dirty-rank-confidence-categories" },
        rows.map(function (row) {
          var confidence = row.confidence;
          return h("article", { className: "dirty-rank-confidence-category", key: row.category.id },
            h("div", { className: "dirty-rank-confidence-category-heading" },
              h("strong", null, row.category.name),
              h("span", null, Math.round(confidence.progress) + "%")
            ),
            h("div", { className: "dirty-rank-confidence-detail" },
              confidence.refined.toLocaleString() + "/" + confidence.eligible.toLocaleString() + " refined · " +
              confidence.excellent.toLocaleString() + " excellent · " +
              confidence.established.toLocaleString() + "/" + confidence.goalTotal.toLocaleString() + " established · ≈" +
              confidence.remainingBattles.toLocaleString() + " remaining"
            )
          );
        })
      )
    );
  }

  function LeaderboardPodium(props) {
    var medals = ["Gold", "Silver", "Bronze"];
    var symbols = ["♛", "◆", "●"];
    var top = props.ranked.slice(0, 3);
    var podiumOrder = [1, 0, 2];
    if (!top.length) {
      return h(StateView, { title: "No rated performers", detail: "Complete a battle in this category to create its leaderboard." });
    }
    return h("section", { "aria-label": "Top three performers", className: "dirty-rank-podium" },
      podiumOrder.filter(function (index) { return top[index]; }).map(function (index) {
        var performer = top[index];
        var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
        return h("article", { className: "dirty-rank-podium-place d-flex flex-column dirty-rank-podium-" + (index + 1), key: performer.id },
          h("div", { className: "dirty-rank-podium-card" },
            h("div", { className: "dirty-rank-podium-medal d-flex align-items-center justify-content-center" },
              h("span", { "aria-hidden": "true" }, symbols[index]),
              h("strong", null, "#" + (index + 1) + " " + medals[index])
            ),
            h(NavLink, { className: "dirty-rank-podium-image-link", to: "/performers/" + performer.id },
              performer.image_path
                ? h("img", { alt: "", className: "dirty-rank-podium-image", loading: "lazy", src: performer.image_path })
                : h("div", { className: "dirty-rank-podium-placeholder d-flex align-items-center justify-content-center" }, "◇")
            ),
            h("div", { className: "dirty-rank-podium-copy text-center" },
              h(NavLink, { className: "dirty-rank-podium-name text-truncate", to: "/performers/" + performer.id }, performer.name),
              h("strong", { className: "dirty-rank-podium-rating" }, Math.round(pool.rating).toLocaleString()),
              h("span", { className: "dirty-rank-podium-detail" },
                "RD " + pool.deviation.toFixed(1) + " · " + pool.matches.toLocaleString() + " battles"
              ),
              h(PrecisionBadge, { pool: pool, settings: props.settings })
            )
          ),
          h("div", { "aria-hidden": "true", className: "dirty-rank-podium-step" },
            h("span", null, index + 1)
          )
        );
      })
    );
  }

  function LeaderboardPagination(props) {
    if (props.totalPages <= 1) return null;
    return h("nav", { "aria-label": "Leaderboard pages", className: "dirty-rank-pagination d-flex align-items-center justify-content-between" },
      h("button", {
        className: "btn btn-sm btn-secondary",
        disabled: props.page <= 1,
        onClick: function () { props.onPageChange(props.page - 1); },
        type: "button",
      }, "Previous"),
      h("span", { className: "dirty-rank-pagination-summary" },
        "Page " + props.page.toLocaleString() + " of " + props.totalPages.toLocaleString() +
        " · ranks " + props.firstRank.toLocaleString() + "–" + props.lastRank.toLocaleString()
      ),
      h("button", {
        className: "btn btn-sm btn-secondary",
        disabled: props.page >= props.totalPages,
        onClick: function () { props.onPageChange(props.page + 1); },
        type: "button",
      }, "Next")
    );
  }

  function paginatedLeaderboard(ranked, page, pageSize) {
    var remaining = ranked.slice(3);
    var totalPages = Math.max(1, Math.ceil(remaining.length / pageSize));
    var currentPage = Math.max(1, Math.min(totalPages, page));
    var start = (currentPage - 1) * pageSize;
    return {
      currentPage: currentPage,
      items: remaining.slice(start, start + pageSize),
      start: start,
      total: remaining.length,
      totalPages: totalPages,
    };
  }

  function LeaderboardPanelHeading(props) {
    return h("div", { className: "dirty-rank-panel-heading d-flex align-items-end justify-content-between" },
      h("div", null,
        h("div", { className: "dirty-rank-eyebrow" }, props.eyebrow),
        h("h2", null, "Remaining standings")
      ),
      h("div", { className: "dirty-rank-panel-summary" }, props.total.toLocaleString() + " rated performers")
    );
  }

  function LeaderboardTable(props) {
    var page = paginatedLeaderboard(props.ranked, props.page, LEADERBOARD_TABLE_PAGE_SIZE);
    return h("section", { className: "dirty-rank-standings-panel dirty-ui-feature-card" },
      h(LeaderboardPanelHeading, { eyebrow: "Full category results", total: props.ranked.length }),
      !page.total
        ? h("div", { className: "dirty-rank-empty-standings" }, props.ranked.length ? "Every rated performer is on the podium." : "No standings yet.")
        : h("div", { className: "dirty-rank-table-wrap" },
            h("table", { className: "table table-hover mb-0 dirty-rank-standings-table" },
              h("thead", null, h("tr", null,
                h("th", { scope: "col" }, "Rank"),
                h("th", { scope: "col" }, "Performer"),
                h("th", { scope: "col" }, "Rating"),
                h("th", { scope: "col" }, "RD"),
                h("th", { scope: "col" }, "Battles"),
                h("th", { scope: "col" }, "W-L-D"),
                h("th", { scope: "col" }, "Confidence")
              )),
              h("tbody", null, page.items.map(function (performer, offset) {
                var rank = page.start + offset + 4;
                var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
                return h("tr", { key: performer.id },
                  h("td", { className: "dirty-rank-table-rank" }, "#" + rank),
                  h("td", null, h(NavLink, { className: "dirty-rank-table-performer d-inline-flex align-items-center", to: "/performers/" + performer.id },
                    performer.image_path
                      ? h("img", { alt: "", className: "rounded-circle", loading: "lazy", src: performer.image_path })
                      : h("span", { className: "dirty-rank-table-avatar-placeholder d-inline-flex align-items-center justify-content-center rounded-circle" }, "◇"),
                    h("span", { className: "text-truncate" }, performer.name)
                  )),
                  h("td", { className: "dirty-rank-table-rating" }, Math.round(pool.rating).toLocaleString()),
                  h("td", null, pool.deviation.toFixed(1)),
                  h("td", null, pool.matches.toLocaleString()),
                  h("td", null, pool.wins.toLocaleString() + "-" + pool.losses.toLocaleString() + "-" + pool.draws.toLocaleString()),
                  h("td", null, h(PrecisionBadge, { pool: pool, settings: props.settings }))
                );
              }))
            ),
            h(LeaderboardPagination, {
              firstRank: page.start + 4,
              lastRank: page.start + page.items.length + 3,
              onPageChange: props.onPageChange,
              page: page.currentPage,
              totalPages: page.totalPages,
            })
          )
    );
  }

  function LeaderboardGalleryCard(props) {
    var performer = props.performer;
    var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
    var imageState = useState(!performer.image_path);
    var imageReady = imageState[0];
    var setImageReady = imageState[1];
    var failedState = useState(false);
    var imageFailed = failedState[0];
    var setImageFailed = failedState[1];
    return h("article", { className: "dirty-rank-gallery-card" },
      h(NavLink, { className: "dirty-rank-gallery-image-link", to: "/performers/" + performer.id },
        performer.image_path && !imageFailed
          ? h("img", {
              alt: "",
              className: imageReady ? "dirty-rank-gallery-image dirty-rank-gallery-image-ready" : "dirty-rank-gallery-image",
              loading: "lazy",
              onError: function () { setImageFailed(true); setImageReady(true); },
              onLoad: function () { setImageReady(true); },
              src: performer.image_path,
            })
          : h("div", { className: "dirty-rank-gallery-placeholder d-flex align-items-center justify-content-center" }, "◇"),
        h("span", { className: "dirty-rank-gallery-rank" }, "#" + props.rank),
        performer.image_path && !imageFailed && !imageReady && h("span", { "aria-hidden": "true", className: "dirty-rank-gallery-loading" })
      ),
      h("div", { className: "dirty-rank-gallery-copy" },
        h("div", { className: "dirty-rank-gallery-heading d-flex align-items-start justify-content-between" },
          h(NavLink, { className: "dirty-rank-gallery-name text-truncate", title: performer.name, to: "/performers/" + performer.id }, performer.name),
          h(PrecisionBadge, { pool: pool, settings: props.settings })
        ),
        h("div", { className: "dirty-rank-gallery-rating-row d-flex align-items-baseline" },
          h("strong", null, Math.round(pool.rating).toLocaleString()),
          h("span", null, "RD " + pool.deviation.toFixed(1))
        ),
        h("div", { className: "dirty-rank-gallery-detail" },
          pool.matches.toLocaleString() + " battles · " +
          pool.wins.toLocaleString() + "-" + pool.losses.toLocaleString() + "-" + pool.draws.toLocaleString() + " W-L-D"
        )
      )
    );
  }

  function LeaderboardGallery(props) {
    var page = paginatedLeaderboard(props.ranked, props.page, LEADERBOARD_GALLERY_PAGE_SIZE);
    return h("section", { className: "dirty-rank-standings-panel dirty-ui-feature-card" },
      h(LeaderboardPanelHeading, { eyebrow: "Portrait standings", total: props.ranked.length }),
      !page.total
        ? h("div", { className: "dirty-rank-empty-standings" }, props.ranked.length ? "Every rated performer is on the podium." : "No standings yet.")
        : h(Fragment, null,
            h("div", { className: "dirty-rank-gallery-grid" }, page.items.map(function (performer, offset) {
              return h(LeaderboardGalleryCard, {
                cohort: props.cohort,
                key: performer.id,
                leaderboardId: props.leaderboardId,
                performer: performer,
                rank: page.start + offset + 4,
                settings: props.settings,
              });
            })),
            h(LeaderboardPagination, {
              firstRank: page.start + 4,
              lastRank: page.start + page.items.length + 3,
              onPageChange: props.onPageChange,
              page: page.currentPage,
              totalPages: page.totalPages,
            })
          )
    );
  }

  function DirtyRankLeaderboardsRoute() {
    var settingsState = useState(null);
    var settings = settingsState[0];
    var setSettings = settingsState[1];
    var performersState = useState([]);
    var performers = performersState[0];
    var setPerformers = performersState[1];
    var cohortState = useState("");
    var cohort = cohortState[0];
    var setCohort = cohortState[1];
    var leaderboardState = useState(OVERALL_LEADERBOARD_ID);
    var leaderboardId = leaderboardState[0];
    var setLeaderboardId = leaderboardState[1];
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var viewState = useState("table");
    var viewMode = viewState[0];
    var setViewMode = viewState[1];
    var pageState = useState(1);
    var page = pageState[0];
    var setPage = pageState[1];

    var load = useCallback(function () {
      setLoading(true);
      setError("");
      return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), queryPerformers(), loadRatingIndex()])
        .then(function (values) {
          var nextSettings = settingsFromConfiguration(values[0]);
          setSettings(nextSettings);
          setPerformers(values[1]);
          setCohort(function (current) {
            return nextSettings.enabledCohorts.indexOf(current) !== -1 ? current : nextSettings.defaultCohort;
          });
        })
        .catch(function (caught) { setError(caught.message || String(caught)); })
        .finally(function () { setLoading(false); });
    }, []);

    useEffect(function () {
      void load();
      function changed(event) {
        if (!event.detail || event.detail.pluginId === PLUGIN_ID) void load();
      }
      window.addEventListener(CONFIGURATION_CHANGED_EVENT, changed);
      return function () { window.removeEventListener(CONFIGURATION_CHANGED_EVENT, changed); };
    }, [load]);

    var availableCohorts = settings ? COHORTS.filter(function (item) {
      return settings.enabledCohorts.indexOf(item[0]) !== -1;
    }) : [];
    var enabledCategories = settings ? categoriesFor(settings, cohort).filter(function (category) { return category.enabled; }) : [];
    useEffect(function () {
      if (leaderboardId !== OVERALL_LEADERBOARD_ID && !enabledCategories.some(function (category) { return category.id === leaderboardId; })) {
        setLeaderboardId(OVERALL_LEADERBOARD_ID);
      }
    }, [cohort, leaderboardId, settings]);
    var selectedCategory = enabledCategories.find(function (category) { return category.id === leaderboardId; }) || null;
    var data = useMemo(function () {
      return settings ? leaderboardData(performers, leaderboardId, cohort, settings) : null;
    }, [cohort, leaderboardId, performers, settings]);
    useEffect(function () { setPage(1); }, [cohort, leaderboardId, viewMode]);
    var pageSize = viewMode === "gallery" ? LEADERBOARD_GALLERY_PAGE_SIZE : LEADERBOARD_TABLE_PAGE_SIZE;
    var totalPages = data ? Math.max(1, Math.ceil(Math.max(0, data.ranked.length - 3) / pageSize)) : 1;
    useEffect(function () {
      if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    if (loading) return h("main", { className: "dirty-rank-route" }, h(StateView, { title: "Loading DirtyRank leaderboards…" }));
    if (error || !settings || !data) {
      return h("main", { className: "dirty-rank-route" }, h(StateView, {
        title: "Could not load DirtyRank leaderboards",
        detail: error || "DirtyRank settings are unavailable.",
        actions: h("button", { className: "btn btn-secondary dirty-ui-button", onClick: load, type: "button" }, "Retry"),
      }));
    }

    var stats = data.stats;
    var leaderboardName = selectedCategory ? selectedCategory.name : "Overall";
    var censorMedia = new URLSearchParams(window.location.search).get("censorMedia") === "1";
    return h("main", { className: "dirty-rank-route dirty-rank-leaderboards-route" + (censorMedia ? " dirty-rank-censored-media" : "") },
      h("div", { className: "dirty-rank-leaderboards-shell" },
        h("header", { className: "dirty-rank-leaderboards-header dirty-ui-feature-card d-flex align-items-end justify-content-between" },
          h("div", null,
            h("div", { className: "dirty-rank-eyebrow" }, cohortLabel(cohort) + " · " + leaderboardName),
            h("h1", { className: "dirty-rank-title" }, "DirtyRank Leaderboards"),
            h("p", { className: "dirty-rank-subtitle" }, selectedCategory
              ? "Category rankings, confidence, and rating health."
              : "Weighted standings across every enabled category for this performer sex.")
          ),
          h("div", { className: "dirty-rank-header-controls d-flex flex-wrap align-items-end justify-content-end" },
            availableCohorts.length > 1 && h("div", { className: "dirty-rank-control" },
              h("label", { htmlFor: "dirty-rank-leaderboard-cohort" }, "Performer sex"),
              h("select", {
                className: "form-control",
                id: "dirty-rank-leaderboard-cohort",
                onChange: function (event) { setCohort(event.target.value); },
                value: cohort,
              }, availableCohorts.map(function (item) { return h("option", { key: item[0], value: item[0] }, item[1]); }))
            ),
            h("div", { className: "dirty-rank-control" },
              h("label", { htmlFor: "dirty-rank-leaderboard-category" }, "Leaderboard"),
              h("select", {
                className: "form-control",
                id: "dirty-rank-leaderboard-category",
                onChange: function (event) { setLeaderboardId(event.target.value); },
                value: leaderboardId,
              },
                h("option", { value: OVERALL_LEADERBOARD_ID }, "Overall (weighted)"),
                enabledCategories.map(function (category) { return h("option", { key: category.id, value: category.id }, category.name); })
              )
            ),
            h("div", { className: "dirty-rank-control" },
              h("label", null, "View"),
              h("div", { "aria-label": "Leaderboard view", className: "btn-group dirty-rank-view-toggle", role: "group" },
                h("button", {
                  "aria-pressed": viewMode === "table",
                  className: "btn btn-sm " + (viewMode === "table" ? "btn-primary" : "btn-secondary"),
                  onClick: function () { setViewMode("table"); },
                  type: "button",
                }, "Table"),
                h("button", {
                  "aria-pressed": viewMode === "gallery",
                  className: "btn btn-sm " + (viewMode === "gallery" ? "btn-primary" : "btn-secondary"),
                  onClick: function () { setViewMode("gallery"); },
                  type: "button",
                }, "Gallery")
              )
            ),
            h(NavLink, { className: "btn btn-sm btn-secondary dirty-rank-options-link", exact: true, to: ROUTE_PATH }, "Battles"),
            h(NavLink, { className: "btn btn-sm btn-secondary dirty-rank-options-link", to: "/plugins/dirty-plugins?plugin=dirtyRank" }, "Options")
          )
        ),
        h("section", { "aria-label": "Leaderboard statistics", className: "dirty-rank-stats" },
          h(LeaderboardStat, {
            detail: stats.coverage.toFixed(1) + "% of eligible performers",
            label: "Rated coverage",
            value: stats.rated.toLocaleString() + "/" + data.eligible.toLocaleString(),
          }),
          h(LeaderboardStat, {
            detail: stats.excellent.toLocaleString() + " excellent · " + (stats.rated ? (stats.stable / stats.rated * 100).toFixed(1) + "% refined or better" : "No rated performers"),
            label: "Refined ratings",
            value: stats.stable.toLocaleString(),
          }),
          h(LeaderboardStat, { detail: "Recorded head-to-head results", label: "Completed battles", value: stats.completedBattles.toLocaleString() }),
          h(LeaderboardStat, { detail: "Lower means more precise", label: "Median RD", value: stats.medianDeviation.toFixed(1) }),
          h(LeaderboardStat, { detail: "Share of completed battles", label: "Draw rate", value: stats.drawRate.toFixed(1) + "%" }),
          h(LeaderboardStat, { detail: "Highest to lowest rated", label: "Rating spread", value: Math.round(stats.ratingSpread).toLocaleString() })
        ),
        h("div", { className: "dirty-rank-leaderboards-confidence" },
          selectedCategory
            ? h(ConfidenceIndicator, { category: selectedCategory, cohort: cohort, performers: performers, settings: settings })
            : h(OverallConfidence, { cohort: cohort, performers: performers, settings: settings })
        ),
        h(LeaderboardPodium, { cohort: cohort, leaderboardId: leaderboardId, ranked: data.ranked, settings: settings }),
        viewMode === "gallery"
          ? h(LeaderboardGallery, { cohort: cohort, leaderboardId: leaderboardId, onPageChange: setPage, page: page, ranked: data.ranked, settings: settings })
          : h(LeaderboardTable, { cohort: cohort, leaderboardId: leaderboardId, onPageChange: setPage, page: page, ranked: data.ranked, settings: settings })
      )
    );
  }

  function DecisionIndicator(props) {
    var decision = props.decision;
    if (!decision) return null;
    function result(person) {
      var label = person.tone === "winner" ? "Winner" : person.tone === "loser" ? "Loser" : "Tie";
      return h("span", { className: "dirty-rank-decision-person dirty-rank-decision-" + person.tone },
        h("span", { className: "dirty-rank-decision-label" }, label),
        h("strong", null, person.name)
      );
    }
    return h("div", { "aria-live": "polite", className: "dirty-rank-decision d-flex flex-wrap align-items-center" },
      h("span", { className: "dirty-rank-decision-title" }, "Last decision"),
      result(decision.left),
      result(decision.right)
    );
  }

  function downloadRatings(performers) {
    var payload = {
      exportedAt: new Date().toISOString(),
      plugin: PLUGIN_ID,
      version: 2,
      performers: performers.map(function (performer) {
        return { id: performer.id, name: performer.name, gender: performer.gender, state: parseState(performer) };
      }).filter(function (item) { return Object.keys(item.state.pools).length > 0; }),
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "dirty-rank-ratings-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function DirtyRankRoute(props) {
    var routeTargetId = props && props.match && props.match.params && props.match.params.performerId
      ? String(props.match.params.performerId)
      : "";
    var gauntletPathActive = /^\/plugins\/dirty-rank\/gauntlet\/[^/]+\/?$/.test(window.location.pathname);
    if (gauntletPathActive && !routeTargetId) return null;
    var gauntletTargetId = routeTargetId;
    var gauntletMode = Boolean(gauntletTargetId);
    var censorMedia = new URLSearchParams(window.location.search).get("censorMedia") === "1";
    var settingsState = useState(null);
    var settings = settingsState[0];
    var setSettings = settingsState[1];
    var performersState = useState([]);
    var performers = performersState[0];
    var setPerformers = performersState[1];
    var cohortState = useState("");
    var cohort = cohortState[0];
    var setCohort = cohortState[1];
    var categoryState = useState("");
    var categoryId = categoryState[0];
    var setCategoryId = categoryState[1];
    var pairState = useState(null);
    var pairInfo = pairState[0];
    var setPairInfo = pairState[1];
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var busyState = useState(false);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var feedbackState = useState(null);
    var feedback = feedbackState[0];
    var setFeedback = feedbackState[1];
    var decisionState = useState(null);
    var decision = decisionState[0];
    var setDecision = decisionState[1];
    var undoHistoryState = useState([]);
    var undoHistory = undoHistoryState[0];
    var setUndoHistory = undoHistoryState[1];
    var sessionState = useState(0);
    var sessionMatches = sessionState[0];
    var setSessionMatches = sessionState[1];
    var pendingState = useState(0);
    var pendingVotes = pendingState[0];
    var setPendingVotes = pendingState[1];
    var recentPairs = useRef([]);
    var busyRef = useRef(false);
    var submittedPairRef = useRef("");
    var pendingVotesRef = useRef(0);
    var voteQueueRef = useRef(Promise.resolve());
    var mountedRef = useRef(true);
    var undoHistoryRef = useRef([]);
    var operationStatusRef = useRef(new Map());
    var preparedPairRef = useRef(null);
    var preparedImagesRef = useRef([]);

    var load = useCallback(function () {
      setLoading(true);
      setError("");
      return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), queryPerformers(), loadRatingIndex()])
        .then(function (values) {
          var nextSettings = settingsFromConfiguration(values[0]);
          var gauntletTarget = gauntletMode
            ? values[1].find(function (performer) { return String(performer.id) === gauntletTargetId; })
            : null;
          if (gauntletMode && !gauntletTarget) throw new Error("The selected Gauntlet performer could not be found.");
          var nextCohort = gauntletTarget ? gauntletTarget.gender : nextSettings.defaultCohort;
          if (gauntletTarget && nextSettings.enabledCohorts.indexOf(nextCohort) === -1) {
            throw new Error("Enable " + cohortLabel(nextCohort) + " battles in DirtyRank settings to use this performer in Gauntlet mode.");
          }
          var enabled = categoriesFor(nextSettings, nextCohort).filter(function (category) { return category.enabled; });
          if (!enabled.length) throw new Error("Enable at least one DirtyRank category for the selected performer cohort.");
          setSettings(nextSettings);
          setPerformers(values[1]);
          setCohort(nextCohort);
          setCategoryId(function (current) {
            return preferredCategoryId(nextSettings, nextCohort, current);
          });
          setPairInfo(null);
          setDecision(null);
          undoHistoryRef.current = [];
          setUndoHistory([]);
        })
        .catch(function (caught) { setError(caught.message || String(caught)); })
        .finally(function () { setLoading(false); });
    }, [gauntletMode, gauntletTargetId]);

    useEffect(function () {
      mountedRef.current = true;
      void load();
      function changed(event) {
        if (!event.detail || event.detail.pluginId === PLUGIN_ID) void load();
      }
      window.addEventListener(CONFIGURATION_CHANGED_EVENT, changed);
      return function () {
        mountedRef.current = false;
        window.removeEventListener(CONFIGURATION_CHANGED_EVENT, changed);
      };
    }, [load]);

    var category = useMemo(function () {
      if (!settings) return null;
      var cohortCategories = categoriesFor(settings, cohort);
      return cohortCategories.find(function (item) { return item.id === categoryId && item.enabled; }) ||
        cohortCategories.find(function (item) { return item.enabled; }) || null;
    }, [categoryId, cohort, settings]);

    var gauntletTarget = useMemo(function () {
      if (!gauntletMode) return null;
      return performers.find(function (performer) { return String(performer.id) === gauntletTargetId; }) || null;
    }, [gauntletMode, gauntletTargetId, performers]);

    var selectModePair = useCallback(function (sourcePerformers, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs) {
      var target = gauntletMode
        ? sourcePerformers.find(function (performer) { return String(performer.id) === gauntletTargetId; })
        : null;
      return target
        ? selectGauntletPair(sourcePerformers, target, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs)
        : selectPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs);
    }, [gauntletMode, gauntletTargetId]);

    var pickNext = useCallback(function (sourcePerformers, sourceSettings, sourceCategory, sourceCohort) {
      if (!sourceSettings || !sourceCategory) return;
      var selected = selectModePair(
        sourcePerformers,
        sourceCategory,
        sourceCohort,
        sourceSettings,
        recentPairs.current
      );
      selected.instanceId = battleId();
      setPairInfo(selected);
      setFeedback(null);
    }, [selectModePair]);

    function preparedPairKey(sourceCategory, sourceCohort) {
      return sourceCohort + ":" + sourceCategory.id;
    }

    function preloadPairImages(selected) {
      preparedImagesRef.current = [];
      if (!selected || !selected.pair || settings.hidePerformerImages || typeof window.Image !== "function") return;
      selected.pair.forEach(function (performer) {
        if (!performer.image_path) return;
        var image = new window.Image();
        image.decoding = "async";
        image.src = performer.image_path;
        preparedImagesRef.current.push(image);
      });
    }

    function showPreparedOrPickNext() {
      var prepared = preparedPairRef.current;
      var contextKey = category ? preparedPairKey(category, cohort) : "";
      if (prepared && pairInfo && prepared.sourceInstanceId === pairInfo.instanceId && prepared.contextKey === contextKey) {
        preparedPairRef.current = null;
        preparedImagesRef.current = [];
        setPairInfo(prepared.pairInfo);
        setFeedback(null);
        return;
      }
      pickNext(performers, settings, category, cohort);
    }

    useEffect(function () {
      if (!loading && !error && settings && category && !pairInfo && performers.length) {
        pickNext(performers, settings, category, cohort);
      }
    }, [category, cohort, error, loading, pairInfo, performers, pickNext, settings]);

    useEffect(function () {
      preparedPairRef.current = null;
      preparedImagesRef.current = [];
      if (loading || error || !settings || !category || !pairInfo || !pairInfo.pair || performers.length < 2) return undefined;

      var cancelled = false;
      var idleHandle = null;
      var timeoutHandle = null;
      function prepareNextPair() {
        if (cancelled) return;
        var simulatedRecentPairs = recentPairs.current.concat([pairToken(pairInfo.pair[0], pairInfo.pair[1])]);
        var selected = selectModePair(performers, category, cohort, settings, simulatedRecentPairs);
        selected.instanceId = battleId();
        if (cancelled) return;
        preparedPairRef.current = {
          contextKey: preparedPairKey(category, cohort),
          pairInfo: selected,
          sourceInstanceId: pairInfo.instanceId,
        };
        preloadPairImages(selected);
      }

      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(prepareNextPair, { timeout: 300 });
      } else {
        timeoutHandle = window.setTimeout(prepareNextPair, 0);
      }
      return function () {
        cancelled = true;
        if (idleHandle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
        if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
      };
    }, [category, cohort, error, loading, pairInfo, performers, selectModePair, settings]);

    function replaceStates(result, source) {
      return source.map(function (performer) {
        if (result.left && performer.id === result.left.id) return updatePerformerState(performer, result.left.state);
        if (result.right && performer.id === result.right.id) return updatePerformerState(performer, result.right.state);
        return performer;
      });
    }

    function submit(outcome) {
      if (busyRef.current || !pairInfo || !pairInfo.pair || !category) return;
      if (submittedPairRef.current === pairInfo.instanceId) return;
      var left = pairInfo.pair[0];
      var right = pairInfo.pair[1];
      var beforeLeft = poolFor(left, category.id, cohort, settings);
      var beforeRight = poolFor(right, category.id, cohort, settings);
      var id = battleId();
      var queuedBattle = {
        id: id,
        categoryId: category.id,
        category: category,
        cohort: cohort,
        left: left,
        right: right,
        outcome: outcome,
        pairInfo: pairInfo,
        beforeLeft: beforeLeft,
        beforeRight: beforeRight,
        settings: settings,
      };
      var historyEntry = {
        id: queuedBattle.id,
        categoryId: queuedBattle.categoryId,
        cohort: queuedBattle.cohort,
        leftId: queuedBattle.left.id,
        rightId: queuedBattle.right.id,
        pairInfo: queuedBattle.pairInfo,
      };
      var operationStatus = { recordFailed: false, undone: false };
      var leftTone = outcome === "draw" ? "draw" : outcome === "left" ? "winner" : "loser";
      var rightTone = outcome === "draw" ? "draw" : outcome === "right" ? "winner" : "loser";
      submittedPairRef.current = pairInfo.instanceId;
      setError("");
      setDecision({
        id: id,
        left: { name: left.name, tone: leftTone },
        right: { name: right.name, tone: rightTone },
      });
      recentPairs.current.push(pairToken(left, right));
      recentPairs.current = recentPairs.current.slice(-Math.max(50, settings.avoidRepeatWindow));
      var combinedUndoHistory = undoHistoryRef.current.concat([historyEntry]);
      combinedUndoHistory.slice(0, Math.max(0, combinedUndoHistory.length - UNDO_HISTORY_LIMIT)).forEach(function (entry) {
        operationStatusRef.current.delete(entry.id);
      });
      var nextUndoHistory = combinedUndoHistory.slice(-UNDO_HISTORY_LIMIT);
      undoHistoryRef.current = nextUndoHistory;
      setUndoHistory(nextUndoHistory);
      operationStatusRef.current.set(queuedBattle.id, operationStatus);
      setSessionMatches(function (value) { return value + 1; });
      showPreparedOrPickNext();
      setFeedback({ text: "Vote queued" });

      pendingVotesRef.current += 1;
      setPendingVotes(pendingVotesRef.current);
      voteQueueRef.current = voteQueueRef.current.then(function () {
        return runOperation({
          mode: "record",
          battleId: queuedBattle.id,
          categoryId: queuedBattle.categoryId,
          cohort: queuedBattle.cohort,
          leftId: queuedBattle.left.id,
          rightId: queuedBattle.right.id,
          outcome: queuedBattle.outcome,
        });
      }).then(function (result) {
        if (!mountedRef.current || operationStatus.undone) return;
        var afterLeft = poolFor(updatePerformerState(queuedBattle.left, result.left.state), queuedBattle.categoryId, queuedBattle.cohort, queuedBattle.settings);
        var afterRight = poolFor(updatePerformerState(queuedBattle.right, result.right.state), queuedBattle.categoryId, queuedBattle.cohort, queuedBattle.settings);
        setPerformers(function (current) { return replaceStates(result, current); });
        setFeedback({
          text: queuedBattle.left.name + " " + ratingDelta(afterLeft.rating, queuedBattle.beforeLeft.rating) + " · " +
            queuedBattle.right.name + " " + ratingDelta(afterRight.rating, queuedBattle.beforeRight.rating),
        });
      }).catch(function (caught) {
        if (!mountedRef.current) return;
        operationStatus.recordFailed = true;
        if (!operationStatus.undone) {
          undoHistoryRef.current = undoHistoryRef.current.filter(function (entry) { return entry.id !== queuedBattle.id; });
          setUndoHistory(undoHistoryRef.current.slice());
          setSessionMatches(function (value) { return Math.max(0, value - 1); });
          setDecision(function (current) { return current && current.id === queuedBattle.id ? null : current; });
        }
        setError("A queued vote could not be saved: " + (caught.message || String(caught)));
      }).finally(function () {
        pendingVotesRef.current = Math.max(0, pendingVotesRef.current - 1);
        if (mountedRef.current) setPendingVotes(pendingVotesRef.current);
      });
    }

    function skip() {
      if (busyRef.current || !pairInfo || !pairInfo.pair || !category) return;
      recentPairs.current.push(pairToken(pairInfo.pair[0], pairInfo.pair[1]));
      recentPairs.current = recentPairs.current.slice(-Math.max(50, settings.avoidRepeatWindow));
      setDecision(null);
      showPreparedOrPickNext();
    }

    function undo() {
      var lastBattle = undoHistoryRef.current[undoHistoryRef.current.length - 1];
      if (busyRef.current || !lastBattle) return;
      var operationStatus = operationStatusRef.current.get(lastBattle.id) || { recordFailed: false, undone: false };
      operationStatus.undone = true;
      operationStatusRef.current.set(lastBattle.id, operationStatus);
      undoHistoryRef.current = undoHistoryRef.current.slice(0, -1);
      setUndoHistory(undoHistoryRef.current.slice());
      setError("");
      setPairInfo(Object.assign({}, lastBattle.pairInfo, { instanceId: battleId() }));
      setDecision(null);
      setFeedback({ text: "Undo queued" });
      setSessionMatches(function (value) { return Math.max(0, value - 1); });

      pendingVotesRef.current += 1;
      setPendingVotes(pendingVotesRef.current);
      voteQueueRef.current = voteQueueRef.current.then(function () {
        if (operationStatus.recordFailed) return null;
        return runOperation({
          mode: "undo",
          battleId: lastBattle.id,
          categoryId: lastBattle.categoryId,
          cohort: lastBattle.cohort,
          leftId: lastBattle.leftId,
          rightId: lastBattle.rightId,
        });
      }).then(function (result) {
        operationStatusRef.current.delete(lastBattle.id);
        if (!mountedRef.current || !result) return;
        setPerformers(function (current) { return replaceStates(result, current); });
        setFeedback({ text: "Battle undone." });
      }).catch(function (caught) {
        if (!mountedRef.current) return;
        setError("A queued undo could not be saved: " + (caught.message || String(caught)) + ". Reload DirtyRank to reconcile the session.");
      }).finally(function () {
        pendingVotesRef.current = Math.max(0, pendingVotesRef.current - 1);
        if (mountedRef.current) setPendingVotes(pendingVotesRef.current);
      });
    }

    useEffect(function () {
      function onKeyDown(event) {
        if (event.defaultPrevented || busy || !pairInfo || !pairInfo.pair) return;
        var tagName = document.activeElement && document.activeElement.tagName;
        if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
        if (event.key === "ArrowLeft") { event.preventDefault(); submit("left"); }
        if (event.key === "ArrowRight") { event.preventDefault(); submit("right"); }
        if (event.key === "ArrowUp") { event.preventDefault(); submit("draw"); }
        if (event.key === "ArrowDown") { event.preventDefault(); undo(); }
        if (event.key.toLowerCase() === "t") { event.preventDefault(); submit("draw"); }
        if (event.key.toLowerCase() === "s") { event.preventDefault(); skip(); }
      }
      document.addEventListener("keydown", onKeyDown);
      return function () { document.removeEventListener("keydown", onKeyDown); };
    });

    useEffect(function () {
      if (pendingVotes <= 0) return undefined;
      function preventPendingOperationExit(event) {
        event.preventDefault();
        event.returnValue = "";
        return "";
      }
      window.addEventListener("beforeunload", preventPendingOperationExit);
      return function () { window.removeEventListener("beforeunload", preventPendingOperationExit); };
    }, [pendingVotes]);

    if (loading) return h("main", { className: "dirty-rank-route" }, h(StateView, { title: gauntletMode ? "Loading Gauntlet…" : "Loading DirtyRank…" }));
    if (error && (!settings || !performers.length)) {
      return h("main", { className: "dirty-rank-route" }, h(StateView, {
        title: "Could not load DirtyRank",
        detail: error,
        actions: h("button", { className: "btn btn-secondary dirty-ui-button", onClick: load, type: "button" }, "Retry"),
      }));
    }
    if (!settings || !category) return null;

    var pair = pairInfo && pairInfo.pair;
    var reveal = settings.showRatingsBeforeVote;
    var availableCohorts = COHORTS.filter(function (item) {
      return settings.enabledCohorts.indexOf(item[0]) !== -1;
    });
    return h(Fragment, null,
      Prompt && h(Prompt, {
        message: "DirtyRank is still saving queued votes or undos. Wait for the queue to finish before leaving this page.",
        when: pendingVotes > 0,
      }),
      h("main", { className: "dirty-rank-route" + (gauntletMode ? " dirty-rank-gauntlet-route" : "") + (censorMedia ? " dirty-rank-censored-media" : "") },
      h("div", { className: "dirty-rank-shell" },
        h("section", { className: "dirty-rank-main dirty-ui-feature-card" },
          h("header", { className: "dirty-rank-header d-flex align-items-start justify-content-between" },
            h("div", null,
              h("h1", { className: "dirty-rank-title" }, gauntletMode ? "DirtyRank Gauntlet" : "DirtyRank"),
              h("p", { className: "dirty-rank-subtitle" }, gauntletMode && gauntletTarget
                ? "Refine " + gauntletTarget.name + "'s " + category.name + " rating against the most informative opponents."
                : category.description || "Choose the performer you prefer in this category.")
            ),
            h("div", { className: "dirty-rank-header-controls d-flex flex-wrap align-items-end justify-content-end" },
              !gauntletMode && availableCohorts.length > 1 && h("div", { className: "dirty-rank-control" },
                h("label", { htmlFor: "dirty-rank-battle-cohort" }, "Performer sex"),
                h("select", {
                  className: "form-control",
                  disabled: busy || pendingVotes > 0,
                  id: "dirty-rank-battle-cohort",
                  onChange: function (event) {
                    var nextCohort = event.target.value;
                    var nextCategoryId = preferredCategoryId(settings, nextCohort, category.id);
                    setCohort(nextCohort);
                    setCategoryId(nextCategoryId);
                    rememberCategory(nextCohort, nextCategoryId);
                    setPairInfo(null);
                    undoHistoryRef.current = [];
                    setUndoHistory([]);
                    setFeedback(null);
                    setDecision(null);
                  },
                  value: cohort,
                }, availableCohorts.map(function (item) {
                  return h("option", { key: item[0], value: item[0] }, item[1]);
                }))
              ),
              h("div", { className: "dirty-rank-control" },
                h("label", { htmlFor: "dirty-rank-category" }, "Category"),
                h("select", {
                  className: "form-control",
                  disabled: busy || pendingVotes > 0,
                  id: "dirty-rank-category",
                  onChange: function (event) {
                    var nextCategoryId = event.target.value;
                    setCategoryId(nextCategoryId);
                    rememberCategory(cohort, nextCategoryId);
                    setPairInfo(null);
                    undoHistoryRef.current = [];
                    setUndoHistory([]);
                    setFeedback(null);
                    setDecision(null);
                  },
                  value: category.id,
                }, categoriesFor(settings, cohort).filter(function (item) { return item.enabled; }).map(function (item) {
                  return h("option", { key: item.id, value: item.id }, item.name);
                }))
              ),
              gauntletMode && gauntletTarget && h(NavLink, {
                className: "btn btn-sm btn-secondary dirty-rank-options-link",
                to: "/performers/" + gauntletTarget.id,
              }, "Back to performer"),
              h(NavLink, { className: "btn btn-sm btn-secondary dirty-rank-options-link", to: LEADERBOARDS_ROUTE_PATH }, "Leaderboards"),
              h(NavLink, { className: "btn btn-sm btn-secondary dirty-rank-options-link", to: "/plugins/dirty-plugins?plugin=dirtyRank" }, "Options")
            )
          ),
          h("div", { className: "dirty-rank-statusbar d-flex flex-wrap align-items-center justify-content-between" },
            h("div", { className: "dirty-rank-session d-flex flex-wrap" },
              h("span", null, sessionMatches + " rated this session"),
              h("span", null, (pairInfo ? Math.max(0, pairInfo.eligible - (gauntletMode ? 1 : 0)) : 0) + (gauntletMode ? " eligible opponents" : " eligible performers")),
              pendingVotes > 0 && h("span", { className: "dirty-rank-saving" }, pendingVotes + " queued operation" + (pendingVotes === 1 ? "" : "s")),
              pairInfo && Number.isFinite(pairInfo.expectedRdReduction) && h("span", null, "Expected RD reduction ≈ " + Math.round(pairInfo.expectedRdReduction)),
              pairInfo && pairInfo.calibration && h("span", null, "Calibration match")
            ),
            feedback && h("div", { className: "dirty-rank-feedback", role: "status" }, feedback.text)
          ),
          h(DecisionIndicator, { decision: decision }),
          gauntletMode && gauntletTarget
            ? h(GauntletConfidenceIndicator, { category: category, cohort: cohort, performer: gauntletTarget, performers: performers, settings: settings })
            : h(ConfidenceIndicator, { category: category, cohort: cohort, performers: performers, settings: settings }),
          error && h("div", { className: "dirty-ui-text-error", role: "alert", style: { padding: "0.75rem 1.25rem 0" } }, error),
          !pair && h(StateView, {
            title: "Not enough eligible performers",
            detail: "This category and cohort need at least two performers" + (settings.includePerformersWithoutImages ? "." : " with profile images."),
            actions: h(NavLink, { className: "btn btn-secondary dirty-ui-button", to: "/plugins/dirty-plugins?plugin=dirtyRank" }, "Open settings"),
          }),
          pair && h(Fragment, null,
            h("div", { className: "dirty-rank-arena" },
              h(PerformerCard, {
                disabled: busy,
                key: pairInfo.instanceId + ":left",
                gauntletTarget: gauntletMode,
                onChoose: function () { submit("left"); },
                performer: pair[0],
                pool: poolFor(pair[0], category.id, cohort, settings),
                rank: pairInfo.ranks[pair[0].id],
                reveal: reveal,
                settings: settings,
              }),
              h("div", { className: "dirty-rank-versus", "aria-hidden": "true" }),
              h(PerformerCard, {
                disabled: busy,
                key: pairInfo.instanceId + ":right",
                onChoose: function () { submit("right"); },
                performer: pair[1],
                pool: poolFor(pair[1], category.id, cohort, settings),
                rank: pairInfo.ranks[pair[1].id],
                reveal: reveal,
                settings: settings,
              })
            ),
            h("div", { className: "dirty-rank-actions d-flex flex-wrap align-items-center justify-content-center" },
              h("button", { className: "btn btn-secondary dirty-ui-button", disabled: busy, onClick: function () { submit("draw"); }, type: "button" }, "Tie"),
              h("button", { className: "btn btn-secondary dirty-ui-button", disabled: busy, onClick: skip, type: "button" }, "Skip"),
              h("button", { className: "btn btn-secondary dirty-ui-button", disabled: busy || !undoHistory.length, onClick: undo, type: "button" }, "Undo" + (undoHistory.length ? " (" + undoHistory.length + ")" : "")),
              h("div", { className: "dirty-rank-hint" }, "← choose left · → choose right · ↑ tie · ↓ undo · S skip")
            )
          )
        ),
        h(Leaderboard, { category: category, cohort: cohort, performers: performers, settings: settings })
      )
    ));
  }

  function Field(props) {
    return h("div", { className: "dirty-rank-field" },
      h("label", { htmlFor: props.id }, props.label),
      props.children,
      props.help && h("p", { className: "dirty-rank-field-help" }, props.help)
    );
  }

  function DirtyRankSettings(props) {
    if (!SettingsCard || !Section || !Toggle) return null;
    var draftState = useState(function () { return settingsFromConfiguration(props.configuration); });
    var draft = draftState[0];
    var setDraft = draftState[1];
    var savedState = useState(function () { return settingsFromConfiguration(props.configuration); });
    var saved = savedState[0];
    var setSaved = savedState[1];
    var editingCohortState = useState(function () {
      return settingsFromConfiguration(props.configuration).defaultCohort;
    });
    var editingCohort = editingCohortState[0];
    var setEditingCohort = editingCohortState[1];
    var busyState = useState(false);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var statusState = useState("");
    var status = statusState[0];
    var setStatus = statusState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var autoSaveTimerRef = useRef(null);
    var saveQueueRef = useRef(Promise.resolve());
    var saveRevisionRef = useRef(0);
    var dirty = useMemo(function () {
      return comparableSettings(draft) !== comparableSettings(saved);
    }, [draft, saved]);

    useEffect(function () {
      var cancelled = false;
      DirtyPlugins.getPluginSettings(PLUGIN_ID).then(function (settings) {
        if (cancelled) return;
        var normalized = settingsFromConfiguration(settings);
        setDraft(normalized);
        setSaved(normalized);
        setEditingCohort(normalized.defaultCohort);
      }).catch(function () {
        // The settings supplied by the shared hub remain a valid fallback.
      });
      return function () { cancelled = true; };
    }, []);
    useEffect(function () {
      if (props.onDirtyChange) props.onDirtyChange(PLUGIN_ID, dirty);
    }, [dirty, props.onDirtyChange]);
    useEffect(function () {
      return function () {
        window.clearTimeout(autoSaveTimerRef.current);
        if (props.onDirtyChange) props.onDirtyChange(PLUGIN_ID, false);
      };
    }, [props.onDirtyChange]);
    useEffect(function () {
      if (!dirty) return undefined;
      var validationError = validateSettings(draft);
      if (validationError) {
        setBusy(false);
        setError(validationError);
        setStatus("");
        return undefined;
      }

      var settingsToSave = draft;
      var revision = saveRevisionRef.current + 1;
      saveRevisionRef.current = revision;
      setError("");
      setStatus("Waiting to save automatically…");
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(function () {
        setBusy(true);
        setStatus("Saving automatically…");
        var currentSave = saveQueueRef.current.catch(function () {}).then(function () {
          return DirtyPlugins.configurePlugin(PLUGIN_ID, serializedSettings(settingsToSave));
        });
        saveQueueRef.current = currentSave;
        currentSave.then(function () {
          if (saveRevisionRef.current !== revision) return;
          setSaved(settingsToSave);
          setStatus("Saved automatically.");
          DirtyPlugins.notifyConfigurationChanged(PLUGIN_ID, { preserveSettingsPage: true });
        }).catch(function (caught) {
          if (saveRevisionRef.current !== revision) return;
          setError(caught.message || String(caught));
          setStatus("");
        }).finally(function () {
          if (saveRevisionRef.current === revision) setBusy(false);
        });
      }, 350);
      return function () { window.clearTimeout(autoSaveTimerRef.current); };
    }, [dirty, draft]);

    function changed(update) {
      setDraft(function (current) { return Object.assign({}, current, update); });
      setStatus("");
      setError("");
    }

    function toggleCohort(cohort, enabled) {
      if (!enabled && editingCohort === cohort) {
        var nextEditingCohort = draft.enabledCohorts.find(function (item) { return item !== cohort; });
        if (nextEditingCohort) setEditingCohort(nextEditingCohort);
      }
      setDraft(function (current) {
        var selected = new Set(current.enabledCohorts);
        if (enabled) selected.add(cohort);
        else if (selected.size > 1) selected.delete(cohort);
        var enabledCohorts = COHORTS.filter(function (item) { return selected.has(item[0]); }).map(function (item) { return item[0]; });
        var defaultCohort = enabledCohorts.indexOf(current.defaultCohort) !== -1
          ? current.defaultCohort
          : enabledCohorts[0];
        return Object.assign({}, current, { defaultCohort: defaultCohort, enabledCohorts: enabledCohorts });
      });
      setStatus("");
      setError("");
    }

    function changeCategories(transform) {
      setDraft(function (current) {
        var nextByCohort = Object.assign({}, current.categoriesByCohort);
        var currentCategories = (nextByCohort[editingCohort] || []).slice();
        nextByCohort[editingCohort] = transform(currentCategories);
        return Object.assign({}, current, { categoriesByCohort: nextByCohort });
      });
      setStatus("");
      setError("");
    }

    function updateCategory(index, update) {
      changeCategories(function (categories) { return categories.map(function (category, categoryIndex) {
        return categoryIndex === index ? Object.assign({}, category, update) : category;
      }); });
    }

    function moveCategory(index, direction) {
      changeCategories(function (categories) {
        var target = index + direction;
        if (target < 0 || target >= categories.length) return categories;
        var moved = categories.splice(index, 1)[0];
        categories.splice(target, 0, moved);
        return categories;
      });
    }

    function addCategory() {
      changeCategories(function (categories) {
        var suffix = 1;
        var ids = new Set(categories.map(function (category) { return category.id; }));
        while (ids.has("category-" + suffix)) suffix += 1;
        return categories.concat([{
          id: "category-" + suffix,
          name: "New category",
          description: "",
          enabled: true,
          weight: 1,
        }]);
      });
    }

    function removeCategory(index) {
      changeCategories(function (categories) {
        if (categories.length <= 1) return categories;
        return categories.filter(function (_item, itemIndex) { return itemIndex !== index; });
      });
    }

    function validateSettings(settings) {
      if (!settings.enabledCohorts.length) return "Enable at least one performer sex.";
      for (var cohortIndex = 0; cohortIndex < COHORTS.length; cohortIndex += 1) {
        var cohort = COHORTS[cohortIndex][0];
        var names = new Set();
        var cohortCategories = categoriesFor(settings, cohort);
        if (settings.enabledCohorts.indexOf(cohort) !== -1 && !cohortCategories.some(function (category) { return category.enabled; })) {
          return cohortLabel(cohort) + " needs at least one enabled category.";
        }
        for (var index = 0; index < cohortCategories.length; index += 1) {
          var name = String(cohortCategories[index].name || "").trim();
          if (!name) return "Every category needs a name.";
          if (names.has(name.toLowerCase())) return "Category names must be unique within each performer cohort.";
          if (!(Number(cohortCategories[index].weight) > 0)) return "Every category needs a weight greater than zero.";
          names.add(name.toLowerCase());
        }
      }
      return "";
    }

    function primaryCategory() {
      var categories = categoriesFor(draft, draft.defaultCohort);
      return categories.find(function (category) { return category.enabled; }) || categories[0];
    }

    function exportRatings() {
      setBusy(true);
      setError("");
      setStatus("Preparing export…");
      Promise.all([queryPerformers(), loadRatingIndex()]).then(function (values) {
        downloadRatings(values[0]);
        setStatus("Ratings exported");
      }).catch(function (caught) { setError(caught.message || String(caught)); setStatus(""); })
        .finally(function () { setBusy(false); });
    }

    function backupSharedDatabase() {
      setBusy(true);
      setError("");
      setStatus("Creating shared database backup…");
      runOperation({ mode: "backupSharedDatabase" }).then(function (result) {
        setStatus("Backup created: " + result.path);
        DirtyPlugins.ui.notify("Dirty Plugins database backup created.");
      }).catch(function (caught) { setError(caught.message || String(caught)); setStatus(""); })
        .finally(function () { setBusy(false); });
    }

    function resetCurrentPool() {
      if (dirty) { setError("Wait for the automatic save before resetting a pool."); return; }
      var category = primaryCategory();
      if (!window.confirm("Reset every " + cohortLabel(draft.defaultCohort) + " rating in the " + category.name + " category? Export first if you need a backup.")) return;
      setBusy(true);
      setError("");
      runOperation({
        mode: "resetPool",
        categoryId: category.id,
        cohort: draft.defaultCohort,
        confirm: "RESET",
      }).then(function (result) {
        return loadRatingIndex().then(function () {
          setStatus("Reset " + result.reset + " rating(s); " + result.failed + " failed.");
          DirtyPlugins.ui.notify("DirtyRank reset " + result.reset + " rating(s).");
        });
      }).catch(function (caught) { setError(caught.message || String(caught)); })
        .finally(function () { setBusy(false); });
    }

    var editingCategories = categoriesFor(draft, editingCohort);

    return h(SettingsCard, {
      className: "dirty-rank-settings-card",
      bodyClassName: "dirty-rank-settings-body",
      plugin: props.plugin,
      footer: h("div", { className: "card-footer dirty-plugins-card-footer dirty-rank-settings-actions" },
        h("span", { className: "dirty-rank-settings-status", role: "status" }, error || status)
      ),
    },
      h(Section, {
        title: "Performer sexes",
        description: "Select the performer sexes that can appear in DirtyRank battles and leaderboards. When only one is enabled, sex selectors are hidden on both pages.",
      },
        h("div", { className: "dirty-rank-cohort-options" },
          COHORTS.map(function (item) {
            var checked = draft.enabledCohorts.indexOf(item[0]) !== -1;
            return h(Toggle, {
              checked: checked,
              disabled: checked && draft.enabledCohorts.length === 1,
              key: item[0],
              label: item[1],
              onChange: function (value) { toggleCohort(item[0], value); },
            });
          })
        ),
        draft.enabledCohorts.length > 1 && h("div", { className: "dirty-rank-settings-grid dirty-rank-settings-grid-compact", style: { marginTop: "0.9rem" } },
          h(Field, { id: "dirty-rank-default-cohort", label: "Default performer cohort" },
            h("select", {
              className: "form-control",
              id: "dirty-rank-default-cohort",
              onChange: function (event) { changed({ defaultCohort: event.target.value }); },
              value: draft.defaultCohort,
            }, COHORTS.filter(function (item) {
              return draft.enabledCohorts.indexOf(item[0]) !== -1;
            }).map(function (item) { return h("option", { key: item[0], value: item[0] }, item[1]); }))
          )
        )
      ),
      h(Section, {
        title: "Navigation",
        description: "Choose which DirtyRank pages appear in Stash's utility navigation. Hidden pages remain available through direct links.",
      },
        h("div", { className: "dirty-rank-settings-row" },
          h(Toggle, { checked: draft.showLeaderboardsInMenu, label: "Show Leaderboards in the navigation menu", onChange: function (value) { changed({ showLeaderboardsInMenu: value }); } })
        )
      ),
      h(Section, {
        title: "Battle presentation",
        description: "Control what is revealed on performer cards. These choices do not change the rating pools.",
      },
        h("div", { className: "dirty-rank-settings-row" },
          h(Toggle, { checked: draft.showRatingsBeforeVote, label: "Show ratings and ranks before voting", onChange: function (value) { changed({ showRatingsBeforeVote: value }); } }),
          h(Toggle, { checked: draft.hidePerformerImages, label: "Hide performer images in battles", onChange: function (value) { changed({ hidePerformerImages: value }); } }),
          h(Toggle, { checked: draft.includePerformersWithoutImages, label: "Include performers without profile images", onChange: function (value) { changed({ includePerformersWithoutImages: value }); } })
        )
      ),
      h(Section, {
        title: "Confidence goal",
        description: "Choose what the information-gain matchmaker should stabilize. Every mode samples all eligible performers at least once; narrower goals stop refining ratings that no longer affect the result.",
      },
        h("div", { className: "dirty-rank-settings-grid dirty-rank-settings-grid-compact" },
          h(Field, { id: "dirty-rank-confidence-goal", label: "Optimize battles for" },
            h("select", {
              className: "form-control",
              id: "dirty-rank-confidence-goal",
              onChange: function (event) { changed({ confidenceGoal: event.target.value }); },
              value: draft.confidenceGoal,
            },
              h("option", { value: "ranking" }, "Leaderboard order (recommended)"),
              h("option", { value: "top" }, "Top performers"),
              h("option", { value: "all" }, "Every performer rating")
            )
          ),
          draft.confidenceGoal === "top" && h(Field, { id: "dirty-rank-confidence-top-n", label: "Top performers to stabilize" },
            h("input", {
              className: "form-control",
              id: "dirty-rank-confidence-top-n",
              max: 1000,
              min: 1,
              onChange: function (event) { changed({ confidenceTopN: Number(event.target.value) }); },
              step: 1,
              type: "number",
              value: draft.confidenceTopN,
            })
          )
        )
      ),
      h(Section, {
        title: "Rating categories",
        description: "Each performer sex has its own category set. Overall rating is the weighted average of the enabled category ratings and is not battled directly.",
      },
        draft.enabledCohorts.length > 1 && h("div", { className: "dirty-rank-category-cohort" },
          h(Field, { id: "dirty-rank-category-cohort", label: "Categories for performer sex" },
            h("select", {
              className: "form-control",
              id: "dirty-rank-category-cohort",
              onChange: function (event) { setEditingCohort(event.target.value); },
              value: editingCohort,
            }, COHORTS.filter(function (item) {
              return draft.enabledCohorts.indexOf(item[0]) !== -1;
            }).map(function (item) { return h("option", { key: item[0], value: item[0] }, item[1]); }))
          )
        ),
        h("div", { className: "dirty-rank-category-list" },
          editingCategories.map(function (category, index) {
            return h("div", { className: "dirty-rank-category-editor", key: editingCohort + ":" + category.id },
              h("div", { className: "dirty-rank-category-toolbar d-flex flex-wrap align-items-center justify-content-between" },
                h("span", { className: "dirty-rank-category-sex" }, cohortLabel(editingCohort)),
                h("div", { className: "dirty-rank-data-tools d-flex flex-wrap align-items-center" },
                  h("button", { "aria-label": "Move category up", className: "dirty-ui-icon-button", disabled: index === 0, onClick: function () { moveCategory(index, -1); }, type: "button" }, "↑"),
                  h("button", { "aria-label": "Move category down", className: "dirty-ui-icon-button", disabled: index === editingCategories.length - 1, onClick: function () { moveCategory(index, 1); }, type: "button" }, "↓"),
                  h("button", { "aria-label": "Remove category", className: "dirty-ui-icon-button", disabled: editingCategories.length <= 1, onClick: function () { removeCategory(index); }, type: "button" }, "×")
                )
              ),
              h("div", { className: "dirty-rank-category-basics" },
                h(Field, { id: "dirty-rank-category-name-" + editingCohort + "-" + index, label: "Name" },
                  h("input", { className: "form-control", id: "dirty-rank-category-name-" + editingCohort + "-" + index, maxLength: 80, onChange: function (event) { updateCategory(index, { name: event.target.value }); }, type: "text", value: category.name })
                ),
                h(Field, { id: "dirty-rank-category-weight-" + editingCohort + "-" + index, label: "Overall weight" },
                  h("input", { className: "form-control", id: "dirty-rank-category-weight-" + editingCohort + "-" + index, min: 0.01, max: 1000, step: 0.1, onChange: function (event) { updateCategory(index, { weight: Number(event.target.value) }); }, type: "number", value: category.weight })
                )
              ),
              h(Field, { id: "dirty-rank-category-description-" + editingCohort + "-" + index, label: "Description" },
                h("textarea", { className: "form-control", id: "dirty-rank-category-description-" + editingCohort + "-" + index, maxLength: 500, onChange: function (event) { updateCategory(index, { description: event.target.value }); }, rows: 2, value: category.description })
              ),
              h(Toggle, { checked: category.enabled, label: "Enable this category", onChange: function (value) { updateCategory(index, { enabled: value }); } })
            );
          }),
          h("button", { className: "btn btn-secondary dirty-ui-button", onClick: addCategory, type: "button" }, "+ Add category")
        )
      ),
      h(Section, {
        title: "Options",
        description: "Export all DirtyRank ratings or reset the first enabled category for the selected default performer sex.",
      },
        h("div", { className: "dirty-rank-data-tools d-flex flex-wrap align-items-center" },
          h("button", { className: "btn btn-secondary dirty-ui-button", disabled: busy, onClick: exportRatings, type: "button" }, "Export ratings"),
          h("button", { className: "btn btn-secondary dirty-ui-button", disabled: busy, onClick: backupSharedDatabase, type: "button" }, "Backup Dirty Plugins database"),
          h("button", { className: "btn btn-danger dirty-ui-button", disabled: busy || dirty, onClick: resetCurrentPool, type: "button" }, "Reset current pool")
        )
      ),
      h("details", { className: "dirty-rank-advanced" },
        h("summary", { className: "dirty-rank-advanced-summary" },
          h("span", null, "Advanced configuration"),
          h("span", { className: "dirty-rank-advanced-hint" }, "Matchmaking and Glicko-2 parameters")
        ),
        h("div", { className: "dirty-rank-advanced-body" },
          h("p", { className: "dirty-rank-advanced-copy" }, "Ratings use full floating-point precision and have no normal ceiling. Recent-pair and calibration values are soft penalties inside the information-gain optimizer. Change Glicko-2 values only before starting a new pool or after resetting it."),
          h("div", { className: "dirty-rank-settings-grid" },
            h(Field, {
              id: "dirty-rank-evidence-weight",
              label: "Evidence per battle",
              help: "How strongly one comparison reduces uncertainty. 1.0 is standard Glicko-2; 2.0 treats a consistent subjective choice as twice the rating evidence while still recording one battle.",
            },
              h("input", { className: "form-control", id: "dirty-rank-evidence-weight", min: 1, max: 3, onChange: function (event) { changed({ evidenceWeight: Number(event.target.value) }); }, step: 0.1, type: "number", value: draft.evidenceWeight })
            ),
            h(Field, { id: "dirty-rank-repeat-window", label: "Recent pairs to avoid" },
              h("input", { className: "form-control", id: "dirty-rank-repeat-window", min: 0, max: 100, onChange: function (event) { changed({ avoidRepeatWindow: Number(event.target.value) }); }, type: "number", value: draft.avoidRepeatWindow })
            ),
            h(Field, { id: "dirty-rank-calibration", label: "Calibration matches (%)" },
              h("input", { className: "form-control", id: "dirty-rank-calibration", min: 0, max: 100, onChange: function (event) { changed({ calibrationPercent: Number(event.target.value) }); }, type: "number", value: draft.calibrationPercent })
            ),
            [
              ["initialRating", "Initial rating", -100000, 100000, 1],
              ["initialDeviation", "Initial deviation", 30, 1000, 1],
              ["initialVolatility", "Initial volatility", 0.0001, 1, 0.001],
              ["tau", "Tau", 0.01, 2, 0.01],
              ["deviationFloor", "Deviation floor", 1, 1000, 1],
              ["provisionalDeviation", "Provisional threshold", 1, 1000, 1],
            ].map(function (definition) {
              return h(Field, { id: "dirty-rank-" + definition[0], key: definition[0], label: definition[1] },
                h("input", { className: "form-control", id: "dirty-rank-" + definition[0], min: definition[2], max: definition[3], step: definition[4], onChange: function (event) { var update = {}; update[definition[0]] = Number(event.target.value); changed(update); }, type: "number", value: draft[definition[0]] })
              );
            })
          )
        )
      )
    );
  }

  function DirtyRankBattleNavLink() {
    return h(NavLink, { className: "nav-utility dirty-rank-nav-link", exact: true, to: ROUTE_PATH },
      h("button", { className: "minimal d-flex align-items-center h-100 dirty-rank-nav-button", title: "DirtyRank performer battles", type: "button" },
        h("span", { "aria-hidden": "true" }, "⚔")
      )
    );
  }

  function DirtyRankGauntletLaunch(props) {
    return h("div", { className: "dirty-rank-gauntlet-launch" },
      h(NavLink, {
        className: "btn btn-secondary dirty-rank-gauntlet-launch-button",
        title: "Refine this performer's category ratings through focused DirtyRank battles",
        to: GAUNTLET_ROUTE_PATH.replace(":performerId", props.performer.id),
      }, h("span", { "aria-hidden": "true" }, "⚔"), " Start Gauntlet")
    );
  }

  function DirtyRankLeaderboardsNavLink() {
    return h(NavLink, { className: "nav-utility dirty-rank-nav-link dirty-rank-leaderboards-nav-link", exact: true, to: LEADERBOARDS_ROUTE_PATH },
      h("button", { className: "minimal d-flex align-items-center h-100 dirty-rank-nav-button", title: "DirtyRank leaderboards", type: "button" },
        h("span", { "aria-hidden": "true" }, "🏆")
      )
    );
  }

  function DirtyRankNavLinks() {
    var visibleState = useState(false);
    var showLeaderboards = visibleState[0];
    var setShowLeaderboards = visibleState[1];

    useEffect(function () {
      var active = true;
      function refreshNavigation() {
        DirtyPlugins.getPluginSettings(PLUGIN_ID).then(function (configuration) {
          if (active) setShowLeaderboards(settingsFromConfiguration(configuration).showLeaderboardsInMenu);
        }).catch(function (error) {
          console.error("DirtyRank could not refresh navigation settings", error);
        });
      }
      function configurationChanged(event) {
        if (!event.detail || event.detail.pluginId === PLUGIN_ID) refreshNavigation();
      }
      refreshNavigation();
      window.addEventListener(CONFIGURATION_CHANGED_EVENT, configurationChanged);
      return function () {
        active = false;
        window.removeEventListener(CONFIGURATION_CHANGED_EVENT, configurationChanged);
      };
    }, []);

    return h(Fragment, null,
      h(DirtyRankBattleNavLink, null),
      showLeaderboards && h(DirtyRankLeaderboardsNavLink, null)
    );
  }

  PluginApi.register.route(ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(GAUNTLET_ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(LEADERBOARDS_ROUTE_PATH, DirtyRankLeaderboardsRoute);
  if (DirtyPlugins.registerSettingsPanel) {
    DirtyPlugins.registerSettingsPanel(PLUGIN_ID, DirtyRankSettings);
  }
  void refreshOverallSortSettings();
  window.addEventListener(CONFIGURATION_CHANGED_EVENT, function (event) {
    if (!event.detail || event.detail.pluginId === PLUGIN_ID) void refreshOverallSortSettings();
  });
  PluginApi.patch.before("FilteredPerformerList", function (props) {
    if (!isPerformerListRoute() || !props) return [props];
    return [Object.assign({}, props, {
      filterHook: overallPerformerFilterHook(props.filterHook),
    })];
  });
  PluginApi.patch.after("FilteredPerformerList", function () {
    var args = Array.prototype.slice.call(arguments);
    var result = args.pop();
    if (!isPerformerListRoute()) return result;
    return h(DirtyRankPerformerListShell, null, result);
  });
  PluginApi.patch.after("PerformerDetailsPanel", function () {
    var args = Array.prototype.slice.call(arguments);
    var result = args.pop();
    var props = args[0];
    if (!props || !props.performer || !props.performer.id) return result;
    return h(Fragment, null, result, h(DirtyRankGauntletLaunch, { performer: props.performer }));
  });
  PluginApi.patch.instead("PerformerList", function () {
    var args = Array.prototype.slice.call(arguments);
    var next = args.pop();
    var props = args[0];
    if (!isPerformerListRoute() || !props || !props.filter || !props.filter[OVERALL_SORT_ACTIVE]) {
      return next.apply(null, args);
    }
    return h(DirtyRankSortedPerformerList, { listProps: props, next: next });
  });
  PluginApi.patch.before("MainNavBar.UtilityItems", function (props) {
    return [{ children: h(Fragment, null, props.children, h(DirtyRankNavLinks, null)) }];
  });
  window[INSTANCE_KEY] = {
    algorithms: {
      categoryConfidence: categoryConfidence,
      estimatedMatchesToConfidence: estimatedMatchesToConfidence,
      expectedDeviationAfterBattle: expectedDeviationAfterBattle,
      leaderboardData: leaderboardData,
      leaderboardPoolFor: leaderboardPoolFor,
      pairInformationGain: pairInformationGain,
      precisionTier: precisionTier,
      applyRatingIndex: applyRatingIndex,
      selectGauntletPair: selectGauntletPair,
      selectPair: selectPair,
      settingsFromConfiguration: settingsFromConfiguration,
    },
    leaderboardsRoute: LEADERBOARDS_ROUTE_PATH,
    gauntletRoute: GAUNTLET_ROUTE_PATH,
    overallSortLabel: OVERALL_SORT_LABEL,
    route: ROUTE_PATH,
  };
})();
