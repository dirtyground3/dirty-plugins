// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyRankSettings";
  if (window[INSTANCE_KEY]) return;

  /** @param {{DirtyPlugins: *, cohortLabel: Function, leaderboardTopCount: Function, leaderboardPerformerCount: Function}} dependencies */
  function createSettings(dependencies) {
    var DirtyPlugins = dependencies.DirtyPlugins;
    var cohortLabel = dependencies.cohortLabel;
    var leaderboardTopCount = dependencies.leaderboardTopCount;
    var leaderboardPerformerCount = dependencies.leaderboardPerformerCount;

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

    return {
      CATEGORY_PREFERENCE_STORAGE_KEY: CATEGORY_PREFERENCE_STORAGE_KEY, CONFIGURATION_CHANGED_EVENT: CONFIGURATION_CHANGED_EVENT, COHORTS: COHORTS, DEFAULT_CATEGORY_DEFINITIONS: DEFAULT_CATEGORY_DEFINITIONS,
      defaultCategoriesByCohort: defaultCategoriesByCohort, OVERALL_SCORE_STRATEGIES: OVERALL_SCORE_STRATEGIES, OVERALL_SCORE_PARAMETERS: OVERALL_SCORE_PARAMETERS, overallScoreStrategy: overallScoreStrategy,
      overallScoreParameterError: overallScoreParameterError, DEFAULT_SETTINGS: DEFAULT_SETTINGS, RATING_PRESETS: RATING_PRESETS, ratingPresetFor: ratingPresetFor,
      ratingParameters: ratingParameters, asObject: asObject, parseMaybeJson: parseMaybeJson, number: number,
      integer: integer, slug: slug, uniqueCategoryId: uniqueCategoryId, parseGenderBoxes: parseGenderBoxes,
      boxFor: boxFor, boxOptions: boxOptions, boxGenders: boxGenders, boxGendersLabel: boxGendersLabel,
      categoryIncludes: categoryIncludes, categoryById: categoryById, categoriesForPerformer: categoriesForPerformer, battleCohortFor: battleCohortFor,
      parseCategoryList: parseCategoryList, parseCategoriesByCohort: parseCategoriesByCohort, categoriesFor: categoriesFor, categoryPreferences: categoryPreferences,
      rememberCategory: rememberCategory, preferredCategoryId: preferredCategoryId, parseEnabledCohorts: parseEnabledCohorts, settingsFromConfiguration: settingsFromConfiguration,
      serializedSettings: serializedSettings, comparableSettings: comparableSettings
    };
  }

  window[INSTANCE_KEY] = { createSettings: createSettings };
})();
