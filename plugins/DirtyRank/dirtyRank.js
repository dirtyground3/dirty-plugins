(function () {
  "use strict";

  var INSTANCE_KEY = "__dirtyRankPlugin";
  if (window[INSTANCE_KEY]) {
    if (window.DirtyPlugins && window.DirtyPlugins.debugLog) {
      window.DirtyPlugins.debugLog("dirtyRank", "skipped: duplicate load");
    }
    return;
  }

  var PluginApi = window.PluginApi;
  var DirtyPlugins = window.DirtyPlugins;
  if (!PluginApi || !DirtyPlugins || !DirtyPlugins.graphql) {
    if (window.DirtyPlugins && window.DirtyPlugins.debugLog) {
      window.DirtyPlugins.debugLog("dirtyRank", "skipped: required runtime missing", {
        hasPluginApi: Boolean(PluginApi),
        hasDirtyPlugins: Boolean(DirtyPlugins),
      });
    }
    return;
  }
  window.__dirtyCurrentPluginId = "dirtyRank";
  // Claim the instance before any registration side effects. Stash cannot
  // unregister patches, so if a later step throws, the next asset reload must
  // skip re-registration instead of stacking duplicate routes and listeners.
  // The full annotation replaces this placeholder at the end of the IIFE.
  window[INSTANCE_KEY] = {};
  var debugLog = DirtyPlugins.debugLog || function () {};
  var debugScriptSrc = null;
  try {
    debugScriptSrc = (typeof document !== "undefined" && document.currentScript)
      ? document.currentScript.src
      : null;
  } catch (_debugError) {}
  debugLog("dirtyRank", "script started", { script: debugScriptSrc });

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
  var SharedButton = DirtyPlugins.react && DirtyPlugins.react.Button;
  var SharedBadge = DirtyPlugins.react && DirtyPlugins.react.Badge;
  var SharedField = DirtyPlugins.react && DirtyPlugins.react.Field;
  var SharedIconButton = DirtyPlugins.react && DirtyPlugins.react.IconButton;
  var SharedMetric = DirtyPlugins.react && DirtyPlugins.react.Metric;
  var SharedNavAction = DirtyPlugins.react && DirtyPlugins.react.NavAction;
  var SharedPagination = DirtyPlugins.react && DirtyPlugins.react.Pagination;
  var SharedSaveStatus = DirtyPlugins.react && DirtyPlugins.react.SaveStatus;
  var SharedStatisticSelector = DirtyPlugins.react && DirtyPlugins.react.StatisticSelector;
  var SharedDialog = DirtyPlugins.react && DirtyPlugins.react.Dialog;
  var PLUGIN_ID = "dirtyRank";
  var ROUTE_PATH = "/plugins/dirty-rank";
  var GAUNTLET_ROUTE_PATH = "/plugins/dirty-rank/gauntlet/:performerId";
  var BATTLE_CATEGORY_ROUTE_PATH = ROUTE_PATH + "/category/:categoryId/:mode?";
  var LEADERBOARDS_ROUTE_PATH = "/plugins/dirty-rank-leaderboards";

  function documentationCapture() {
    if (DirtyPlugins.captureEnabled) return DirtyPlugins.captureEnabled(window.location.search);
    var query = new URLSearchParams(window.location.search);
    return query.get("docsCapture") === "1" || query.get("censorMedia") === "1";
  }

  function RankCrown() {
    return h("svg", { "aria-hidden": "true", className: "dirty-rank-crown-icon", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round", focusable: "false" },
      h("path", { d: "M3 8l5 4 4-8 4 8 5-4-3 11H6z", fill: "currentColor", fillOpacity: "0.18" }),
      h("path", { d: "M6 22h12M7 16h10" }),
      h("circle", { cx: "12", cy: "2.5", r: "1.1", fill: "currentColor", stroke: "none" }),
      h("circle", { cx: "2", cy: "6", r: "1.1", fill: "currentColor", stroke: "none" }),
      h("circle", { cx: "22", cy: "6", r: "1.1", fill: "currentColor", stroke: "none" })
    );
  }

  function RankButton(props) {
    if (SharedButton) return h(SharedButton, props, props.children);
    return h("button", {
      className: "btn btn-" + (props.tone || "secondary") +
        " dirty-ui-button dirty-ui-control" +
        (props.compact ? " dirty-ui-control-compact" : "") +
        (props.className ? " " + props.className : ""),
      disabled: props.disabled,
      "aria-pressed": props.pressed == null ? undefined : Boolean(props.pressed),
      onClick: props.onClick,
      type: "button",
    }, props.children);
  }
  var PERFORMERS_ROUTE_PATH = "/performers";
  var OVERALL_SORT_VALUE = "dirty_rank_overall";
  var OVERALL_SORT_LABEL = "Overall score";
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
  var LEADERBOARD_TOP_OPTIONS = [
    { count: 3, name: "Podium" },
    { count: 4, name: "Mount Rushmore", theme: "rushmore" },
    { count: 5, name: "Fingers", theme: "fingers" },
  ];
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

  var OVERALL_SCORE_STRATEGIES = [
    { id: "weighted", name: "Simple weighted", description: "80% category position + 20% matchup strength, averaged using category weights. Scores stay between 0 and 100." },
    { id: "power", name: "Power mean", description: "Combine the current category scores with a weighted power mean. Strong categories compensate more for weaker ones, while every category still contributes. Scores stay between 0 and 100." },
  ];
  var OVERALL_SCORE_PARAMETERS = [
    { key: "overallPower", label: "Power", strategy: "power", min: 1, max: 4, step: 0.1,
      help: "1 matches Simple weighted. 2 mildly emphasizes strengths, 3 is the recommended starting point, and 4 emphasizes them more. Decimals are supported." },
  ];
  function overallScoreStrategy(value) {
    return OVERALL_SCORE_STRATEGIES.find(function (strategy) { return strategy.id === value; }) || OVERALL_SCORE_STRATEGIES[0];
  }
  function overallScoreParameterError(value, definition) {
    return !String(value == null ? "" : value).trim() || !Number.isFinite(Number(value)) ||
      Number(value) < definition.min || Number(value) > definition.max
      ? "Enter a number from " + definition.min + " to " + definition.max + "." : "";
  }

  var DEFAULT_SETTINGS = {
    categoriesByCohort: defaultCategoriesByCohort(),
    defaultCohort: "FEMALE",
    enabledCohorts: ["FEMALE"],
    showBattlesInMenu: true,
    showLeaderboardsInMenu: true,
    leaderboardTopCount: 3,
    leaderboardPerformerCount: 18,
    leaderboardView: "gallery",
    overallScoreStrategy: "weighted",
    overallPower: 3,
    showRatingsBeforeVote: false,
    hidePerformerImages: false,
    hideBattleStandings: false,
    autoPlayTopScenes: false,
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
  // Lichess core values: lila Glicko.scala and scalachess glicko/model.scala.
  // Evidence weight and matchmaking controls are DirtyRank extensions.
  var RATING_PRESETS = [
    {
      id: "default", name: "Default",
      description: "Original DirtyRank values. 2× evidence, 12 recent pairs avoided, 10% calibration, tau 0.5.",
      settings: { initialRating: 1000, initialDeviation: 350, initialVolatility: 0.06, deviationFloor: 30, provisionalDeviation: 100, evidenceWeight: 2, avoidRepeatWindow: 12, calibrationPercent: 10, tau: 0.5 },
    },
    {
      id: "chess", name: "Chess",
      description: "Lichess core Glicko-2 values. 1× evidence, 12 recent pairs avoided, 10% calibration, tau 0.75.",
      settings: { initialRating: 1500, initialDeviation: 500, initialVolatility: 0.09, deviationFloor: 45, provisionalDeviation: 110, evidenceWeight: 1, avoidRepeatWindow: 12, calibrationPercent: 10, tau: 0.75 },
    },
    {
      id: "confident", name: "Confident",
      description: "For consistent preferences. 2× evidence, 24 recent pairs avoided, 5% calibration, tau 0.5.",
      settings: { initialRating: 1000, initialDeviation: 350, initialVolatility: 0.06, deviationFloor: 30, provisionalDeviation: 100, evidenceWeight: 2, avoidRepeatWindow: 24, calibrationPercent: 5, tau: 0.5 },
    },
    {
      id: "extremely-confident", name: "Extremely confident",
      description: "Fewer battles for stable preferences. 3× evidence, 48 recent pairs avoided, 0% calibration, tau 0.3. Mistaken votes also carry more weight.",
      settings: { initialRating: 1000, initialDeviation: 350, initialVolatility: 0.06, deviationFloor: 30, provisionalDeviation: 100, evidenceWeight: 3, avoidRepeatWindow: 48, calibrationPercent: 0, tau: 0.3 },
    },
  ];

  function ratingPresetFor(settings) {
    return RATING_PRESETS.filter(function (preset) {
      return Object.keys(preset.settings).every(function (key) {
        return settings[key] === preset.settings[key];
      });
    })[0] || null;
  }

  function ratingParameters(settings) {
    var parameters = {};
    Object.keys(RATING_PRESETS[0].settings).forEach(function (key) { parameters[key] = settings[key]; });
    return parameters;
  }

  var overallSortSettings = DEFAULT_SETTINGS;
  var overallSortRevision = 0;
  var overallSortListeners = new Set();
  var overallFilterHookCache = new WeakMap();
  var ratingStateIndex = new Map();
  var overallReferencePerformers = null;
  var overallCategoryScoreCache = new Map();
  var categoryLeaderboardRankCache = new Map();
  var performerMediaCache = new Map();
  var ratingIndexRevision = 0;
  var ratingIndexPromise = null;
  var leaderboardFilterListener = null;

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
    var normalized = String(value || "").trim().toLowerCase();
    if (normalized.normalize) normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "category";
  }

  function uniqueCategoryId(name, used) {
    var base = slug(name);
    var id = base;
    var suffix = 1;
    while (used.has(id)) {
      var ending = "-" + suffix;
      id = base.slice(0, 64 - ending.length).replace(/-+$/g, "") + ending;
      suffix += 1;
    }
    used.add(id);
    return id;
  }

  function parseGenderBoxes(value, enabledCohorts) {
    value = parseMaybeJson(value);
    var used = new Set();
    var boxes = [];
    if (Array.isArray(value)) value.slice(0, 24).forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      var id = String(raw.id || "").trim().toUpperCase();
      if (!/^(FEMALE|MALE|TRANSGENDER_FEMALE|TRANSGENDER_MALE|INTERSEX|NON_BINARY|BOX-[A-Z0-9-]{1,60})$/.test(id) || used.has(id)) return;
      used.add(id);
      boxes.push({ id: id, name: String(raw.name || cohortLabel(id)).trim().slice(0, 80),
        genders: parseEnabledCohorts(raw.genders, COHORTS.some(function (item) { return item[0] === id; }) ? [id] : ["FEMALE"]),
        enabled: DirtyPlugins.values.coerceBoolean(raw.enabled, true) });
    });
    if (!boxes.length) boxes = COHORTS.map(function (item) {
      return { id: item[0], name: item[1], genders: [item[0]], enabled: enabledCohorts.indexOf(item[0]) !== -1 };
    });
    if (!boxes.some(function (box) { return box.enabled; })) boxes[0].enabled = true;
    return boxes;
  }

  function boxFor(settings, cohort) {
    return (settings.genderBoxes || []).find(function (box) { return box.id === cohort; }) ||
      { id: cohort, name: cohortLabel(cohort), genders: [cohort] };
  }

  function boxOptions(settings, enabledOnly) {
    return settings.genderBoxes.filter(function (box) { return !enabledOnly || box.enabled; }).map(function (box) { return [box.id, box.name]; });
  }

  function boxGenders(settings, cohort) {
    return boxFor(settings, cohort).genders;
  }

  function boxGendersLabel(settings, cohort) {
    return boxGenders(settings, cohort).map(cohortLabel).join(" + ");
  }

  function categoryIncludes(performer, category, cohort, settings) {
    return boxGenders(settings, cohort).indexOf(String(performer.gender || "").toUpperCase()) !== -1;
  }

  function categoryById(settings, categoryId, cohort) {
    return categoriesFor(settings, cohort).find(function (category) { return category.id === categoryId; });
  }

  function categoriesForPerformer(settings, cohort, performer) {
    return categoriesFor(settings, cohort).filter(function (category) {
      return category.enabled && (!performer || categoryIncludes(performer, category, cohort, settings));
    });
  }

  function battleCohortFor(settings, performer, requestedCohort) {
    var available = settings.enabledCohorts.filter(function (cohort) {
      return categoriesForPerformer(settings, cohort, performer).length > 0;
    });
    if (available.indexOf(requestedCohort) !== -1) return requestedCohort;
    if (available.indexOf(settings.defaultCohort) !== -1) return settings.defaultCohort;
    var preferred = performer ? String(performer.gender || "").toUpperCase() : settings.defaultCohort;
    return available.indexOf(preferred) !== -1 ? preferred : available[0] || "";
  }

  function parseCategoryList(value, cohort) {
    if (!Array.isArray(value)) value = DEFAULT_CATEGORY_DEFINITIONS;
    var used = new Set(["overall"]);
    var categories = [];
    value.slice(0, 24).forEach(function (raw) {
      if (!raw || typeof raw !== "object") return;
      var name = String(raw.name || "").trim().slice(0, 80);
      if (!name) return;
      var id = uniqueCategoryId(name, used);
      categories.push({
        id: id,
        name: name,
        description: String(raw.description || "").trim().slice(0, 500),
        enabled: DirtyPlugins.values.coerceBoolean(raw.enabled, true),
        weight: number(raw.weight, 1, 0.01, 1000),
      });
    });
    return categories.length ? categories : DEFAULT_CATEGORY_DEFINITIONS.map(function (item) { return Object.assign({}, item); });
  }

  function parseCategoriesByCohort(value, boxes) {
    value = parseMaybeJson(value);
    var result = {};
    var source = value && typeof value === "object" ? value : {};
    COHORTS.forEach(function (cohort) {
      result[cohort[0]] = parseCategoryList(source[cohort[0]], cohort[0]);
    });
    Object.keys(source).concat((boxes || []).map(function (box) { return box.id; })).forEach(function (id) {
      if (!result[id]) result[id] = parseCategoryList(source[id], id);
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
    var genderBoxes = parseGenderBoxes(source.genderBoxes, parseEnabledCohorts(source.enabledCohorts, [cohort]));
    var enabledCohorts = genderBoxes.filter(function (box) { return box.enabled; }).map(function (box) { return box.id; });
    if (enabledCohorts.indexOf(cohort) === -1) cohort = enabledCohorts[0];
    var confidenceGoal = String(source.confidenceGoal || "ranking").toLowerCase();
    if (["all", "ranking", "top"].indexOf(confidenceGoal) === -1) confidenceGoal = "ranking";
    return {
      categoriesByCohort: parseCategoriesByCohort(source.categories, genderBoxes),
      genderBoxes: genderBoxes,
      defaultCohort: cohort,
      enabledCohorts: enabledCohorts,
      showBattlesInMenu: DirtyPlugins.values.coerceBoolean(source.showBattlesInMenu, true),
      showLeaderboardsInMenu: DirtyPlugins.values.coerceBoolean(source.showLeaderboardsInMenu, true),
      leaderboardTopCount: leaderboardTopCount(source.leaderboardTopCount),
      leaderboardPerformerCount: leaderboardPerformerCount(source.leaderboardPerformerCount, source.leaderboardTopCount),
      leaderboardView: source.leaderboardView === "table" ? "table" : "gallery",
      overallScoreStrategy: overallScoreStrategy(source.overallScoreStrategy).id,
      overallPower: number(source.overallPower, 3, 1, 4),
      showRatingsBeforeVote: DirtyPlugins.values.coerceBoolean(source.showRatingsBeforeVote, false),
      hidePerformerImages: DirtyPlugins.values.coerceBoolean(source.hidePerformerImages, false),
      hideBattleStandings: DirtyPlugins.values.coerceBoolean(source.hideBattleStandings, false),
      autoPlayTopScenes: DirtyPlugins.values.coerceBoolean(source.autoPlayTopScenes, false),
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
    return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), loadRatingIndex(), queryPerformers()]).then(function (values) {
      overallSortSettings = settingsFromConfiguration(values[0]);
      notifyRatingListeners();
    }).catch(function (error) {
      console.error("DirtyRank could not refresh overall score sort settings", error);
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
      genderBoxes: JSON.stringify(settings.genderBoxes),
      enabledCohorts: JSON.stringify(settings.enabledCohorts),
      showBattlesInMenu: Boolean(settings.showBattlesInMenu),
      showLeaderboardsInMenu: Boolean(settings.showLeaderboardsInMenu),
      leaderboardTopCount: leaderboardTopCount(settings.leaderboardTopCount),
      leaderboardPerformerCount: Number(settings.leaderboardPerformerCount),
      leaderboardView: settings.leaderboardView === "table" ? "table" : "gallery",
      overallScoreStrategy: overallScoreStrategy(settings.overallScoreStrategy).id,
      overallPower: number(settings.overallPower, 3, 1, 4),
      showRatingsBeforeVote: Boolean(settings.showRatingsBeforeVote),
      hidePerformerImages: Boolean(settings.hidePerformerImages),
      hideBattleStandings: Boolean(settings.hideBattleStandings),
      autoPlayTopScenes: Boolean(settings.autoPlayTopScenes),
      includePerformersWithoutImages: Boolean(settings.includePerformersWithoutImages),
      confidenceGoal: settings.confidenceGoal,
      confidenceTopN: Number(settings.confidenceTopN),
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
    overallCategoryScoreCache.clear();
    categoryLeaderboardRankCache.clear();
    overallSortRevision += 1;
    overallSortListeners.forEach(function (listener) { listener(overallSortRevision); });
  }

  function applyRatingIndex(payload) {
    var revision = Number(payload && payload.revision) || 0;
    // A vote can advance the index while a slower loadAll is in flight. Ignore a
    // stale response so it cannot erase the newer state or lower the revision.
    if (revision < ratingIndexRevision) return payload;
    var states = payload && payload.states && typeof payload.states === "object" ? payload.states : {};
    ratingStateIndex.clear();
    Object.keys(states).forEach(function (performerId) {
      ratingStateIndex.set(String(performerId), states[performerId]);
    });
    ratingIndexRevision = Math.max(ratingIndexRevision, revision);
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

  function loadNativePerformerCard() {
    if (DirtyPlugins.native && DirtyPlugins.native.loadComponent) {
      return DirtyPlugins.native.loadComponent("PerformerCard").catch(function () { return null; });
    }
    if (PluginApi.components && PluginApi.components.PerformerCard) return Promise.resolve();
    if (!PluginApi.utils || !PluginApi.utils.loadComponents || !PluginApi.loadableComponents || !PluginApi.loadableComponents.PerformerCard) {
      return Promise.resolve();
    }
    return PluginApi.utils.loadComponents([PluginApi.loadableComponents.PerformerCard]);
  }

  function queryPerformers(withCardData) {
    return DirtyPlugins.graphql(
      "query DirtyRankPerformers($filter:FindFilterType){" +
        "findPerformers(filter:$filter){count performers{" +
          "id name gender image_path scene_count" +
          (withCardData ? " disambiguation birthdate country favorite rating100 o_counter image_count gallery_count group_count performer_count alias_list tags{id name} stash_ids{endpoint stash_id}" : "") +
        "}}}",
      { filter: { per_page: -1, sort: "name", direction: "ASC" } }
    ).then(function (data) {
      var performers = (data.findPerformers && data.findPerformers.performers) || [];
      setOverallReferencePerformers(performers);
      return performers;
    });
  }

  function setOverallReferencePerformers(performers) {
    // Always supplied by the unfiltered query, never by a page or search result.
    overallReferencePerformers = new Map();
    performers.forEach(function (performer) {
      overallReferencePerformers.set(String(performer.id), performer);
    });
    notifyRatingListeners();
  }

  function loadNativePreviewPlayer() {
    if (DirtyPlugins.native && DirtyPlugins.native.loadComponent) {
      return DirtyPlugins.native.loadComponent("ScenePlayer").catch(function () { return null; });
    }
    if (PluginApi.components && PluginApi.components.ScenePlayer) return Promise.resolve();
    if (!PluginApi.utils || !PluginApi.utils.loadComponents || !PluginApi.loadableComponents || !PluginApi.loadableComponents.ScenePlayer) return Promise.resolve();
    return PluginApi.utils.loadComponents([PluginApi.loadableComponents.ScenePlayer]);
  }

  function loadPreferredMedia(performerId, fullScene, signal) {
    var cacheKey = String(performerId) + (fullScene ? ":scene" : ":preferred");
    if (performerMediaCache.has(cacheKey)) return Promise.resolve(performerMediaCache.get(cacheKey));
    var request = DirtyPlugins.graphql(
      "query DirtyRankPreferredMedia($filter:FindFilterType,$sceneFilter:SceneFilterType,$markerFilter:SceneMarkerFilterType,$includeMarkers:Boolean!){" +
        "top:findScenes(filter:$filter,scene_filter:$sceneFilter){scenes{" +
          "id title rating100 paths{stream} sceneStreams{url mime_type label}" +
        "}}" +
        "markers:findSceneMarkers(filter:{per_page:-1},scene_marker_filter:$markerFilter) @include(if:$includeMarkers){scene_markers{" +
          "id title seconds end_seconds scene{id title rating100 paths{stream} sceneStreams{url mime_type label}}" +
        "}}}",
      {
        filter: { per_page: 1, sort: "rating", direction: "DESC" },
        sceneFilter: { performers: { value: [String(performerId)], modifier: "INCLUDES" } },
        markerFilter: { performers: { value: [String(performerId)], modifier: "INCLUDES" } },
        includeMarkers: !fullScene,
      },
      { signal: signal }
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
      if (!fullScene && markers[0] && markers[0].scene) {
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
    }).then(function (media) {
      // Pending requests belong to their card so cancellation cannot affect another preview.
      if (media && (!signal || !signal.aborted)) performerMediaCache.set(cacheKey, media);
      return media;
    });
    return request;
  }

  function scenePlaybackUrl(scene) {
    var streams = scene && Array.isArray(scene.sceneStreams) ? scene.sceneStreams : [];
    var directPath = scene && scene.paths && scene.paths.stream;
    var preferred = streams.find(function (stream) {
      return stream.mime_type === "video/mp4" && /direct/i.test(stream.label || "");
    }) || streams.find(function (stream) {
      return stream.mime_type === "video/mp4" && /720p/i.test(stream.label || "");
    }) || streams.find(function (stream) {
      return stream.mime_type === "video/mp4";
    });
    // Stash's original stream can be a format the browser cannot play (e.g. WMV).
    return preferred && preferred.url || directPath || "";
  }

  function needsNativePreview(scene) {
    return /\/stream\.(mp4|webm)(?:\?|$)/i.test(scenePlaybackUrl(scene));
  }

  function NativePreviewPlayer(props) {
    var query = PluginApi.utils.StashService.useFindScene(props.media.id);
    if (query.loading) return h("div", { className: "dirty-rank-scene-loading", role: "status" }, "Loading scene player…");
    if (query.error || !query.data || !query.data.findScene) {
      return h("div", { className: "dirty-rank-scene-error", role: "alert" }, "Could not load the scene player. Close it and try again.");
    }
    return h(LoadedNativePreview, { scene: query.data.findScene, marker: props.media.marker });
  }

  function LoadedNativePreview(props) {
    var hostRef = useRef(null);
    var marker = props.marker;
    var initialTimestamp = useState(function () {
      if (marker) return Number(marker.seconds) || 0;
      var duration = Number(props.scene.files[0] && props.scene.files[0].duration);
      return Number.isFinite(duration) && duration > 0 ? duration * (0.3 + Math.random() * 0.4) : 0;
    })[0];
    var sendSetTimestamp = useCallback(function () {}, []);
    useEffect(function () {
      var host = hostRef.current;
      if (!host) return undefined;
      var player = null;
      function checkMarkerEnd() {
        if (!player || player.isDisposed() || !marker) return;
        var start = Number(marker.seconds) || 0;
        var end = Number(marker.end_seconds);
        if (!Number.isFinite(end) || end <= start) end = start + 30;
        if (player.currentTime() >= end) player.pause();
      }
      function checkMarkerStart() {
        if (!player || player.isDisposed() || !marker) return;
        var start = Number(marker.seconds) || 0;
        var end = Number(marker.end_seconds);
        if (!Number.isFinite(end) || end <= start) end = start + 30;
        if (player.currentTime() < start || player.currentTime() >= end) player.currentTime(start);
      }
      function attach() {
        var element = host.querySelector("video-js");
        var next = element && element.player;
        if (!next || next === player) return;
        detach();
        player = next;
        player.ready(function () {
          if (player !== next || next.isDisposed()) return;
          // Each preview starts muted without changing Stash's saved volume preference.
          var persistence = next.persistVolume && next.persistVolume();
          if (persistence) {
            persistence.enabled = false;
            persistence.ready = function () {};
          }
          next.muted(true);
        });
        player.on("timeupdate", checkMarkerEnd);
        player.on("play", checkMarkerStart);
      }
      function detach() {
        if (player && !player.isDisposed()) {
          player.off("timeupdate", checkMarkerEnd);
          player.off("play", checkMarkerStart);
        }
        player = null;
      }
      attach();
      var observer = new MutationObserver(attach);
      observer.observe(host, { childList: true, subtree: true });
      return function () {
        observer.disconnect();
        detach();
        // ScenePlayer owns disposal of its player and active stream on unmount.
      };
    }, [marker]);
    return h("div", { className: "dirty-rank-native-preview dirty-rank-scene-player", ref: hostRef },
      h(PluginApi.components.ScenePlayer, {
        scene: props.scene,
        autoplay: true,
        permitLoop: false,
        hideScrubberOverride: true,
        initialTimestamp: initialTimestamp,
        sendSetTimestamp: sendSetTimestamp,
        onComplete: sendSetTimestamp,
      })
    );
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
    var title = props.pool.overallScore
      ? tier.label + " category precision · " + props.pool.ratedCategories + "/" + props.pool.totalCategories +
        " categories rated · mean category RD " + props.pool.deviation.toFixed(1)
      : tier.label + " precision · RD " + props.pool.deviation.toFixed(1);
    title += " · " + props.pool.matches.toLocaleString() + (props.pool.matches === 1 ? " battle" : " battles");
    if (SharedBadge) return h(SharedBadge, {
      className: "text-uppercase dirty-rank-status-" + tier.id,
      title: title,
    }, tier.label);
    return h("span", {
      className: "badge badge-pill text-uppercase dirty-rank-status-" + tier.id,
      title: title,
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
    if (!category || !categoryIncludes(performer, category, cohort, settings)) return false;
    if (!settings.includePerformersWithoutImages && !performer.image_path) return false;
    return Boolean(category && category.enabled);
  }

  function pairToken(left, right) {
    return [String(left.id), String(right.id)].sort().join(":");
  }

  function recentPairWindow(recentTokens, windowSize) {
    // slice(-0) returns the whole history, so zero must disable the penalty.
    if (!(windowSize > 0)) return [];
    return recentTokens.slice(-windowSize);
  }

  function rankPerformers(performers, categoryId, cohort, settings) {
    var category = categoryById(settings, categoryId, cohort);
    return performers.filter(function (performer) {
      return categoryIncludes(performer, category, cohort, settings) &&
        poolFor(performer, categoryId, cohort, settings).matches > 0;
    }).sort(function (left, right) {
      return poolFor(right, categoryId, cohort, settings).rating -
        poolFor(left, categoryId, cohort, settings).rating;
    });
  }

  function overallCategoryScoreFor(performer, categoryId, cohort, settings) {
    var cacheKey = keyFor(categoryId, cohort) + "|" + settings.initialRating + "|" + boxGenders(settings, cohort).join(",");
    if (!overallCategoryScoreCache.has(cacheKey)) {
      var entries = [];
      ratingStateIndex.forEach(function (_state, performerId) {
        if (overallReferencePerformers) {
          var reference = overallReferencePerformers.get(performerId);
          if (!reference || !categoryIncludes(reference, categoryById(settings, categoryId, cohort), cohort, settings)) return;
        }
        var pool = poolFor({ id: performerId }, categoryId, cohort, settings);
        if (pool.matches > 0) entries.push({ id: performerId, rating: pool.rating });
      });
      entries.sort(function (left, right) { return left.rating - right.rating; });
      var groups = [];
      entries.forEach(function (entry) {
        var group = groups[groups.length - 1];
        if (!group || group.rating !== entry.rating) {
          group = { rating: entry.rating, ids: [], below: groups.length ? group.below + group.ids.length : 0 };
          groups.push(group);
        }
        group.ids.push(entry.id);
      });
      var scores = new Map();
      groups.forEach(function (group) {
        var position = 50;
        var strength = 50;
        if (entries.length > 1) {
          // Average ties, excluding the performer itself from both comparisons.
          position = 100 * (group.below + (group.ids.length - 1) / 2) / (entries.length - 1);
          var expected = groups.reduce(function (sum, opponent) {
            // Rating-only logistic expected score (no RD penalty). Extreme gaps
            // saturate safely; draws count half. Grouping also avoids repeat work.
            return sum + opponent.ids.length / (1 + Math.exp((opponent.rating - group.rating) / GLICKO_SCALE));
          }, 0);
          strength = 100 * (expected - 0.5) / (entries.length - 1);
        }
        var value = {
          rating: 0.8 * position + 0.2 * strength, position: position, strength: strength,
        };
        group.ids.forEach(function (id) { scores.set(id, value); });
      });
      overallCategoryScoreCache.set(cacheKey, scores);
    }
    // Missing categories and pools with no comparison evidence stay neutral.
    return overallCategoryScoreCache.get(cacheKey).get(String(performer.id)) ||
      { rating: 50, position: 50, strength: 50 };
  }

  function overallPoolFor(performer, cohort, settings) {
    var categories = categoriesFor(settings, cohort).filter(function (category) {
      return category.enabled && Number(category.weight) > 0 && categoryIncludes(performer, category, cohort, settings);
    });
    var totalWeight = categories.reduce(function (sum, category) {
      return sum + Number(category.weight);
    }, 0);
    if (!totalWeight) {
      return { rating: 50, deviation: settings.initialDeviation, matches: 0, overallScore: true, ratedCategories: 0, totalCategories: 0 };
    }
    var strategy = overallScoreStrategy(settings.overallScoreStrategy).id;
    var power = number(settings.overallPower, 3, 1, 4);
    var totals = categories.reduce(function (result, category) {
      var pool = poolFor(performer, category.id, cohort, settings);
      var weight = Number(category.weight);
      var score = overallCategoryScoreFor(performer, category.id, cohort, settings).rating;
      result.rating += score * weight;
      // Power mean combines the same non-negative category scores as Simple weighted.
      // Scaling before exponentiation keeps intermediates in the 0–1 range.
      if (strategy === "power") result.powerRating += Math.pow(score / 100, power) * weight;
      result.deviation += pool.deviation * weight;
      result.matches += pool.matches;
      if (pool.matches > 0) result.ratedCategories += 1;
      return result;
    }, { rating: 0, powerRating: 0, deviation: 0, matches: 0, ratedCategories: 0 });
    var rating = totals.rating / totalWeight;
    if (strategy === "power" && power !== 1) {
      rating = 100 * Math.pow(totals.powerRating / totalWeight, 1 / power);
    }
    return {
      rating: rating,
      deviation: totals.deviation / totalWeight,
      matches: totals.matches,
      overallScore: true,
      ratedCategories: totals.ratedCategories,
      totalCategories: categories.length,
    };
  }

  function rankOverallPerformers(performers, cohort, settings) {
    return performers.filter(function (performer) {
      return categoriesForPerformer(settings, cohort, performer).length > 0 &&
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
      return category.enabled && Number(category.weight) > 0 && categoryIncludes(performer, category, cohort, settings);
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
      return (leaderboardId === OVERALL_LEADERBOARD_ID ? categoriesForPerformer(settings, cohort, performer).length > 0 :
        categoryIncludes(performer, categoryById(settings, leaderboardId, cohort), cohort, settings)) &&
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
    var cohort = battleCohortFor(settings, performer, "");
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

  function freshCategoryBattleEstimate(performerCount, settings) {
    // Compare presets on a fresh pool, not on ratings already earned in one
    // category. Informative, similarly rated opponents refine both participants.
    var effective = settingsFromConfiguration(settings);
    var count = Math.max(0, Math.floor(performerCount));
    if (count < 2) return { battles: 0, performers: count, capped: false };
    var initial = {
      rating: effective.initialRating, deviation: effective.initialDeviation,
      volatility: effective.initialVolatility, matches: 0,
    };
    var matches = estimatedMatchesToConfidence(initial, effective.provisionalDeviation, initial, effective);
    return { battles: Math.ceil(count * matches / 2), performers: count, capped: matches === 1000 };
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
      var maximumIndividualBattles = 0;
      entries.forEach(function (entry) {
        var pool = entry.pool;
        var stable = pool.matches > 0 && pool.deviation <= settings.provisionalDeviation;
        if (stable) established += 1;
        if (!stable) {
          var uncertainty = Math.max(1, pool.deviation / settings.provisionalDeviation);
          activeWeights.set(String(entry.performer.id), pool.matches > 0 ? Math.min(12, 1 + uncertainty * uncertainty) : 8);
        }
        var requiredBattles = estimatedMatchesToConfidence(
          pool,
          settings.provisionalDeviation,
          representativeOpponent(pool, opponentDeviation, settings),
          settings
        );
        remainingParticipations += requiredBattles;
        maximumIndividualBattles = Math.max(maximumIndividualBattles, requiredBattles);
      });
      var allCompletedBattles = Math.floor(totalMatches / 2);
      var allRemainingBattles = Math.max(Math.ceil(remainingParticipations / 2), maximumIndividualBattles);
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
    var recent = new Set(recentPairWindow(recentTokens, settings.avoidRepeatWindow));
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
    var recent = new Set(recentPairWindow(recentTokens, settings.avoidRepeatWindow));
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

  function kingsOrder(performers, category, cohort, settings) {
    var eligible = performers.filter(function (performer) {
      return categoryEligible(performer, category, settings, cohort);
    });
    var ranked = rankPerformers(eligible, category.id, cohort, settings);
    var ranks = {};
    var rankedIds = new Set();
    ranked.forEach(function (performer, index) {
      ranks[performer.id] = index + 1;
      rankedIds.add(String(performer.id));
    });
    var unrated = eligible.filter(function (performer) { return !rankedIds.has(String(performer.id)); });
    // Unrated performers have no leaderboard position, so vary their order within the starting group.
    for (var index = unrated.length - 1; index > 0; index -= 1) {
      var swapIndex = Math.floor(Math.random() * (index + 1));
      var previous = unrated[index];
      unrated[index] = unrated[swapIndex];
      unrated[swapIndex] = previous;
    }
    return { eligible: eligible.length, ordered: unrated.concat(ranked.reverse()), ranks: ranks };
  }

  function takeKingsChallenger(ordered) {
    // Stay close to the bottom of the remaining ranking without making every round predictable.
    var band = Math.min(3, ordered.length);
    var index = Math.floor(Math.pow(Math.random(), 2) * band);
    return ordered.splice(index, 1)[0];
  }

  function selectKingsStartingPair(performers, category, cohort, settings) {
    var order = kingsOrder(performers, category, cohort, settings);
    if (order.ordered.length < 2) return { pair: null, eligible: order.eligible, ranks: order.ranks };
    var startingBand = order.ordered.slice(0, Math.min(3, order.ordered.length));
    var first = takeKingsChallenger(startingBand);
    var second = takeKingsChallenger(startingBand);
    var information = pairInformationGain(poolFor(first, category.id, cohort, settings), poolFor(second, category.id, cohort, settings), settings);
    return {
      eligible: order.eligible,
      expectedRdReduction: information.rdReduction,
      goalLabel: "Kings of the hill",
      pair: Math.random() < 0.5 ? [first, second] : [second, first],
      ranks: order.ranks,
    };
  }

  function selectKingsPair(performers, winner, winnerSide, defeatedIds, category, cohort, settings) {
    var order = kingsOrder(performers, category, cohort, settings);
    var defeated = new Set(defeatedIds.map(function (id) { return String(id); }));
    var incumbent = order.ordered.find(function (performer) { return String(performer.id) === String(winner.id); });
    var challengers = order.ordered.filter(function (performer) {
      return String(performer.id) !== String(winner.id) && !defeated.has(String(performer.id));
    });
    var challenger = incumbent && challengers.length ? takeKingsChallenger(challengers) : null;
    var information = challenger ? pairInformationGain(
      poolFor(incumbent, category.id, cohort, settings),
      poolFor(challenger, category.id, cohort, settings),
      settings
    ) : null;
    return {
      eligible: order.eligible,
      expectedRdReduction: information ? information.rdReduction : 0,
      goalLabel: "Kings of the hill",
      incumbentId: String(winner.id),
      incumbentSide: winnerSide,
      pair: challenger ? winnerSide === "right" ? [challenger, incumbent] : [incumbent, challenger] : null,
      ranks: order.ranks,
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
    var NativePerformerCard = showImages && PluginApi.components && PluginApi.components.PerformerCard;
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
    var mediaRequestRef = useRef(0);
    var mediaAbortRef = useRef(null);
    var autoPreviewTimerRef = useRef(null);
    var videoRef = useRef(null);
    var setVideoRef = useCallback(function (node) {
      if (videoRef.current && videoRef.current !== node) releaseVideo(videoRef.current);
      videoRef.current = node;
    }, []);
    var playbackStartRef = useRef(null);
    var showMedia = showImages || Boolean(scene) || sceneLoading;
    useEffect(function () {
      cardMountedRef.current = true;
      return function () {
        cardMountedRef.current = false;
        cancelMediaRequest();
      };
    }, []);
    useEffect(function () {
      if (props.settings.autoPlayTopScenes && Number(performer.scene_count || 0) > 0) {
        setSceneLoading(true);
        autoPreviewTimerRef.current = window.setTimeout(function () { openTopScene(true); }, 400);
      }
      return cancelMediaRequest;
    }, [performer.id, props.settings.autoPlayTopScenes]);
    function releaseVideo(video) {
      video.pause();
      video.removeAttribute("src");
      // Reset the media resource immediately, including during React's ref-detachment phase.
      video.load();
    }
    function cancelMediaRequest() {
      window.clearTimeout(autoPreviewTimerRef.current);
      autoPreviewTimerRef.current = null;
      mediaRequestRef.current += 1;
      if (mediaAbortRef.current) mediaAbortRef.current.abort();
      mediaAbortRef.current = null;
    }
    function markerEndSeconds(media) {
      if (!media || !media.marker) return null;
      var start = Number(media.marker.seconds) || 0;
      var end = Number(media.marker.end_seconds);
      return Number.isFinite(end) && end > start ? end : start + 30;
    }
    function startMarkerPlayback(event) {
      if (!scene || !cardMountedRef.current || event.currentTarget !== videoRef.current) return;
      if (playbackStartRef.current === null) {
        if (scene.marker) {
          playbackStartRef.current = Number(scene.marker.seconds) || 0;
        } else {
          var duration = event.currentTarget.duration;
          if (!Number.isFinite(duration) || duration <= 0) return;
          playbackStartRef.current = duration * (0.3 + Math.random() * 0.4);
        }
        event.currentTarget.currentTime = playbackStartRef.current;
      } else {
        return;
      }
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
      if (props.disabled || props.crowned || event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        props.onChoose();
      }
    }
    function chooseFromClick(event) {
      if (props.disabled || props.crowned || event.defaultPrevented) return;
      if (event.target.closest && event.target.closest(".dirty-rank-native-portrait")) return;
      props.onChoose();
    }
    function chooseNativePhoto(event) {
      var target = event.target;
      if (!target.closest || !target.closest(".thumbnail-section")) return;
      if (target.closest("button, input, select, textarea")) return;
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (!props.disabled && !props.crowned) props.onChoose();
    }
    function toggleTopScene(event) {
      event.preventDefault();
      event.stopPropagation();
      if (scene || sceneLoading) {
        cancelMediaRequest();
        setVideoRef(null);
        setScene(null);
        setSceneLoading(false);
        setSceneError("");
        return;
      }
      openTopScene(props.settings.autoPlayTopScenes);
    }
    function openTopScene(fullScene) {
      cancelMediaRequest();
      var requestId = ++mediaRequestRef.current;
      var controller = new AbortController();
      mediaAbortRef.current = controller;
      playbackStartRef.current = null;
      setSceneLoading(true);
      setSceneError("");
      loadPreferredMedia(performer.id, fullScene, controller.signal).then(function (result) {
        if (result && needsNativePreview(result)) {
          return loadNativePreviewPlayer().then(function () { return result; });
        }
        return result;
      }).then(function (result) {
        if (!cardMountedRef.current || requestId !== mediaRequestRef.current) return;
        if (!result || !scenePlaybackUrl(result)) {
          setSceneError("No playable scene found.");
          return;
        }
        setScene(result);
      }).catch(function (error) {
        if (!cardMountedRef.current || requestId !== mediaRequestRef.current || controller.signal.aborted) return;
        setSceneError(error.message || String(error));
      }).finally(function () {
        if (cardMountedRef.current && requestId === mediaRequestRef.current) {
          mediaAbortRef.current = null;
          setSceneLoading(false);
        }
      });
    }
    return h(
      "div",
      {
        "aria-disabled": props.disabled ? "true" : undefined,
        "aria-label": props.crowned ? "King of the hill: " + performer.name : "Choose " + performer.name,
        className: "dirty-rank-card" + (NativePerformerCard ? " dirty-rank-battle-native" : "") + (showMedia ? "" : " dirty-rank-card-no-image") + (props.gauntletTarget ? " dirty-rank-card-gauntlet-target" : "") + (props.kingTarget ? " dirty-rank-card-king-target" : "") + (props.crowned ? " dirty-rank-card-crowned" : "") + (props.disabled ? " dirty-rank-card-disabled" : ""),
        onClick: chooseFromClick,
        onKeyDown: chooseFromKeyboard,
        role: props.crowned ? "group" : "button",
        tabIndex: props.disabled || props.crowned ? -1 : 0,
      },
      props.hillMode && h("div", { className: "dirty-rank-hill-role" + (props.kingTarget ? " dirty-rank-hill-role-champion" : "") },
        h(RankCrown, null),
        h("span", null, props.crowned ? "Hill conquered" : props.kingTarget ? "Reigning champion" : props.hillOpening ? "Contender" : "Challenger")
      ),
      showMedia && h(
        "div",
        {
          className: "dirty-rank-image-wrap" + (imageReady ? " dirty-rank-image-ready" : "") + (scene || sceneLoading ? " dirty-rank-scene-playing" : "") + (!showImages ? " dirty-rank-media-no-portrait" : ""),
        },
        NativePerformerCard ? h("div", {
          className: "dirty-rank-native-portrait dirty-rank-native-card",
          onClickCapture: chooseNativePhoto,
          onKeyDown: function (event) { event.stopPropagation(); },
        },
          h(NativePerformerCard, { performer: performer }),
          !props.crowned && h("span", { className: "dirty-rank-native-vote-hint" }, "Click photo to vote"),
          reveal && props.rank && h("span", { className: "dirty-rank-rank" }, "#" + props.rank)
        ) : showImages && h("div", { className: "dirty-rank-portrait" },
          performer.image_path
          ? h("img", {
              alt: "",
              className: "dirty-rank-image",
              loading: "eager",
              onError: function () { setImageReady(true); },
              onLoad: function () { setImageReady(true); },
              src: performer.image_path,
            })
          : h("div", { className: "dirty-rank-image-placeholder d-flex flex-column align-items-center justify-content-center" },
              h("span", null, "◇"),
              h("span", null, "No performer image")
            ),
          performer.image_path && !imageReady && h("div", { "aria-hidden": "true", className: "dirty-rank-image-loading" }),
          !props.crowned && (scene || sceneLoading) && h("span", { className: "dirty-rank-photo-vote-hint" }, "Click photo to vote"),
          reveal && props.rank && h("span", { className: "dirty-rank-rank" }, "#" + props.rank)
        ),
        (scene || sceneLoading) && h("div", {
          className: "dirty-rank-scene-panel",
          onClick: function (event) { event.stopPropagation(); },
          onKeyDown: function (event) { event.stopPropagation(); },
        },
          scene && needsNativePreview(scene) && PluginApi.components && PluginApi.components.ScenePlayer &&
            PluginApi.utils && PluginApi.utils.StashService && PluginApi.utils.StashService.useFindScene
            ? h(NativePreviewPlayer, { key: scene.id, media: scene })
            : scene ? h("video", {
            "aria-label": "Scene preview for " + performer.name,
            className: "dirty-rank-scene-player",
            controls: true,
            muted: true,
            onLoadedMetadata: startMarkerPlayback,
            onDurationChange: startMarkerPlayback,
            onPlay: keepMarkerPlaybackInRange,
            onTimeUpdate: stopAtMarkerEnd,
            onError: function (event) {
              if (event.currentTarget !== videoRef.current || !cardMountedRef.current) return;
              setSceneError("This scene could not be played. Close it and try again.");
              setVideoRef(null);
              setScene(null);
            },
            playsInline: true,
            preload: "metadata",
            ref: setVideoRef,
            src: scenePlaybackUrl(scene),
          }) : h("div", { className: "dirty-rank-scene-loading", role: "status" }, "Loading top scene…"),
          scene && h("div", { className: "dirty-rank-scene-caption" },
            h("span", null, scene.marker
              ? "Marker · " + (scene.marker.title || scene.title || "Untitled")
              : scene.title || "Top-rated scene"),
            Number.isFinite(scene.rating100) && h("span", null, "Rating " + scene.rating100)
          )
        )
      ),
      !showImages && reveal && props.rank && h("span", { className: "dirty-rank-rank" }, "#" + props.rank),
      props.gauntletTarget && h("span", { className: "dirty-rank-gauntlet-target" }, "Gauntlet target"),
      props.kingTarget && !props.hillMode && h("span", { className: "dirty-rank-king-target" }, h(RankCrown, null), "King of the hill"),
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
          h("span", null, Number(performer.scene_count || 0).toLocaleString() + " scenes")
        ),
        h("div", { className: "dirty-rank-scene-actions" },
          h(RankButton, {
            compact: true,
            className: "dirty-rank-play-scene",
            disabled: props.disabled || Number(performer.scene_count || 0) < 1,
            onClick: toggleTopScene,
          }, sceneLoading ? "Cancel loading" : scene ? (scene.marker ? "Close marker" : "Close top scene") : "▶ Play top scene")
        ),
        sceneError && h("div", { className: "dirty-rank-scene-error dirty-ui-text-error", role: "alert" }, sceneError),
        h("div", { className: "dirty-rank-rating-row d-flex flex-wrap align-items-center" },
          reveal
            ? h(Fragment, null,
                h("span", { className: "dirty-rank-rating-value" }, Math.round(pool.rating).toLocaleString()),
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
        h("div", { className: "dirty-rank-eyebrow" }, boxFor(props.settings, props.cohort).name + " · " + boxGendersLabel(props.settings, props.cohort)),
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
          status + " · rating " + Math.round(pool.rating).toLocaleString() + (rank ? " · #" + rank : "")
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
    if (SharedMetric) return h(SharedMetric, {
      className: "dirty-rank-stat dirty-ui-feature-card",
      label: props.label,
      value: props.value,
      detail: props.detail,
    });
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

  function leaderboardTopCount(value) {
    var count = Number(value);
    return LEADERBOARD_TOP_OPTIONS.some(function (option) { return option.count === count; }) ? count : 3;
  }

  function leaderboardStatPath(categoryId, cohort) {
    return LEADERBOARDS_ROUTE_PATH + "/" + encodeURIComponent(categoryId === OVERALL_LEADERBOARD_ID ? "overall" : categoryId) +
      (cohort ? "?box=" + encodeURIComponent(cohort) : "");
  }

  function leaderboardPerformerCount(value, topCount) {
    var multiple = leaderboardTopCount(topCount);
    if (value === null || value === undefined || !String(value).trim()) value = 18;
    var count = integer(value, 18, multiple * 2, 1000);
    return Math.min(Math.floor(1000 / multiple) * multiple, Math.ceil(count / multiple) * multiple);
  }

  function leaderboardPerformerCountError(settings) {
    var multiple = leaderboardTopCount(settings.leaderboardTopCount);
    var count = Number(settings.leaderboardPerformerCount);
    var maximum = Math.floor(1000 / multiple) * multiple;
    return !String(settings.leaderboardPerformerCount).trim() || !Number.isInteger(count) ||
      count < multiple * 2 || count > maximum || count % multiple !== 0
      ? "Choose a multiple of " + multiple + " between " + (multiple * 2) + " and " + maximum + "."
      : "";
  }

  function leaderboardFeaturedCount(props) {
    return leaderboardTopCount(props.topCount === undefined ? props.settings.leaderboardTopCount : props.topCount);
  }

  function leaderboardPageSize(settings, topCount, featuredCount) {
    return leaderboardPerformerCount(settings.leaderboardPerformerCount, topCount) - featuredCount;
  }

  function overallCategoryScoresTitle(performer, leaderboardId, cohort, settings) {
    if (leaderboardId !== OVERALL_LEADERBOARD_ID) return undefined;
    var overall = overallPoolFor(performer, cohort, settings);
    return "Overall: " + overall.rating.toFixed(1) + " · " + overallScoreStrategy(settings.overallScoreStrategy).name +
      " · " + overall.ratedCategories + "/" + overall.totalCategories +
      " categories rated\n" + categoriesFor(settings, cohort).filter(function (category) {
      return category.enabled && Number(category.weight) > 0 && categoryIncludes(performer, category, cohort, settings);
    }).map(function (category) {
      var pool = poolFor(performer, category.id, cohort, settings);
      var rank = categoryLeaderboardRankFor(performer, category.id, cohort, settings);
      var score = overallCategoryScoreFor(performer, category.id, cohort, settings);
      return category.name + ": " + (pool.matches
        ? (rank ? "#" + rank.toLocaleString() : "Unranked") + " (" + Math.round(pool.rating).toLocaleString() + ")"
        : "Unrated") + " · score " + score.rating.toFixed(2);
    }).join("\n");
  }

  function categoryLeaderboardRankFor(performer, categoryId, cohort, settings) {
    if (!overallReferencePerformers) return null;
    var cacheKey = keyFor(categoryId, cohort) + "|" + settings.initialRating + "|" + settings.includePerformersWithoutImages + "|" + boxGenders(settings, cohort).join(",");
    if (!categoryLeaderboardRankCache.has(cacheKey)) {
      var eligible = Array.from(overallReferencePerformers.values()).filter(function (reference) {
        return settings.includePerformersWithoutImages || Boolean(reference.image_path);
      });
      var ranks = new Map();
      rankPerformers(eligible, categoryId, cohort, settings).forEach(function (reference, index) {
        ranks.set(String(reference.id), index + 1);
      });
      categoryLeaderboardRankCache.set(cacheKey, ranks);
    }
    return categoryLeaderboardRankCache.get(cacheKey).get(String(performer.id)) || null;
  }

  function leaderboardRatingText(pool, settings) {
    var precision = pool.precision || precisionTier(pool, settings);
    var text = pool.overallScore ? pool.rating.toFixed(1) : Math.round(pool.rating).toLocaleString();
    return text + (precision.id === "refined" || precision.id === "excellent" ? "" : "*");
  }

  function leaderboardIdFromPath(pathname) {
    var prefix = LEADERBOARDS_ROUTE_PATH + "/";
    if (pathname.indexOf(prefix) !== 0) return OVERALL_LEADERBOARD_ID;
    var segment = pathname.slice(prefix.length);
    if (!segment || segment.indexOf("/") !== -1) return OVERALL_LEADERBOARD_ID;
    try { return segment === "overall" ? OVERALL_LEADERBOARD_ID : decodeURIComponent(segment); }
    catch (_error) { return OVERALL_LEADERBOARD_ID; }
  }

  function RankStatisticSelector(props) {
    var history = Router.useHistory();
    return h(SharedStatisticSelector, {
      id: "dirty-rank-statistic",
      value: props.value,
      options: [{ value: OVERALL_LEADERBOARD_ID, label: "Overall" }].concat(props.categories.map(function (category) { return { value: category.id, label: category.name }; })),
      onSelect: function (id) { var path = leaderboardStatPath(id, props.boxId); history.push(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(path) : path); },
    });
  }

  function LeaderboardInfoPopover(props) {
    var Dropdown = PluginApi.libraries.Bootstrap.Dropdown;
    return h(Dropdown, { className: "dirty-rank-info-dropdown" },
      h(Dropdown.Toggle, {
        id: props.id,
        variant: "secondary",
        className: "dirty-ui-button dirty-ui-control",
      }, props.label),
      h(Dropdown.Menu, {
        className: "dirty-rank-info-popover dirty-ui-panel" + (props.className ? " " + props.className : ""),
        role: "region",
        "aria-label": props.label,
        renderOnMount: false,
      }, props.children)
    );
  }

  function LeaderboardPodium(props) {
    var NativePerformerCard = PluginApi.components && PluginApi.components.PerformerCard;
    var topCount = leaderboardTopCount(props.topCount);
    var showcase = LEADERBOARD_TOP_OPTIONS.filter(function (option) { return option.count === topCount; })[0];
    var top = props.ranked.slice(0, topCount);
    var podiumOrder = [1, 0, 2];
    var displayOrder = topCount === 3 ? podiumOrder : top.map(function (_performer, index) { return index; });
    if (!top.length) {
      return h(StateView, { title: "No rated performers", detail: "Complete a battle in this category to create its leaderboard." });
    }
    return h("section", {
      "aria-label": showcase.name,
      className: "dirty-rank-podium" + (topCount > 3 ? " dirty-rank-podium-expanded dirty-rank-showcase dirty-rank-showcase-" + showcase.theme : ""),
      style: { "--dirty-rank-top-count": topCount },
    },
      displayOrder.filter(function (index) { return top[index]; }).map(function (index) {
        var performer = top[index];
        var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
        return h("article", { className: "dirty-rank-podium-place d-flex flex-column dirty-rank-podium-" + (index + 1), key: performer.id },
          h("div", { className: NativePerformerCard ? "dirty-rank-native-card" : "dirty-rank-podium-card" },
            NativePerformerCard ? h(NativePerformerCard, { performer: performer }) : h(NavLink, { className: "dirty-rank-podium-image-link", to: "/performers/" + performer.id },
              performer.image_path
                ? h("img", { alt: "", className: "dirty-rank-podium-image", loading: "lazy", src: performer.image_path })
                : h("div", { className: "dirty-rank-podium-placeholder d-flex align-items-center justify-content-center" }, "◇")
            ),
            h("div", { className: "dirty-rank-podium-copy text-center" },
              !NativePerformerCard && h(NavLink, { className: "dirty-rank-podium-name text-truncate", to: "/performers/" + performer.id }, performer.name),
              h("div", { className: "dirty-rank-leaderboard-rating-row" },
                h("strong", { className: "dirty-rank-leaderboard-rank" }, "#" + (index + 1)),
                h("strong", { className: "dirty-rank-podium-rating", title: overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings) }, leaderboardRatingText(pool, props.settings))
              )
            )
          ),
          topCount === 3 && h("div", { "aria-hidden": "true", className: "dirty-rank-podium-step" },
            h("span", null, index + 1)
          ),
          topCount > 3 && h("div", { "aria-hidden": "true", className: "dirty-rank-showcase-base" },
            h("span", null, topCount === 4 ? ["I", "II", "III", "IV"][index] : index + 1)
          )
        );
      })
    );
  }

  function LeaderboardPagination(props) {
    if (props.totalPages <= 1) return null;
    var summary = "Page " + props.page.toLocaleString() + " of " +
      props.totalPages.toLocaleString() + " · ranks " +
      props.firstRank.toLocaleString() + "–" + props.lastRank.toLocaleString();
    if (SharedPagination) return h(SharedPagination, {
      ariaLabel: "Leaderboard pages",
      className: "dirty-rank-pagination",
      onPageChange: props.onPageChange,
      page: props.page,
      summary: summary,
      totalPages: props.totalPages,
    });
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

  function leaderboardEntries(ranked) {
    return ranked.map(function (performer, index) {
      return { performer: performer, rank: index + 1 };
    });
  }

  function filteredLeaderboardEntries(entries, performerIds) {
    if (!performerIds) return entries;
    return entries.filter(function (entry) { return performerIds.has(String(entry.performer.id)); });
  }

  function serializeLeaderboardPerformerFilter(filter) {
    var find = filter && typeof filter.makeFindFilter === "function" ? filter.makeFindFilter() : {};
    var object = filter && typeof filter.makeFilter === "function" ? filter.makeFilter() : {};
    var cleanFind = Object.assign({}, find || {});
    delete cleanFind.page;
    delete cleanFind.per_page;
    delete cleanFind.sort;
    delete cleanFind.direction;
    var count = filter && typeof filter.count === "function" ? Number(filter.count()) || 0 : 0;
    return {
      find: JSON.parse(JSON.stringify(cleanFind)),
      object: JSON.parse(JSON.stringify(object || {})),
      count: count + (cleanFind.q ? 1 : 0),
    };
  }

  function DirtyRankLeaderboardFilterCapture(props) {
    var model = serializeLeaderboardPerformerFilter(props.filter);
    var key = JSON.stringify(model);
    useEffect(function () {
      if (leaderboardFilterListener) leaderboardFilterListener(model);
    }, [key]);
    return null;
  }

  function queryLeaderboardPerformerIds(model, signal) {
    var ids = new Set();
    var page = 1;
    function next() {
      return DirtyPlugins.graphql(
        "query DirtyRankFilteredPerformerIds($filter:FindFilterType!,$performerFilter:PerformerFilterType){" +
          "findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id}}}",
        {
          filter: Object.assign({}, model.find, { page: page, per_page: 500, sort: "id", direction: "ASC" }),
          performerFilter: model.object,
        },
        { signal: signal }
      ).then(function (data) {
        var result = data.findPerformers || {};
        var performers = result.performers || [];
        performers.forEach(function (performer) { ids.add(String(performer.id)); });
        if (performers.length && page * 500 < Number(result.count || 0)) {
          page += 1;
          return next();
        }
        return ids;
      });
    }
    return next();
  }

  function leaderboardStandingEntries(props) {
    if (props.entries) return props.entries;
    return leaderboardEntries(props.ranked).slice(leaderboardFeaturedCount(props));
  }

  function filteredLeaderboardPanelProps(entries) {
    return {
      emptyMessage: "No rated performers match these filters.",
    };
  }

  function paginatedLeaderboard(entries, page, pageSize) {
    var totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
    var currentPage = Math.max(1, Math.min(totalPages, page));
    var start = (currentPage - 1) * pageSize;
    var lastIndex = Math.min(start + pageSize, entries.length) - 1;
    return {
      currentPage: currentPage,
      firstRank: entries.length ? entries[start].rank : 0,
      items: entries.slice(start, start + pageSize),
      lastRank: entries.length ? entries[lastIndex].rank : 0,
      start: start,
      total: entries.length,
      totalPages: totalPages,
    };
  }

  function LeaderboardTable(props) {
    var entries = leaderboardStandingEntries(props);
    var ranked = props.ranked || entries.map(function (entry) { return entry.performer; });
    var topCount = leaderboardFeaturedCount(props);
    var pageSize = leaderboardPageSize(props.settings, topCount, props.showFeatured === false ? 0 : Math.min(topCount, ranked.length));
    var page = paginatedLeaderboard(entries, props.page, pageSize);
    return h("section", { className: "dirty-rank-standings-panel dirty-ui-feature-card" },
      !page.total
        ? h("div", { className: "dirty-rank-empty-standings" }, props.emptyMessage || (ranked.length ? "Every rated performer is featured above." : "No standings yet."))
        : h("div", { className: "dirty-rank-table-wrap dirty-ui-table-wrap" },
            h("table", { className: "table table-hover mb-0 dirty-ui-table dirty-rank-standings-table" },
              h("thead", null, h("tr", null,
                h("th", { scope: "col" }, "Rank"),
                h("th", { scope: "col" }, "Performer"),
                h("th", { scope: "col" }, props.leaderboardId === OVERALL_LEADERBOARD_ID ? "Score" : "Rating")
              )),
              h("tbody", null, page.items.map(function (entry) {
                var performer = entry.performer;
                var rank = entry.rank;
                var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
                return h("tr", { key: performer.id },
                  h("td", { className: "dirty-rank-table-rank" }, "#" + rank),
                  h("td", null, h(NavLink, { className: "dirty-rank-table-performer d-inline-flex align-items-center", to: "/performers/" + performer.id },
                    performer.image_path
                      ? h("img", { alt: "", className: "rounded-circle", loading: "lazy", src: performer.image_path })
                      : h("span", { className: "dirty-rank-table-avatar-placeholder d-inline-flex align-items-center justify-content-center rounded-circle" }, "◇"),
                    h("span", { className: "text-truncate" }, performer.name)
                  )),
                  h("td", { className: "dirty-rank-table-rating", title: overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings) }, leaderboardRatingText(pool, props.settings))
                );
              }))
            ),
            h(LeaderboardPagination, {
              firstRank: page.firstRank,
              lastRank: page.lastRank,
              onPageChange: props.onPageChange,
              page: page.currentPage,
              totalPages: page.totalPages,
            })
          )
    );
  }

  function LeaderboardGalleryCard(props) {
    var NativePerformerCard = PluginApi.components && PluginApi.components.PerformerCard;
    var performer = props.performer;
    var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
    var imageState = useState(!performer.image_path);
    var imageReady = imageState[0];
    var setImageReady = imageState[1];
    var failedState = useState(false);
    var imageFailed = failedState[0];
    var setImageFailed = failedState[1];
    return h("article", { className: NativePerformerCard ? "dirty-rank-native-card" : "dirty-rank-gallery-card" },
      NativePerformerCard ? h(NativePerformerCard, { performer: performer }) : h(NavLink, { className: "dirty-rank-gallery-image-link", to: "/performers/" + performer.id },
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
        performer.image_path && !imageFailed && !imageReady && h("span", { "aria-hidden": "true", className: "dirty-rank-gallery-loading" })
      ),
      h("div", { className: "dirty-rank-gallery-copy" },
        !NativePerformerCard && h(NavLink, { className: "dirty-rank-gallery-name text-truncate", title: performer.name, to: "/performers/" + performer.id }, performer.name),
        h("div", { className: "dirty-rank-gallery-rating-row dirty-rank-leaderboard-rating-row" },
          h("strong", { className: "dirty-rank-leaderboard-rank" }, "#" + props.rank),
          h("strong", { title: overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings) }, leaderboardRatingText(pool, props.settings))
        )
      )
    );
  }

  function LeaderboardGallery(props) {
    var entries = leaderboardStandingEntries(props);
    var ranked = props.ranked || entries.map(function (entry) { return entry.performer; });
    var topCount = leaderboardFeaturedCount(props);
    var pageSize = leaderboardPageSize(props.settings, topCount, props.showFeatured === false ? 0 : Math.min(topCount, ranked.length));
    var page = paginatedLeaderboard(entries, props.page, pageSize);
    return h("section", { className: "dirty-rank-standings-panel dirty-ui-feature-card" },
      !page.total
        ? h("div", { className: "dirty-rank-empty-standings" }, props.emptyMessage || (ranked.length ? "Every rated performer is featured above." : "No standings yet."))
        : h(Fragment, null,
            h("div", { className: "dirty-rank-gallery-grid", style: { "--dirty-rank-gallery-columns": topCount } }, page.items.map(function (entry) {
              return h(LeaderboardGalleryCard, {
                cohort: props.cohort,
                key: entry.performer.id,
                leaderboardId: props.leaderboardId,
                performer: entry.performer,
                rank: entry.rank,
                settings: props.settings,
              });
            })),
            h(LeaderboardPagination, {
              firstRank: page.firstRank,
              lastRank: page.lastRank,
              onPageChange: props.onPageChange,
              page: page.currentPage,
              totalPages: page.totalPages,
            })
          )
    );
  }

  function DirtyRankLeaderboardsRoute() {
    DirtyPlugins.react.usePageTitle("DirtyRank", "Leaderboard");
    var settingsState = useState(null);
    var settings = settingsState[0];
    var setSettings = settingsState[1];
    var performersState = useState([]);
    var performers = performersState[0];
    var setPerformers = performersState[1];
    var location = Router.useLocation();
    var history = Router.useHistory();
    var requestedBox = new URLSearchParams(location.search).get("box") || new URLSearchParams(location.search).get("cohort") || "";
    var cohort = settings && settings.enabledCohorts.indexOf(requestedBox) !== -1 ? requestedBox : settings ? settings.defaultCohort : "";
    var requestedLeaderboardId = leaderboardIdFromPath(location.pathname);
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var pageState = useState(1);
    var page = pageState[0];
    var setPage = pageState[1];
    var filterOpenState = useState(false);
    var filterOpen = filterOpenState[0];
    var setFilterOpen = filterOpenState[1];
    var filterModelState = useState(null);
    var filterModel = filterModelState[0];
    var setFilterModel = filterModelState[1];
    var filterIdsState = useState(null);
    var filterIds = filterIdsState[0];
    var setFilterIds = filterIdsState[1];
    var resolvedFilterKeyState = useState("");
    var resolvedFilterKey = resolvedFilterKeyState[0];
    var setResolvedFilterKey = resolvedFilterKeyState[1];
    var filterBusyState = useState(false);
    var filterBusy = filterBusyState[0];
    var setFilterBusy = filterBusyState[1];
    var filterErrorState = useState("");
    var filterError = filterErrorState[0];
    var setFilterError = filterErrorState[1];
    var nativeReadyState = useState(false);
    var nativeReady = nativeReadyState[0];
    var setNativeReady = nativeReadyState[1];
    var nativeErrorState = useState("");
    var nativeError = nativeErrorState[0];
    var setNativeError = nativeErrorState[1];
    var filterTrigger = useRef(null);
    var filterClose = useRef(null);

    useEffect(function () {
      var active = true;
      leaderboardFilterListener = function (model) { if (active) setFilterModel(model); };
      if (DirtyPlugins.native && DirtyPlugins.native.ensureComponents) {
        DirtyPlugins.native.ensureComponents("Performers", ["FilteredPerformerList"])
          .then(function () { if (active) setNativeReady(true); })
          .catch(function (caught) { if (active) setNativeError(caught.message || String(caught)); });
      } else {
        setNativeError("Stash performer filters are unavailable.");
      }
      return function () {
        active = false;
        leaderboardFilterListener = null;
      };
    }, []);

    var filterKey = filterModel ? JSON.stringify(filterModel) : "";
    var filterActive = Boolean(filterModel && filterModel.count > 0);
    useEffect(function () {
      if (!filterActive) {
        setFilterIds(null);
        setResolvedFilterKey("");
        setFilterBusy(false);
        setFilterError("");
        return undefined;
      }
      var controller = new AbortController();
      var active = true;
      setFilterBusy(true);
      setFilterError("");
      queryLeaderboardPerformerIds(filterModel, controller.signal)
        .then(function (ids) { if (active) { setFilterIds(ids); setResolvedFilterKey(filterKey); } })
        .catch(function (caught) { if (active && caught.name !== "AbortError") setFilterError(caught.message || String(caught)); })
        .finally(function () { if (active) setFilterBusy(false); });
      return function () { active = false; controller.abort(); };
    }, [filterKey]);

    var load = useCallback(function () {
      setLoading(true);
      setError("");
      return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), queryPerformers(true), loadRatingIndex(), loadNativePerformerCard()])
        .then(function (values) {
          var nextSettings = settingsFromConfiguration(values[0]);
          setSettings(nextSettings);
          setPerformers(values[1]);
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

    var availableCohorts = settings ? boxOptions(settings, true) : [];
    var enabledCategories = settings ? categoriesFor(settings, cohort).filter(function (category) { return category.enabled; }) : [];
    var leaderboardId = requestedLeaderboardId === OVERALL_LEADERBOARD_ID || enabledCategories.some(function (category) { return category.id === requestedLeaderboardId; })
      ? requestedLeaderboardId : OVERALL_LEADERBOARD_ID;
    var viewMode = settings ? settings.leaderboardView : "gallery";
    var topCount = settings ? settings.leaderboardTopCount : 3;
    var selectedCategory = enabledCategories.find(function (category) { return category.id === leaderboardId; }) || null;
    var data = useMemo(function () {
      return settings ? leaderboardData(performers, leaderboardId, cohort, settings) : null;
    }, [cohort, leaderboardId, performers, settings]);
    var allEntries = useMemo(function () {
      return data ? leaderboardEntries(data.ranked) : [];
    }, [data]);
    var standingEntries = useMemo(function () {
      if (filterActive) return filteredLeaderboardEntries(allEntries, filterIds);
      return allEntries.slice(leaderboardTopCount(topCount));
    }, [allEntries, filterActive, filterIds, topCount]);
    useEffect(function () { setPage(1); }, [cohort, leaderboardId, viewMode, filterKey, topCount, settings && settings.leaderboardPerformerCount]);
    var pageSize = settings ? leaderboardPageSize(settings, topCount, filterActive ? 0 : Math.min(topCount, data ? data.ranked.length : 0)) : 15;
    var totalPages = Math.max(1, Math.ceil(standingEntries.length / pageSize));
    useEffect(function () {
      if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    if (loading) return h("main", { className: "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide" }, h(StateView, { title: "Loading DirtyRank leaderboards…" }));
    if (error || !settings || !data) {
      return h("main", { className: "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide" }, h(StateView, {
        title: "Could not load DirtyRank leaderboards",
        detail: error || "DirtyRank settings are unavailable.",
        actions: h(RankButton, { onClick: load }, "Retry"),
      }));
    }

    var stats = data.stats;
    var leaderboardName = selectedCategory ? selectedCategory.name : "Overall";
    var censorMedia = documentationCapture();
    return h("main", { className: "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide dirty-rank-leaderboards-route" + (censorMedia ? " dirty-rank-censored-media" : "") },
      h("div", { className: "dirty-rank-leaderboards-shell" },
        h("header", { className: "dirty-rank-leaderboards-header dirty-ui-page-header dirty-ui-feature-card" },
          h("h1", { className: "dirty-rank-leaderboards-page-title" }, "Leaderboards"),
          h("div", { className: "dirty-rank-leaderboards-controls dirty-ui-control-row" },
            h(RankStatisticSelector, { value: leaderboardId, label: selectedCategory ? selectedCategory.name : "Overall", categories: enabledCategories, boxId: cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : cohort }),
            h("button", {
              ref: filterTrigger,
              className: "btn btn-secondary dirty-ui-button dirty-ui-control",
              type: "button",
              "aria-haspopup": "dialog",
              "aria-expanded": filterOpen,
              onClick: function () { setFilterOpen(true); },
            }, "Filter", filterActive ? " (" + filterModel.count + ")" : ""),
            h(LeaderboardInfoPopover, { id: "dirty-rank-coverage", label: "Coverage" },
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
              h(LeaderboardStat, { detail: selectedCategory ? "Lower means more precise" : "Weighted category RD; lower means more precise", label: selectedCategory ? "Median RD" : "Median category RD", value: stats.medianDeviation.toFixed(1) }),
              h(LeaderboardStat, { detail: "Share of completed battles", label: "Draw rate", value: stats.drawRate.toFixed(1) + "%" }),
              h(LeaderboardStat, { detail: "Highest to lowest rated", label: selectedCategory ? "Rating spread" : "Score spread", value: selectedCategory ? Math.round(stats.ratingSpread).toLocaleString() : stats.ratingSpread.toFixed(1) })
              )
            ),
            h(LeaderboardInfoPopover, { id: "dirty-rank-confidence", label: "Confidence", className: "dirty-rank-leaderboards-confidence" },
              selectedCategory
                ? h(ConfidenceIndicator, { category: selectedCategory, cohort: cohort, performers: performers, settings: settings })
                : h(OverallConfidence, { cohort: cohort, performers: performers, settings: settings })
            ),
            h(NavLink, { className: "btn btn-secondary dirty-ui-button dirty-ui-control dirty-rank-leaderboards-battles", to: selectedCategory ? battleCategoryPath(selectedCategory.id, false, "", cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : cohort) : ROUTE_PATH + (cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : "?box=" + encodeURIComponent(cohort)) }, "Battles"),
            h(NavLink, { className: "btn btn-secondary dirty-ui-button dirty-ui-control dirty-rank-leaderboards-options", to: "/plugins/dirty-plugins?plugin=dirtyRank" }, "Options")
          )
        ),
        SharedDialog && h(SharedDialog, {
          open: filterOpen,
          id: "dirty-rank-performer-filter-dialog",
          backdropClassName: "dirty-ui-native-filter-overlay",
          className: "dirty-ui-native-filter-dialog dirty-ui-panel",
          ariaLabel: "Performer filters",
          initialFocusRef: filterClose,
          openerRef: filterTrigger,
          allowNativePopup: true,
          onClose: function () { setFilterOpen(false); },
        },
          h("div", { className: "dirty-rank-filter-dialog-heading" },
            h("h2", null, "Performer filters"),
            h("button", { ref: filterClose, className: "btn btn-secondary dirty-ui-button", onClick: function () { setFilterOpen(false); }, type: "button" }, "Done")
          ),
          availableCohorts.length > 1 && h(Field, { className: "dirty-rank-control", id: "dirty-rank-leaderboard-cohort", label: "Gender box" },
            h("select", { className: "form-control", id: "dirty-rank-leaderboard-cohort", onChange: function (event) {
              var nextBox = event.target.value;
              var nextId = categoriesFor(settings, nextBox).some(function (category) { return category.enabled && category.id === leaderboardId; }) ? leaderboardId : OVERALL_LEADERBOARD_ID;
              var path = leaderboardStatPath(nextId, nextBox);
              history.push(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(path) : path);
            }, value: cohort },
              availableCohorts.map(function (item) { return h("option", { key: item[0], value: item[0] }, item[1]); }))
          ),
          nativeError ? h(StateView, { title: "Stash filters unavailable", detail: nativeError })
            : !nativeReady ? h(StateView, { title: "Loading Stash filters…" })
            : censorMedia ? h("p", { role: "note" }, "Native filter results are hidden while capturing documentation.")
            : h(PluginApi.components.FilteredPerformerList, { alterQuery: false, extraCriteria: { dirtyRankLeaderboardFilter: true } })
        ),
        filterError ? h(StateView, { title: "Could not filter performers", detail: filterError })
          : filterActive && (filterBusy || resolvedFilterKey !== filterKey)
            ? h(StateView, { title: "Filtering performers…" })
            : h(Fragment, null,
                !filterActive && h(LeaderboardPodium, { cohort: cohort, leaderboardId: leaderboardId, ranked: data.ranked, settings: settings, topCount: topCount }),
                viewMode === "gallery"
                  ? h(LeaderboardGallery, Object.assign({
                      cohort: cohort,
                      entries: standingEntries,
                      leaderboardId: leaderboardId,
                      onPageChange: setPage,
                      page: page,
                      ranked: data.ranked,
                      topCount: topCount,
                      showFeatured: !filterActive,
                      settings: settings,
                    }, filterActive ? filteredLeaderboardPanelProps(standingEntries) : {}))
                  : h(LeaderboardTable, Object.assign({
                      cohort: cohort,
                      entries: standingEntries,
                      leaderboardId: leaderboardId,
                      onPageChange: setPage,
                      page: page,
                      ranked: data.ranked,
                      topCount: topCount,
                      showFeatured: !filterActive,
                      settings: settings,
                    }, filterActive ? filteredLeaderboardPanelProps(standingEntries) : {}))
              )
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

  function hillFireworks() {
    var colors = ["#ffe6a3", "#65e8ff", "#d4a2ff", "#ff8ea8", "#a8ffc5"];
    var bursts = [];
    var confetti = [];
    for (var burst = 0; burst < 18; burst += 1) {
      var sparks = [];
      var finale = burst >= 12;
      for (var spark = 0; spark < 32; spark += 1) {
        var angle = spark * Math.PI * 2 / 32;
        var radius = (finale ? 12 : 8) * (spark % 2 ? 0.65 : 1);
        sparks.push(h("span", {
          className: "dirty-rank-firework-spark",
          key: spark,
          style: {
            "--spark-x": (Math.cos(angle) * radius).toFixed(3) + "rem",
            "--spark-y": (Math.sin(angle) * radius).toFixed(3) + "rem",
            "--spark-angle": (spark * 360 / 32) + "deg",
          },
        }));
      }
      bursts.push(h("span", {
        className: "dirty-rank-firework",
        key: "burst-" + burst,
        style: {
          left: (8 + (burst * 29 % 85)) + "%",
          top: (12 + (burst * 17 % 48)) + "%",
          "--firework-color": colors[burst % colors.length],
          "--firework-delay": (finale ? 5.4 + (burst - 12) * 0.12 : burst * 0.4).toFixed(2) + "s",
        },
      }, sparks));
    }
    for (var piece = 0; piece < 64; piece += 1) {
      confetti.push(h("span", {
        className: "dirty-rank-victory-confetti",
        key: "confetti-" + piece,
        style: {
          left: (piece * 37 % 100) + "%",
          "--confetti-color": colors[piece % colors.length],
          "--confetti-drift": ((piece * 19 % 24) - 12) + "rem",
          "--confetti-delay": (1.2 + (piece % 16) * 0.25) + "s",
          "--confetti-turn": (piece % 2 ? 720 : -720) + "deg",
        },
      }));
    }
    return h("div", { className: "dirty-rank-fireworks", "aria-hidden": "true" }, bursts, confetti);
  }

  function battleCategoryPath(categoryId, kingsMode, performerId, cohort) {
    var base = performerId ? ROUTE_PATH + "/gauntlet/" + encodeURIComponent(performerId) : ROUTE_PATH + "/category";
    return base + "/" + encodeURIComponent(categoryId) + (kingsMode && !performerId ? "/king-of-the-hill" : "") +
      (cohort ? "?box=" + encodeURIComponent(cohort) : "");
  }

  function battleRouteFromPath(pathname) {
    if (pathname === ROUTE_PATH || pathname === ROUTE_PATH + "/") return { categoryId: "", kingsMode: false, performerId: "" };
    var match = pathname.match(/^\/plugins\/dirty-rank\/category\/([^/]+)(?:\/(king-of-the-hill))?\/?$/);
    var gauntlet = pathname.match(/^\/plugins\/dirty-rank\/gauntlet\/([^/]+)(?:\/([^/]+))?\/?$/);
    try {
      if (match) return { categoryId: decodeURIComponent(match[1]), kingsMode: Boolean(match[2]), performerId: "" };
      if (gauntlet) return { categoryId: gauntlet[2] ? decodeURIComponent(gauntlet[2]) : "", kingsMode: false, performerId: decodeURIComponent(gauntlet[1]) };
    } catch (_error) {}
    return null;
  }

  function DirtyRankRoute(props) {
    var routeTargetId = props && props.match && props.match.params && props.match.params.performerId
      ? String(props.match.params.performerId)
      : "";
    var routeDetails = battleRouteFromPath(window.location.pathname);
    var gauntletPathActive = Boolean(routeDetails && routeDetails.performerId);
    if (gauntletPathActive && !routeTargetId) return null;
    if (!routeDetails || (routeDetails.categoryId && !(props && props.match && props.match.params && props.match.params.categoryId))) return null;
    // Stash can keep the prefix route mounted alongside a more specific route.
    // Unmount the page (and its effects) when this route no longer owns it.
    return h(DirtyRankBattlePage, { routeDetails: routeDetails, routeTargetId: routeTargetId });
  }

  function DirtyRankBattlePage(props) {
    var routeDetails = props.routeDetails;
    var routeTargetId = props.routeTargetId;
    var requestedCategoryId = routeDetails.categoryId;
    var history = Router.useHistory();
    var location = Router.useLocation();
    var requestedCohort = new URLSearchParams(location.search).get("box") || new URLSearchParams(location.search).get("cohort") || "";
    var gauntletTargetId = routeTargetId;
    var gauntletMode = Boolean(gauntletTargetId);
    var censorMedia = documentationCapture();
    var kingsMode = !gauntletMode && routeDetails.kingsMode;
    DirtyPlugins.react.usePageTitle("DirtyRank", gauntletMode ? "Gauntlet" : kingsMode ? "King of the Hill" : "Battles");
    var settingsState = useState(null);
    var settings = settingsState[0];
    var setSettings = settingsState[1];
    var performersState = useState([]);
    var performers = performersState[0];
    var setPerformers = performersState[1];
    var cohort = settings ? battleCohortFor(settings, gauntletMode ? performers.find(function (performer) {
      return String(performer.id) === gauntletTargetId;
    }) : null, requestedCohort) : "";
    var requestedContextRef = useRef({});
    requestedContextRef.current = { cohort: requestedCohort, categoryId: requestedCategoryId };
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
    var defeatedKingsRef = useRef([]);
    var operationStatusRef = useRef(new Map());
    var preparedPairRef = useRef(null);
    var preparedImagesRef = useRef([]);

    var load = useCallback(function () {
      setLoading(true);
      setError("");
      return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), queryPerformers(true), loadRatingIndex(), loadNativePerformerCard()])
        .then(function (values) {
          var nextSettings = settingsFromConfiguration(values[0]);
          var gauntletTarget = gauntletMode
            ? values[1].find(function (performer) { return String(performer.id) === gauntletTargetId; })
            : null;
          if (gauntletMode && !gauntletTarget) throw new Error("The selected Gauntlet performer could not be found.");
          var requestedContext = requestedContextRef.current;
          var nextCohort = battleCohortFor(nextSettings, gauntletTarget, requestedContext.cohort);
          if (!nextCohort) {
            throw new Error("Enable a category that includes " + cohortLabel(gauntletTarget ? gauntletTarget.gender : nextSettings.defaultCohort) + " performers in DirtyRank settings.");
          }
          var enabled = categoriesForPerformer(nextSettings, nextCohort, gauntletTarget);
          if (!enabled.length) throw new Error("Enable at least one DirtyRank category for the selected performer cohort.");
          setSettings(nextSettings);
          setPerformers(values[1]);
          setCategoryId(function (current) {
            if (enabled.some(function (item) { return item.id === requestedContext.categoryId; })) return requestedContext.categoryId;
            return preferredCategoryId(nextSettings, nextCohort, current);
          });
          setPairInfo(null);
          setDecision(null);
          undoHistoryRef.current = [];
          defeatedKingsRef.current = [];
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
      var target = gauntletMode ? performers.find(function (performer) { return String(performer.id) === gauntletTargetId; }) : null;
      var cohortCategories = categoriesForPerformer(settings, cohort, target);
      return cohortCategories.find(function (item) { return item.id === (requestedCategoryId || categoryId); }) ||
        cohortCategories[0] || null;
    }, [categoryId, cohort, settings, requestedCategoryId, gauntletMode, gauntletTargetId, performers]);

    useEffect(function () {
      setPairInfo(null);
      preparedPairRef.current = null;
      preparedImagesRef.current = [];
      recentPairs.current = [];
      undoHistoryRef.current = [];
      defeatedKingsRef.current = [];
      setUndoHistory([]);
      setFeedback(null);
      setDecision(null);
    }, [requestedCategoryId, requestedCohort, kingsMode]);

    useEffect(function () {
      if (loading || !settings || !category) return;
      var targetPath = categoryPath(category.id, kingsMode, cohort);
      rememberCategory(cohort, category.id);
      if (location.pathname !== targetPath.split("?")[0] || requestedCohort !== (targetPath.indexOf("?") !== -1 ? cohort : "")) {
        history.replace(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(targetPath) : targetPath);
      }
    }, [category, cohort, gauntletTargetId, history, kingsMode, loading, location.pathname, requestedCohort, settings]);

    var gauntletTarget = useMemo(function () {
      if (!gauntletMode) return null;
      return performers.find(function (performer) { return String(performer.id) === gauntletTargetId; }) || null;
    }, [gauntletMode, gauntletTargetId, performers]);

    function categoryPath(nextCategoryId, nextKingsMode, nextCohort) {
      var defaultCohort = battleCohortFor(settings, gauntletTarget, "");
      return battleCategoryPath(nextCategoryId, nextKingsMode, gauntletTargetId, nextCohort === defaultCohort && nextCohort.indexOf("BOX-") !== 0 ? "" : nextCohort);
    }

    var refinementConfidence = useMemo(function () {
      return !gauntletMode && settings && category ? categoryConfidence(
        performers, category, cohort, Object.assign({}, settings, { confidenceGoal: "all" })
      ) : null;
    }, [category, cohort, gauntletMode, performers, settings, ratingIndexRevision]);

    var selectModePair = useCallback(function (sourcePerformers, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs) {
      if (kingsMode) return selectKingsStartingPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings);
      var target = gauntletMode
        ? sourcePerformers.find(function (performer) { return String(performer.id) === gauntletTargetId; })
        : null;
      return target
        ? selectGauntletPair(sourcePerformers, target, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs)
        : selectPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs);
    }, [gauntletMode, gauntletTargetId, kingsMode]);

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

    function showPreparedOrPickNext(outcome) {
      if (kingsMode) {
        if (outcome === "left" || outcome === "right") {
          var winner = pairInfo.pair[outcome === "left" ? 0 : 1];
          var selected = selectKingsPair(performers, winner, outcome, defeatedKingsRef.current.map(function (entry) {
            return entry.performerId;
          }), category, cohort, settings);
          selected.instanceId = battleId();
          setPairInfo(selected);
          setFeedback(null);
        } else {
          pickNext(performers, settings, category, cohort);
        }
        return;
      }
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
      if (loading || error || kingsMode || !settings || !category || !pairInfo || !pairInfo.pair || performers.length < 2) return undefined;

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
    }, [category, cohort, error, kingsMode, loading, pairInfo, performers, selectModePair, settings]);

    function replaceStates(result, source) {
      return source.map(function (performer) {
        if (result.left && performer.id === result.left.id) return updatePerformerState(performer, result.left.state);
        if (result.right && performer.id === result.right.id) return updatePerformerState(performer, result.right.state);
        return performer;
      });
    }

    function submit(outcome) {
      if (busyRef.current || !pairInfo || !pairInfo.pair || !category) return;
      if (kingsMode && outcome === "draw") return;
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
      if (kingsMode) {
        defeatedKingsRef.current.push({ battleId: id, performerId: String(outcome === "left" ? right.id : left.id) });
      }
      showPreparedOrPickNext(outcome);
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
      if (kingsMode) return;
      if (busyRef.current || !pairInfo || !pairInfo.pair || !category) return;
      recentPairs.current.push(pairToken(pairInfo.pair[0], pairInfo.pair[1]));
      recentPairs.current = recentPairs.current.slice(-Math.max(50, settings.avoidRepeatWindow));
      setDecision(null);
      showPreparedOrPickNext("skip");
    }

    function undo() {
      var lastBattle = undoHistoryRef.current[undoHistoryRef.current.length - 1];
      if (busyRef.current || !lastBattle) return;
      var operationStatus = operationStatusRef.current.get(lastBattle.id) || { recordFailed: false, undone: false };
      operationStatus.undone = true;
      operationStatusRef.current.set(lastBattle.id, operationStatus);
      undoHistoryRef.current = undoHistoryRef.current.slice(0, -1);
      defeatedKingsRef.current = defeatedKingsRef.current.filter(function (entry) { return entry.battleId !== lastBattle.id; });
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

    function restartKings() {
      if (pendingVotesRef.current > 0 || busyRef.current) return;
      defeatedKingsRef.current = [];
      undoHistoryRef.current = [];
      recentPairs.current = [];
      setUndoHistory([]);
      setPairInfo(null);
      setDecision(null);
      setFeedback(null);
    }

    useEffect(function () {
      function onKeyDown(event) {
        if (event.defaultPrevented || busy || !pairInfo || !pairInfo.pair) return;
        var tagName = document.activeElement && document.activeElement.tagName;
        if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
        if (event.key === "ArrowLeft") { event.preventDefault(); submit("left"); }
        if (event.key === "ArrowRight") { event.preventDefault(); submit("right"); }
        if (!kingsMode && event.key === "ArrowUp") { event.preventDefault(); submit("draw"); }
        if (event.key === "ArrowDown") { event.preventDefault(); undo(); }
        if (!kingsMode && event.key.toLowerCase() === "t") { event.preventDefault(); submit("draw"); }
        if (!kingsMode && event.key.toLowerCase() === "s") { event.preventDefault(); skip(); }
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

    if (loading) return h("main", { className: "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide" }, h(StateView, { title: gauntletMode ? "Loading Gauntlet…" : "Loading DirtyRank…" }));
    if (error && (!settings || !performers.length)) {
      return h("main", { className: "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide" }, h(StateView, {
        title: "Could not load DirtyRank",
        detail: error,
        actions: h(RankButton, { onClick: load }, "Retry"),
      }));
    }
    if (!settings || !category) return null;

    var pair = pairInfo && pairInfo.pair;
    var hillWinner = kingsMode && pairInfo && pairInfo.incumbentId && !pair
      ? performers.find(function (performer) { return String(performer.id) === pairInfo.incumbentId; })
      : null;
    var arenaLeft = pair ? pair[0] : hillWinner && pairInfo.incumbentSide === "left" ? hillWinner : null;
    var arenaRight = pair ? pair[1] : hillWinner && pairInfo.incumbentSide === "right" ? hillWinner : null;
    var reveal = settings.showRatingsBeforeVote;
    var hillDefeated = kingsMode ? defeatedKingsRef.current.length : 0;
    var hillTotal = kingsMode && pairInfo ? Math.max(0, pairInfo.eligible - 1) : 0;
    var hideStandings = kingsMode || settings.hideBattleStandings;
    var availableCohorts = boxOptions(settings, true).filter(function (item) {
      return settings.enabledCohorts.indexOf(item[0]) !== -1 && categoriesForPerformer(settings, item[0], gauntletTarget).length > 0;
    });
    return h(Fragment, null,
      Prompt && h(Prompt, {
        message: "DirtyRank is still saving queued votes or undos. Wait for the queue to finish before leaving this page.",
        when: pendingVotes > 0,
      }),
      h("main", { className: "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide" + (gauntletMode ? " dirty-rank-gauntlet-route" : "") + (kingsMode ? " dirty-rank-kings-route" : "") + (hideStandings ? " dirty-rank-standings-hidden" : "") + (censorMedia ? " dirty-rank-censored-media" : "") },
      h("div", { className: "dirty-rank-shell" },
        h("section", { className: "dirty-rank-main dirty-ui-feature-card" },
          h("header", { className: "dirty-rank-header dirty-ui-page-header" },
            h("div", { className: "dirty-rank-header-identity" },
              h("h1", { className: "dirty-rank-title dirty-rank-leaderboards-page-title" }, "DirtyRank"),
              kingsMode && h("div", { className: "dirty-rank-hill-crest" }, h(RankCrown, null), h("span", null, "King of the hill")),
              h("fieldset", { className: "dirty-rank-category-picker", disabled: busy || pendingVotes > 0 },
                h(SharedStatisticSelector, {
                  id: "dirty-rank-category",
                  ariaLabel: "Category",
                  value: category.id,
                  options: categoriesForPerformer(settings, cohort, gauntletTarget).map(function (item) {
                    return { value: item.id, label: item.name };
                  }),
                  onSelect: function (nextCategoryId) {
                    if (busy || pendingVotes > 0) return;
                    var nextPath = categoryPath(nextCategoryId, kingsMode, cohort);
                    history.push(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(nextPath) : nextPath);
                    setCategoryId(nextCategoryId);
                    rememberCategory(cohort, nextCategoryId);
                    setPairInfo(null);
                    preparedPairRef.current = null;
                    undoHistoryRef.current = [];
                    defeatedKingsRef.current = [];
                    setUndoHistory([]);
                    setFeedback(null);
                    setDecision(null);
                  },
                })
              )
            ),
            h("div", { className: "dirty-rank-header-controls dirty-ui-control-row d-flex flex-wrap align-items-end justify-content-end" },
              !gauntletMode && h(RankButton, {
                  className: "dirty-ui-control dirty-rank-options-link",
                  disabled: busy || pendingVotes > 0,
                  id: "dirty-rank-battle-mode",
                  onClick: function () {
                    if (busy || pendingVotes > 0) return;
                    var nextPath = categoryPath(category.id, !kingsMode, cohort);
                    history.push(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(nextPath) : nextPath);
                    setPairInfo(null);
                    preparedPairRef.current = null;
                    undoHistoryRef.current = [];
                    defeatedKingsRef.current = [];
                    setUndoHistory([]);
                    setFeedback(null);
                    setDecision(null);
                  },
                }, kingsMode ? "Standard battles" : "King of the hill"),
              availableCohorts.length > 1 && h("div", { className: "dirty-rank-control dirty-ui-field" },
                h("label", { htmlFor: "dirty-rank-battle-cohort" }, "Gender box"),
                h("select", {
                  className: "form-control",
                  disabled: busy || pendingVotes > 0,
                  id: "dirty-rank-battle-cohort",
                  onChange: function (event) {
                    var nextCohort = event.target.value;
                    var nextCategories = categoriesForPerformer(settings, nextCohort, gauntletTarget);
                    var preferredId = preferredCategoryId(settings, nextCohort, category.id);
                    var nextCategoryId = nextCategories.some(function (item) { return item.id === preferredId; }) ? preferredId : nextCategories[0].id;
                    setCategoryId(nextCategoryId);
                    rememberCategory(nextCohort, nextCategoryId);
                    var nextPath = categoryPath(nextCategoryId, kingsMode, nextCohort);
                    history.push(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(nextPath) : nextPath);
                    setPairInfo(null);
                    undoHistoryRef.current = [];
                    defeatedKingsRef.current = [];
                    setUndoHistory([]);
                    setFeedback(null);
                    setDecision(null);
                  },
                  value: cohort,
                }, availableCohorts.map(function (item) {
                  return h("option", { key: item[0], value: item[0] }, item[1]);
                }))
              ),
              gauntletMode && gauntletTarget && h(NavLink, {
                className: "btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link",
                to: "/performers/" + gauntletTarget.id,
              }, "Back to performer"),
              h(NavLink, { className: "btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link", to: LEADERBOARDS_ROUTE_PATH + (cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : "?box=" + encodeURIComponent(cohort)) }, "Leaderboards"),
              h(NavLink, { className: "btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link", to: "/plugins/dirty-plugins?plugin=dirtyRank" }, "Options")
            )
          ),
          (pendingVotes > 0 || feedback) && h("div", { className: "dirty-rank-statusbar d-flex flex-wrap align-items-center justify-content-between" },
            h("div", { className: "dirty-rank-session d-flex flex-wrap" },
              pendingVotes > 0 && h("span", { className: "dirty-rank-saving" }, pendingVotes + " queued operation" + (pendingVotes === 1 ? "" : "s"))
            ),
            feedback && h("div", { className: "dirty-rank-feedback", role: "status" }, feedback.text)
          ),
          h(DecisionIndicator, { decision: decision }),
          refinementConfidence && refinementConfidence.refined < refinementConfidence.eligible && h("div", {
            className: "dirty-rank-refinement-estimate",
            title: "Cohort-wide estimate for every eligible performer in this category, assuming informative matchups. Actual battles depend on opponents, future results, and the selected matchmaking goal.",
          }, (refinementConfidence.eligible - refinementConfidence.refined).toLocaleString() + " of " +
            refinementConfidence.eligible.toLocaleString() + " " + boxGendersLabel(settings, cohort).toLowerCase() +
            " performers need refinement · ≈" + refinementConfidence.remainingBattles.toLocaleString() +
            " more battles for the whole category"),
          kingsMode && (pair || hillWinner) && h("div", { className: "dirty-rank-hill-progress", role: "status" },
            h("span", { className: "dirty-rank-hill-progress-label" }, hillWinner ? "The crown is claimed" : pairInfo.incumbentId ? "Defend the crown" : "Claim the crown"),
            h("span", { className: "dirty-rank-hill-progress-track", "aria-hidden": "true" }, h("span", { style: { width: (hillTotal ? Math.min(100, hillDefeated / hillTotal * 100) : 0) + "%" } })),
            h("span", { className: "dirty-rank-hill-progress-count" }, hillDefeated.toLocaleString() + " / " + hillTotal.toLocaleString() + " defeated")
          ),
          gauntletMode && gauntletTarget && h(GauntletConfidenceIndicator, {
            category: category, cohort: cohort, performer: gauntletTarget, performers: performers, settings: settings,
          }),
          error && h("div", { className: "dirty-ui-text-error", role: "alert", style: { padding: "0.75rem 1.25rem 0" } }, error),
          !pair && !hillWinner && h(StateView, {
            title: "Not enough eligible performers",
            detail: "This category and cohort need at least two performers" + (settings.includePerformersWithoutImages ? "." : " with profile images."),
            actions: h(NavLink, { className: "btn btn-secondary dirty-ui-button", to: "/plugins/dirty-plugins?plugin=dirtyRank" }, "Open settings"),
          }),
          (pair || hillWinner) && h(Fragment, null,
            h("div", { className: "dirty-rank-arena" + (hillWinner ? " dirty-rank-coronation dirty-rank-coronation-" + pairInfo.incumbentSide : "") },
              arenaLeft && h(PerformerCard, {
                crowned: Boolean(hillWinner),
                disabled: busy,
                // Keep the same mounted card and player when this performer wins.
                key: gauntletMode ? "gauntlet:" + arenaLeft.id : kingsMode ? "kings:" + cohort + ":" + category.id + ":" + arenaLeft.id : pairInfo.instanceId + ":left",
                gauntletTarget: gauntletMode,
                hillMode: kingsMode,
                hillOpening: kingsMode && !pairInfo.incumbentId,
                kingTarget: kingsMode && pairInfo.incumbentId === String(arenaLeft.id),
                onChoose: function () { submit("left"); },
                performer: arenaLeft,
                pool: poolFor(arenaLeft, category.id, cohort, settings),
                rank: pairInfo.ranks[arenaLeft.id],
                reveal: reveal,
                settings: settings,
              }),
              pair && h("div", { className: "dirty-rank-versus", "aria-hidden": "true" }),
              arenaRight && h(PerformerCard, {
                crowned: Boolean(hillWinner),
                disabled: busy,
                key: kingsMode ? "kings:" + cohort + ":" + category.id + ":" + arenaRight.id : pairInfo.instanceId + ":right",
                hillMode: kingsMode,
                hillOpening: kingsMode && !pairInfo.incumbentId,
                kingTarget: kingsMode && pairInfo.incumbentId === String(arenaRight.id),
                onChoose: function () { submit("right"); },
                performer: arenaRight,
                pool: poolFor(arenaRight, category.id, cohort, settings),
                rank: pairInfo.ranks[arenaRight.id],
                reveal: reveal,
                settings: settings,
              }),
              hillWinner && hillFireworks()
            ),
            pair && h("div", { className: "dirty-rank-actions d-flex flex-wrap align-items-center justify-content-center" },
              !kingsMode && h(RankButton, { disabled: busy, onClick: function () { submit("draw"); } }, "Tie"),
              !kingsMode && h(RankButton, { disabled: busy, onClick: skip }, "Skip"),
              h(RankButton, { disabled: busy || !undoHistory.length, onClick: undo }, "Undo" + (undoHistory.length ? " (" + undoHistory.length + ")" : "")),
              h("div", { className: "dirty-rank-hint" }, kingsMode
                ? "← choose left · → choose right · ↓ undo"
                : "← choose left · → choose right · ↑ tie · ↓ undo · S skip")
            ),
            hillWinner && h(StateView, {
              title: "Hill cleared",
              detail: hillWinner.name + " has defeated every eligible challenger in this run.",
              actions: h(Fragment, null,
                h(RankButton, { disabled: busy || !undoHistory.length, onClick: undo }, "Undo" + (undoHistory.length ? " (" + undoHistory.length + ")" : "")),
                h(RankButton, { disabled: busy || pendingVotes > 0, onClick: restartKings }, "Start a new run")
              ),
            })
          )
        ),
        !hideStandings && h(Leaderboard, { category: category, cohort: cohort, performers: performers, settings: settings })
      )
    ));
  }

  function Field(props) {
    if (SharedField) return h(SharedField, props, props.children);
    return h("div", { className: "dirty-rank-field" + (props.className ? " " + props.className : "") },
      h("label", { htmlFor: props.id }, props.label),
      props.children,
      props.help && h("p", { className: "dirty-rank-field-help" }, props.help),
      props.error && h("p", { className: "dirty-ui-text-error", role: "alert" }, props.error)
    );
  }

  function DirtyRankSettings(props) {
    if (!SettingsCard || !Section || !Toggle) return null;
    var currentParametersState = useState(function () { return ratingParameters(settingsFromConfiguration(props.configuration)); });
    var currentParameters = currentParametersState[0];
    var setCurrentParameters = currentParametersState[1];
    var estimatePerformersState = useState(null);
    var estimatePerformers = estimatePerformersState[0];
    var setEstimatePerformers = estimatePerformersState[1];
    var estimateErrorState = useState(false);
    var estimateError = estimateErrorState[0];
    var setEstimateError = estimateErrorState[1];
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
    var savingState = useState(false);
    var saving = savingState[0];
    var setSaving = savingState[1];
    var statusState = useState("");
    var status = statusState[0];
    var setStatus = statusState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var autoSaveTimerRef = useRef(null);
    var saveQueueRef = useRef(Promise.resolve());
    var saveRevisionRef = useRef(0);
    var editRevisionRef = useRef(0);
    var settingsRevisionRef = useRef(null);
    var dirty = useMemo(function () {
      return comparableSettings(draft) !== comparableSettings(saved);
    }, [draft, saved]);
    var presetEstimate = useMemo(function () {
      if (!estimatePerformers) return null;
      var category = { enabled: true };
      var count = estimatePerformers.filter(function (performer) {
        return categoryEligible(performer, category, draft, editingCohort);
      }).length;
      return freshCategoryBattleEstimate(count, draft);
    }, [draft, editingCohort, estimatePerformers]);

    useEffect(function () {
      var cancelled = false;
      queryPerformers().then(function (values) {
        if (!cancelled) setEstimatePerformers(values);
      }).catch(function () { if (!cancelled) setEstimateError(true); });
      return function () { cancelled = true; };
    }, []);

    useEffect(function () {
      var cancelled = false;
      runOperation({ mode: "getSettings" }).then(function (result) {
        if (cancelled) return;
        settingsRevisionRef.current = result.revision;
        var normalized = settingsFromConfiguration(result.settings);
        setCurrentParameters(ratingParameters(normalized));
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
      var revision = saveRevisionRef.current + 1;
      saveRevisionRef.current = revision;
      var validationError = validateSettings(draft);
      if (validationError) {
        setSaving(false);
        setError(validationError);
        setStatus("");
        return undefined;
      }

      var settingsToSave = draft;
      var editRevision = editRevisionRef.current;
      setError("");
      setStatus("Waiting to save automatically…");
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(function () {
        setSaving(true);
        setStatus("Saving automatically…");
        var currentSave = saveQueueRef.current.catch(function () {}).then(function () {
          var ready = settingsRevisionRef.current === null
            ? runOperation({ mode: "getSettings" }).then(function (result) { settingsRevisionRef.current = result.revision; })
            : Promise.resolve();
          return ready.then(function () {
            return runOperation({
              mode: "saveSettings",
              settings: serializedSettings(settingsToSave),
              expectedRevision: settingsRevisionRef.current,
            });
          }).then(function (result) {
            settingsRevisionRef.current = result.revision;
            return settingsFromConfiguration(result.settings);
          });
        });
        saveQueueRef.current = currentSave;
        currentSave.then(function (normalized) {
          // Remember every completed write, even if Current restored the draft
          // to its previous saved value while this request was in flight.
          // That makes the restored values dirty again and queues their save.
          setSaved(normalized);
          if (saveRevisionRef.current !== revision || editRevisionRef.current !== editRevision) return;
          setDraft(normalized);
          setStatus("Saved automatically.");
          DirtyPlugins.notifyConfigurationChanged(PLUGIN_ID, { preserveSettingsPage: true });
        }).catch(function (caught) {
          if (saveRevisionRef.current !== revision || editRevisionRef.current !== editRevision) return;
          setError(caught.message || String(caught));
          setStatus("");
        }).finally(function () {
          if (saveRevisionRef.current === revision) setSaving(false);
        });
      }, 350);
      return function () { window.clearTimeout(autoSaveTimerRef.current); };
    }, [dirty, draft]);

    function changed(update) {
      editRevisionRef.current += 1;
      setDraft(function (current) { return Object.assign({}, current, update); });
      setStatus("");
      setError("");
    }

    function toggleCohort(cohort, enabled) {
      if (!enabled && draft.enabledCohorts.length === 1 && draft.enabledCohorts[0] === cohort) return;
      updateBox(cohort, { enabled: enabled });
    }

    function changeBoxes(transform) {
      setDraft(function (current) {
        var boxes = transform(current.genderBoxes);
        var enabledCohorts = boxes.filter(function (box) { return box.enabled; }).map(function (box) { return box.id; });
        var defaultCohort = enabledCohorts.indexOf(current.defaultCohort) !== -1
          ? current.defaultCohort
          : enabledCohorts[0];
        return Object.assign({}, current, { genderBoxes: boxes, defaultCohort: defaultCohort, enabledCohorts: enabledCohorts });
      });
      setStatus("");
      setError("");
    }

    function updateBox(id, update) {
      changeBoxes(function (boxes) { return boxes.map(function (box) {
        return box.id === id ? Object.assign({}, box, update) : box;
      }); });
    }

    function addBox() {
      var used = new Set(Object.keys(draft.categoriesByCohort).concat(draft.genderBoxes.map(function (box) { return box.id; })));
      var index = 1;
      while (used.has("BOX-" + index)) index += 1;
      var id = "BOX-" + index;
      var names = new Set(draft.genderBoxes.map(function (box) { return box.name.toLowerCase(); }));
      var name = "Box " + index;
      while (names.has(name.toLowerCase())) { index += 1; name = "Box " + index; }
      setDraft(function (current) {
        var categories = Object.assign({}, current.categoriesByCohort);
        categories[id] = DEFAULT_CATEGORY_DEFINITIONS.map(function (category) { return Object.assign({}, category); });
        return Object.assign({}, current, { categoriesByCohort: categories,
          genderBoxes: current.genderBoxes.concat([{ id: id, name: name, genders: ["FEMALE"], enabled: true }]),
          enabledCohorts: current.enabledCohorts.concat([id]) });
      });
      setEditingCohort(id);
      setStatus("");
      setError("");
    }

    function removeBox(id) {
      var box = boxFor(draft, id);
      if (draft.genderBoxes.length <= 1 || (box.enabled && draft.enabledCohorts.length === 1)) return;
      if (editingCohort === id) setEditingCohort(draft.genderBoxes.find(function (other) { return other.id !== id; }).id);
      // Keep category definitions as well as rating rows, and never reuse their IDs.
      changeBoxes(function (boxes) { return boxes.filter(function (other) { return other.id !== id; }); });
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
        var ids = new Set(["overall"].concat(categories.map(function (category) { return category.id; })));
        return categories.concat([{
          id: uniqueCategoryId("New category", ids),
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
      if (!settings.enabledCohorts.length) return "Enable at least one gender box.";
      var boxNames = new Set();
      for (var boxIndex = 0; boxIndex < settings.genderBoxes.length; boxIndex += 1) {
        var box = settings.genderBoxes[boxIndex];
        var boxName = String(box.name || "").trim().toLowerCase();
        if (!boxName) return "Every gender box needs a name.";
        if (boxNames.has(boxName)) return "Gender box names must be unique.";
        if (!box.genders.length) return "Choose at least one gender for each box.";
        boxNames.add(boxName);
      }
      for (var parameterIndex = 0; parameterIndex < OVERALL_SCORE_PARAMETERS.length; parameterIndex += 1) {
        var definition = OVERALL_SCORE_PARAMETERS[parameterIndex];
        if (overallScoreParameterError(settings[definition.key], definition)) {
          return definition.label + ": " + overallScoreParameterError(settings[definition.key], definition);
        }
      }
      var performerCountError = leaderboardPerformerCountError(settings);
      if (performerCountError) return performerCountError;
      if (settings.confidenceGoal === "top" &&
          (!String(settings.confidenceTopN).trim() || !Number.isInteger(Number(settings.confidenceTopN)) ||
            Number(settings.confidenceTopN) < 1 || Number(settings.confidenceTopN) > 1000)) {
        return "Top performers to stabilize must be between 1 and 1000.";
      }
      for (var cohortIndex = 0; cohortIndex < settings.genderBoxes.length; cohortIndex += 1) {
        var cohort = settings.genderBoxes[cohortIndex].id;
        var names = new Set();
        var cohortCategories = categoriesFor(settings, cohort);
        if (settings.enabledCohorts.indexOf(cohort) !== -1 && !cohortCategories.some(function (category) { return category.enabled; })) {
          return boxFor(settings, cohort).name + " needs at least one enabled category.";
        }
        for (var index = 0; index < cohortCategories.length; index += 1) {
          var name = String(cohortCategories[index].name || "").trim();
          if (!name) return "Every category needs a name.";
          if (names.has(name.toLowerCase())) return "Category names must be unique within each performer cohort.";
          if (!String(cohortCategories[index].weight).trim() ||
              !Number.isFinite(Number(cohortCategories[index].weight)) ||
              Number(cohortCategories[index].weight) < 0.01 || Number(cohortCategories[index].weight) > 1000) {
            return "Every category needs a weight between 0.01 and 1000.";
          }
          names.add(name.toLowerCase());
        }
      }
      return "";
    }

    function resetCategoryPool(cohort, category) {
      if (busy) return;
      if (dirty || saving) { setError("Wait for the automatic save before resetting a category."); return; }
      var target = boxFor(draft, cohort).name + " / " + category.name;
      if (!window.confirm("Reset all ratings and battle history for " + target + "? Other categories and gender boxes are kept. Use the General settings backup if you need to restore them later.")) return;
      setBusy(true);
      setError("");
      setStatus("Resetting " + target + "…");
      runOperation({
        mode: "resetPool",
        categoryId: category.id,
        cohort: cohort,
        confirm: "RESET",
      }).then(function (result) {
        return loadRatingIndex().then(function () {
          setStatus("Reset " + target + ": " + result.reset + " rating(s); " + result.failed + " failed.");
          DirtyPlugins.ui.notify("DirtyRank reset " + target + ": " + result.reset + " rating(s).");
        });
      }).catch(function (caught) { setError(caught.message || String(caught)); setStatus(""); })
        .finally(function () { setBusy(false); });
    }

    var editingCategories = categoriesFor(draft, editingCohort);

    function categoryNameError(category, index) {
      var name = String(category.name || "").trim().toLowerCase();
      if (!name) return "Enter a category name.";
      if (editingCategories.some(function (other, otherIndex) {
        return otherIndex !== index && String(other.name || "").trim().toLowerCase() === name;
      })) return "Use a unique name for this performer sex.";
      return "";
    }

    var visibleStatus = documentationCapture()
      ? error ? "Operation failed; details hidden in documentation mode."
        : status.indexOf("Backup created:") === 0 ? "Backup created; path hidden in documentation mode." : status
      : error || status;

    return h(SettingsCard, {
      className: "dirty-rank-settings-card dirty-ui-pilot",
      bodyClassName: "dirty-rank-settings-body",
      plugin: props.plugin,
      footer: h("div", { className: "card-footer dirty-plugins-card-footer dirty-rank-settings-actions" },
        SharedSaveStatus ? h(SharedSaveStatus, {
          className: "dirty-rank-settings-status",
          message: visibleStatus || (dirty ? "Waiting to save automatically…" : ""),
          state: error ? "error" : busy || saving ? "saving" : dirty ? "pending" : "saved",
        }) : h("span", {
          className: "dirty-rank-settings-status" + (error ? " dirty-ui-text-error" : ""),
          role: error ? "alert" : "status",
        }, visibleStatus)
      ),
    },
      h(Section, {
        title: "Gender boxes",
        description: "Name each box and choose the genders that battle and rank together. Each box has its own categories and ratings. Rename or expand an existing box to keep its ratings; new boxes start unrated.",
      },
        h("div", { className: "dirty-rank-category-list" }, draft.genderBoxes.map(function (box) {
          var nameError = !String(box.name || "").trim() ? "Enter a box name." : draft.genderBoxes.some(function (other) {
            return other.id !== box.id && String(other.name || "").trim().toLowerCase() === String(box.name || "").trim().toLowerCase();
          }) ? "Choose a unique box name." : "";
          return h("div", { className: "dirty-rank-category-editor dirty-rank-box-editor", key: box.id, "data-box-id": box.id },
            h(Field, { id: "dirty-rank-box-name-" + box.id, label: "Box name", error: nameError },
              h("input", { className: "form-control", id: "dirty-rank-box-name-" + box.id, value: box.name, maxLength: 80, type: "text",
                onChange: function (event) { updateBox(box.id, { name: event.target.value }); } })
            ),
            h("fieldset", { className: "dirty-rank-category-genders" },
              h("legend", null, "Genders in this box"),
              h("div", { className: "dirty-rank-cohort-options" }, COHORTS.map(function (item) {
                var checked = box.genders.indexOf(item[0]) !== -1;
                return h(Toggle, { id: "dirty-rank-box-gender-" + box.id + "-" + item[0], key: item[0], label: item[1], checked: checked,
                  disabled: checked && box.genders.length === 1,
                  onChange: function (value) {
                    var genders = box.genders.filter(function (gender) { return gender !== item[0]; });
                    if (value) genders.push(item[0]);
                    if (genders.length) updateBox(box.id, { genders: parseEnabledCohorts(genders, box.genders) });
                  } });
              }))
            ),
            h("div", { className: "dirty-rank-data-tools d-flex flex-wrap align-items-center" },
              h(Toggle, { checked: box.enabled, label: "Enable this box", disabled: box.enabled && draft.enabledCohorts.length === 1,
                onChange: function (value) { toggleCohort(box.id, value); } }),
              h(RankButton, { onClick: function () {
                setEditingCohort(box.id);
                var section = document.getElementById && document.getElementById("dirty-rank-category-cohort");
                if (section && section.scrollIntoView) section.scrollIntoView({ block: "center", behavior: "smooth" });
              } }, "Edit categories"),
              h(RankButton, { disabled: draft.genderBoxes.length <= 1 || (box.enabled && draft.enabledCohorts.length === 1),
                onClick: function () { removeBox(box.id); }, title: "Remove this box from the options; its stored ratings are retained" }, "Remove box")
            )
          );
        })),
        h(RankButton, { disabled: draft.genderBoxes.length >= 24, onClick: addBox }, "+ Add gender box"),
        draft.enabledCohorts.length > 1 && h("div", { className: "dirty-rank-settings-grid dirty-rank-settings-grid-compact", style: { marginTop: "0.9rem" } },
          h(Field, { id: "dirty-rank-default-cohort", label: "Default gender box" },
            h("select", {
              className: "form-control",
              id: "dirty-rank-default-cohort",
              onChange: function (event) { changed({ defaultCohort: event.target.value }); },
              value: draft.defaultCohort,
            }, boxOptions(draft, true).map(function (item) { return h("option", { key: item[0], value: item[0] }, item[1]); }))
          )
        )
      ),
      h(Section, {
        title: "Navigation",
        description: "Choose which DirtyRank pages appear in Stash's utility navigation. Hidden pages remain available through direct links.",
      },
        h("div", { className: "dirty-rank-settings-row" },
          h(Toggle, { checked: draft.showBattlesInMenu, label: "Show Battles in the Stash header", onChange: function (value) { changed({ showBattlesInMenu: value }); } }),
          h(Toggle, { checked: draft.showLeaderboardsInMenu, label: "Show Leaderboards in the Stash header", onChange: function (value) { changed({ showLeaderboardsInMenu: value }); } })
        )
      ),
      h(Section, {
        title: "Leaderboard presentation",
        description: "Choose the featured layout and standings view. Changes save automatically and apply to every leaderboard statistic.",
      },
        h("div", { className: "dirty-rank-settings-grid dirty-rank-leaderboard-settings" },
          h(Field, { id: "dirty-rank-leaderboard-top-count", label: "Featured performers" },
            h("select", { className: "form-control", id: "dirty-rank-leaderboard-top-count", onChange: function (event) {
              var topCount = leaderboardTopCount(event.target.value);
              changed({ leaderboardTopCount: topCount, leaderboardPerformerCount: leaderboardPerformerCount(draft.leaderboardPerformerCount, topCount) });
            }, value: draft.leaderboardTopCount },
              LEADERBOARD_TOP_OPTIONS.map(function (option) { return h("option", { key: option.count, value: option.count }, option.name); }))
          ),
          h(Field, {
            id: "dirty-rank-leaderboard-performer-count",
            label: "Performers per page",
            help: "Includes the featured performers. Use a multiple of " + draft.leaderboardTopCount + "; changing the layout rounds the count up to a valid multiple.",
            error: leaderboardPerformerCountError(draft),
          }, h("input", {
            className: "form-control",
            id: "dirty-rank-leaderboard-performer-count",
            type: "number",
            min: draft.leaderboardTopCount * 2,
            max: Math.floor(1000 / draft.leaderboardTopCount) * draft.leaderboardTopCount,
            step: draft.leaderboardTopCount,
            value: draft.leaderboardPerformerCount,
            onChange: function (event) { changed({ leaderboardPerformerCount: event.target.value }); },
          })),
          h(Field, { id: "dirty-rank-leaderboard-view", label: "Standings view" },
            h("select", { className: "form-control", id: "dirty-rank-leaderboard-view", onChange: function (event) { changed({ leaderboardView: event.target.value }); }, value: draft.leaderboardView },
              h("option", { value: "gallery" }, "Gallery"), h("option", { value: "table" }, "Table"))
          )
        )
      ),
      h(Section, {
        title: "Battle presentation",
        description: "Control what is revealed on performer cards. These choices do not change the rating pools.",
      },
        h("div", { className: "dirty-rank-settings-row" },
          h(Toggle, { checked: draft.showRatingsBeforeVote, label: "Show ratings and ranks before voting", onChange: function (value) { changed({ showRatingsBeforeVote: value }); } }),
          h(Toggle, { checked: draft.hidePerformerImages, label: "Hide performer images in battles", onChange: function (value) { changed({ hidePerformerImages: value }); } }),
          h(Toggle, { checked: draft.hideBattleStandings, label: "Hide standings during battles", onChange: function (value) { changed({ hideBattleStandings: value }); } }),
          h(Toggle, {
            checked: draft.autoPlayTopScenes,
            label: h("span", {
              title: "Automatic previews play each performer's highest-rated full scene, muted, from a random point between 30% and 70%. Photos remain clickable for voting unless hidden above.",
            }, "Automatically play top scenes"),
            onChange: function (value) { changed({ autoPlayTopScenes: value }); },
          }),
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
          draft.confidenceGoal === "top" && h(Field, {
            id: "dirty-rank-confidence-top-n",
            label: "Top performers to stabilize",
            error: !String(draft.confidenceTopN).trim() || !Number.isInteger(Number(draft.confidenceTopN)) ||
              Number(draft.confidenceTopN) < 1 || Number(draft.confidenceTopN) > 1000
              ? "Enter a whole number from 1 to 1000." : "",
          },
            h("input", {
              className: "form-control",
              id: "dirty-rank-confidence-top-n",
              max: 1000,
              min: 1,
              onChange: function (event) { changed({ confidenceTopN: event.target.value }); },
              step: 1,
              type: "number",
              value: draft.confidenceTopN,
            })
          )
        )
      ),
      h(Section, {
        title: "Overall scoring",
        description: "Experiment with how categories combine into the overall leaderboard and Stash performer sort. Changes save automatically and recalculate existing scores; category ratings and battle history are kept.",
      },
        h(Field, { id: "dirty-rank-overall-strategy", label: "Scoring strategy",
          help: overallScoreStrategy(draft.overallScoreStrategy).description },
          h("select", {
            className: "form-control", id: "dirty-rank-overall-strategy", value: draft.overallScoreStrategy,
            onChange: function (event) { changed({ overallScoreStrategy: event.target.value }); },
          }, OVERALL_SCORE_STRATEGIES.map(function (strategy) {
            return h("option", { key: strategy.id, value: strategy.id }, strategy.name);
          }))
        ),
        draft.overallScoreStrategy === "power" && h("div", { className: "dirty-rank-settings-grid" },
          OVERALL_SCORE_PARAMETERS.filter(function (definition) {
            return definition.strategy === draft.overallScoreStrategy;
          }).map(function (definition) {
            var id = "dirty-rank-" + definition.key;
            return h(Field, { key: definition.key, id: id, label: definition.label, help: definition.help,
              error: overallScoreParameterError(draft[definition.key], definition) },
              h("input", {
                className: "form-control", id: id, type: "number", min: definition.min, max: definition.max,
                step: definition.step, value: draft[definition.key],
                onChange: function (event) {
                  var update = {};
                  update[definition.key] = event.target.value;
                  changed(update);
                },
              })
            );
          })
        )
      ),
      h(Section, {
        title: "Rating categories",
        description: "Choose a gender box, then define its categories and their weights. Categories and ratings are independent between boxes.",
      },
        draft.genderBoxes.length > 1 && h("div", { className: "dirty-rank-category-cohort" },
          h(Field, { id: "dirty-rank-category-cohort", label: "Categories for gender box" },
            h("select", {
              className: "form-control",
              id: "dirty-rank-category-cohort",
              onChange: function (event) { setEditingCohort(event.target.value); },
              value: editingCohort,
            }, boxOptions(draft, false).map(function (item) { return h("option", { key: item[0], value: item[0] }, item[1]); }))
          )
        ),
        h("div", { className: "dirty-rank-category-list" },
          editingCategories.map(function (category, index) {
            return h("div", { className: "dirty-rank-category-editor", key: editingCohort + ":" + category.id },
              h("div", { className: "dirty-rank-category-toolbar d-flex flex-wrap align-items-center justify-content-between" },
                h("span", { className: "dirty-rank-category-sex" }, boxFor(draft, editingCohort).name),
                h("div", { className: "dirty-rank-data-tools d-flex flex-wrap align-items-center" },
                  h(RankButton, { className: "dirty-rank-category-reset", disabled: busy || saving || dirty, tone: "danger", title: "Reset ratings for " + boxFor(draft, editingCohort).name + " / " + category.name,
                    onClick: function () { resetCategoryPool(editingCohort, category); } }, "Reset ratings"),
                  SharedIconButton ? h(SharedIconButton, { ariaLabel: "Move category up", disabled: index === 0, fallback: "↑", onClick: function () { moveCategory(index, -1); } }) : h("button", { "aria-label": "Move category up", className: "dirty-ui-icon-button", disabled: index === 0, onClick: function () { moveCategory(index, -1); }, type: "button" }, "↑"),
                  SharedIconButton ? h(SharedIconButton, { ariaLabel: "Move category down", disabled: index === editingCategories.length - 1, fallback: "↓", onClick: function () { moveCategory(index, 1); } }) : h("button", { "aria-label": "Move category down", className: "dirty-ui-icon-button", disabled: index === editingCategories.length - 1, onClick: function () { moveCategory(index, 1); }, type: "button" }, "↓"),
                  SharedIconButton ? h(SharedIconButton, { ariaLabel: "Remove category", disabled: editingCategories.length <= 1, fallback: "×", onClick: function () { removeCategory(index); } }) : h("button", { "aria-label": "Remove category", className: "dirty-ui-icon-button", disabled: editingCategories.length <= 1, onClick: function () { removeCategory(index); }, type: "button" }, "×")
                )
              ),
              h("div", { className: "dirty-rank-category-basics" },
                h(Field, { id: "dirty-rank-category-name-" + editingCohort + "-" + index, label: "Name", error: categoryNameError(category, index) },
                  h("input", { className: "form-control", id: "dirty-rank-category-name-" + editingCohort + "-" + index, maxLength: 80, onChange: function (event) { updateCategory(index, { name: event.target.value }); }, type: "text", value: category.name })
                ),
                h(Field, {
                  id: "dirty-rank-category-weight-" + editingCohort + "-" + index,
                  label: "Overall weight",
                  error: String(category.weight).trim() && Number(category.weight) >= 0.01 && Number(category.weight) <= 1000
                    ? "" : "Enter a weight between 0.01 and 1000.",
                },
                  h("input", { className: "form-control", id: "dirty-rank-category-weight-" + editingCohort + "-" + index, min: 0.01, max: 1000, step: 0.1, onChange: function (event) { updateCategory(index, { weight: event.target.value }); }, type: "number", value: category.weight })
                )
              ),
              h(Field, { id: "dirty-rank-category-description-" + editingCohort + "-" + index, label: "Description" },
                h("textarea", { className: "form-control", id: "dirty-rank-category-description-" + editingCohort + "-" + index, maxLength: 500, onChange: function (event) { updateCategory(index, { description: event.target.value }); }, rows: 2, value: category.description })
              ),
              h(Toggle, { checked: category.enabled, label: "Enable this category", onChange: function (value) { updateCategory(index, { enabled: value }); } })
            );
          }),
          h(RankButton, { onClick: addCategory }, "+ Add category")
        )
      ),
      h("details", { className: "dirty-rank-advanced" },
        h("summary", { className: "dirty-rank-advanced-summary" },
          h("span", null, "Advanced configuration"),
          h("span", { className: "dirty-rank-advanced-hint" }, "Matchmaking and Glicko-2 parameters")
        ),
        h("div", { className: "dirty-rank-advanced-body" },
          h("div", { className: "dirty-rank-preset-row" },
          h("div", { className: "dirty-rank-data-tools d-flex flex-wrap align-items-center", role: "group", "aria-label": "Rating presets" },
            h(RankButton, { className: "dirty-rank-preset-current", disabled: busy, tone: "primary", title: "Restore advanced values from when this settings page was opened", onClick: function () { changed(currentParameters); } }, "Current"),
            RATING_PRESETS.map(function (preset) {
              var selected = ratingPresetFor(draft) === preset;
              return h(RankButton, { key: preset.id, disabled: busy, pressed: selected, tone: selected ? "primary" : "secondary", onClick: function () { changed(preset.settings); } }, preset.name);
            })
          ),
          h("span", { className: "dirty-rank-preset-estimate", role: "status", "aria-live": "polite", title: "Fresh category for the gender box selected under Rating categories. Assumes informative close matchups until every performer reaches Refined; each battle updates two performers. Actual totals depend on results and matchmaking. Parameters that do not change predicted uncertainty can leave the rounded total unchanged." },
            presetEstimate ? (presetEstimate.capped ? "≥" : "") + presetEstimate.battles.toLocaleString() + " battles expected to rank 1 category for " + presetEstimate.performers.toLocaleString() + " performers"
              : estimateError ? "Battle estimate unavailable" : "Loading battle estimate…"
          )),
          h("p", { className: "dirty-rank-advanced-copy", "aria-live": "polite" }, ratingPresetFor(draft)
            ? ratingPresetFor(draft).description
            : "Custom configuration. Choose a preset or adjust the values below."),
          h("p", { className: "dirty-rank-advanced-copy" }, "Presets save automatically and apply to future battles. Existing ratings and history are kept; starting values apply to unrated performers. Battle weight drives faster refinement; lower tau limits volatility changes. Recent-pair avoidance and calibration are soft matchmaking preferences. DirtyRank does not inflate uncertainty during inactivity."),
          h("div", { className: "dirty-rank-settings-grid" },
            h(Field, {
              id: "dirty-rank-evidence-weight",
              label: "Evidence per battle",
              help: "How strongly one comparison reduces uncertainty. 1.0 is standard Glicko-2; 2.0 treats a consistent subjective choice as twice the rating evidence while still recording one battle.",
            },
              h("input", { className: "form-control", id: "dirty-rank-evidence-weight", min: 1, max: 3, onChange: function (event) { changed({ evidenceWeight: Number(event.target.value) }); }, step: 0.1, type: "number", value: draft.evidenceWeight })
            ),
            h(Field, { id: "dirty-rank-repeat-window", label: "Recent pairs to avoid", help: "Prefer different pairings within this many recent battles. A small pool may still repeat a pair." },
              h("input", { className: "form-control", id: "dirty-rank-repeat-window", min: 0, max: 100, onChange: function (event) { changed({ avoidRepeatWindow: Number(event.target.value) }); }, type: "number", value: draft.avoidRepeatWindow })
            ),
            h(Field, { id: "dirty-rank-calibration", label: "Calibration matches (%)", help: "Chance of favouring broader rating gaps. Lower values focus on the matchups expected to reduce uncertainty most." },
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
    if (SharedNavAction) return h(SharedNavAction, {
      as: NavLink,
      className: "dirty-rank-nav-link dirty-rank-nav-button",
      exact: false,
      icon: RankNavGlyph("battle"),
      label: "DirtyRank performer battles",
      to: ROUTE_PATH,
    });
    return h(NavLink, { className: "nav-utility dirty-rank-nav-link", exact: false, to: ROUTE_PATH },
      h("button", { className: "minimal d-flex align-items-center h-100 dirty-rank-nav-button", title: "DirtyRank performer battles", type: "button" },
        RankNavGlyph("battle")
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

  function RankNavGlyph(kind) {
    return h("i", { "aria-hidden": "true", className: "dirty-rank-nav-icon" },
      h("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "var(--dirty-ui-icon-white)", strokeWidth: "1.8" },
        kind === "battle"
          ? ["red", "blue"].map(function (color, index) {
              return h("g", { key: color, transform: index ? "translate(24 0) scale(-1 1)" : undefined, strokeLinejoin: "round", strokeLinecap: "round" },
                h("path", { d: "M2.5 2.5l4 1L17 14l-3 3L3.5 6.5z", fill: "var(--dirty-ui-icon-" + color + ")", strokeWidth: "0.7" }),
                h("path", { d: "M16.5 16.5l4 4", strokeWidth: "3.2" }),
                h("path", { d: "M16.5 16.5l4 4", stroke: "var(--dirty-ui-icon-blue)", strokeWidth: "1.6" }),
                h("path", { d: "M12.5 18.5l6-6M19 22l3-3", strokeWidth: "1.8" })
              );
            })
          : h(Fragment, null,
              h("path", { d: "M7 5H4v2c0 2 1 3 4 4", stroke: "var(--dirty-ui-icon-red)" }),
              h("path", { d: "M17 5h3v2c0 2-1 3-4 4", stroke: "var(--dirty-ui-icon-blue)" }),
              h("path", { d: "M7 3h10v6c0 3-2 5-5 5s-5-2-5-5V3z", fill: "var(--dirty-ui-icon-blue)" }),
              h("path", { d: "M12 14v5M8 21h8M10 19h4" })
            )
      )
    );
  }

  function DirtyRankLeaderboardsNavLink() {
    if (SharedNavAction) return h(SharedNavAction, {
      as: NavLink,
      className: "dirty-rank-nav-link dirty-rank-leaderboards-nav-link dirty-rank-nav-button",
      exact: true,
      icon: RankNavGlyph("leaderboard"),
      label: "DirtyRank leaderboards",
      to: LEADERBOARDS_ROUTE_PATH,
    });
    return h(NavLink, { className: "nav-utility dirty-rank-nav-link dirty-rank-leaderboards-nav-link", exact: true, to: LEADERBOARDS_ROUTE_PATH },
      h("button", { className: "minimal d-flex align-items-center h-100 dirty-rank-nav-button", title: "DirtyRank leaderboards", type: "button" },
        RankNavGlyph("leaderboard")
      )
    );
  }

  function DirtyRankNavLinks() {
    var navigationState = useState(null);
    var navigation = navigationState[0];
    var setNavigation = navigationState[1];

    useEffect(function () {
      var active = true;
      function refreshNavigation() {
        DirtyPlugins.getPluginSettings(PLUGIN_ID).then(function (configuration) {
          if (active) setNavigation(settingsFromConfiguration(configuration));
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
      navigation && navigation.showBattlesInMenu && h(DirtyRankBattleNavLink, null),
      navigation && navigation.showLeaderboardsInMenu && h(DirtyRankLeaderboardsNavLink, null)
    );
  }

  PluginApi.register.route(ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(BATTLE_CATEGORY_ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(GAUNTLET_ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(GAUNTLET_ROUTE_PATH + "/:categoryId", DirtyRankRoute);
  PluginApi.register.route(LEADERBOARDS_ROUTE_PATH + "/:statistic?", DirtyRankLeaderboardsRoute);
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
    if (props && props.filter && props.extraCriteria && props.extraCriteria.dirtyRankLeaderboardFilter &&
        window.location.pathname.indexOf(LEADERBOARDS_ROUTE_PATH) === 0) {
      return h(DirtyRankLeaderboardFilterCapture, { filter: props.filter });
    }
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
      ratingPresets: RATING_PRESETS,
      ratingPresetFor: ratingPresetFor,
      categoryConfidence: categoryConfidence,
      estimatedMatchesToConfidence: estimatedMatchesToConfidence,
      freshCategoryBattleEstimate: freshCategoryBattleEstimate,
      battleCategoryPath: battleCategoryPath,
      battleRouteFromPath: battleRouteFromPath,
      expectedDeviationAfterBattle: expectedDeviationAfterBattle,
      leaderboardData: leaderboardData,
      leaderboardPoolFor: leaderboardPoolFor,
      overallCategoryScoreFor: overallCategoryScoreFor,
      setOverallReferencePerformers: setOverallReferencePerformers,
      sortPerformersByOverall: sortPerformersByOverall,
      pairInformationGain: pairInformationGain,
      precisionTier: precisionTier,
      applyRatingIndex: applyRatingIndex,
      selectGauntletPair: selectGauntletPair,
      selectKingsStartingPair: selectKingsStartingPair,
      selectKingsPair: selectKingsPair,
      selectPair: selectPair,
      settingsFromConfiguration: settingsFromConfiguration,
      serializedSettings: serializedSettings,
    },
    leaderboardsRoute: LEADERBOARDS_ROUTE_PATH,
    gauntletRoute: GAUNTLET_ROUTE_PATH,
    overallSortLabel: OVERALL_SORT_LABEL,
    route: ROUTE_PATH,
  };
  debugLog("dirtyRank", "script finished registering", {
    elapsedMs: DirtyPlugins.debugElapsed ? DirtyPlugins.debugElapsed() : null,
  });
  window.__dirtyCurrentPluginId = null;
})();
