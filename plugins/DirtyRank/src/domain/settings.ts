import { constants, defaults, limits } from "@generated/dirtyRank.settings";
import { COHORTS } from "../constants";
import type { RankCategory, RankGenderBox, RankPerformer, RankSettingsDependencies, RankSettingsDraft } from "../types";
import { integer, number } from "./numbers";
export function createSettings(dependencies: RankSettingsDependencies) {
  var DirtyPlugins = dependencies.DirtyPlugins;
  var leaderboardPerformerCountError = dependencies.leaderboardPerformerCountError;
  var cohortLabel = dependencies.cohortLabel;
  var leaderboardTopCount = dependencies.leaderboardTopCount;
  var leaderboardPerformerCount = dependencies.leaderboardPerformerCount;
  var CATEGORY_PREFERENCE_STORAGE_KEY = "dirtyRank:selectedCategoryByCohort";
  var CONFIGURATION_CHANGED_EVENT = "dirty-plugins:configuration-changed";
  // Defaults, bounds and presets are generated from schemas/dirtyRank.settings.json.
  var DEFAULT_CATEGORY_DEFINITIONS = constants.defaultCategories.map(function (category) { return Object.assign({}, category); });
  function defaultCategoriesByCohort() {
    var result: Record<string, RankCategory[]> = {};
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
    {
      key: "overallPower" as const, label: "Power", strategy: "power", min: limits.overallPower.min, max: limits.overallPower.max, step: limits.overallPower.step,
      help: "1 matches Simple weighted. 2 mildly emphasizes strengths, 3 is the recommended starting point, and 4 emphasizes them more. Decimals are supported."
    },
  ];
  function overallScoreStrategy(value: unknown) {
    return OVERALL_SCORE_STRATEGIES.find(function (strategy) { return strategy.id === value; }) || OVERALL_SCORE_STRATEGIES[0];
  }
  function overallScoreParameterError(value: unknown, definition: {
    min: number;
    max: number;
  }) {
    return !String(value == null ? "" : value).trim() || !Number.isFinite(Number(value)) ||
      Number(value) < definition.min || Number(value) > definition.max
      ? "Enter a number from " + definition.min + " to " + definition.max + "." : "";
  }
  var DEFAULT_SETTINGS = Object.assign({ categoriesByCohort: defaultCategoriesByCohort() }, JSON.parse(JSON.stringify(defaults)) as typeof defaults);
  // Lichess core values: lila Glicko.scala and scalachess glicko/model.scala.
  // Evidence weight and matchmaking controls are DirtyRank extensions.
  var RATING_PRESETS: Array<{
    id: string;
    name: string;
    description: string;
    settings: Partial<RankSettingsDraft>;
  }> = constants.ratingPresets;
  function ratingPresetFor(settings: RankSettingsDraft) {
    return RATING_PRESETS.filter(function (preset) {
      return Object.keys(preset.settings).every(function (key) {
        return settings[key as keyof RankSettingsDraft] === preset.settings[key as keyof RankSettingsDraft];
      });
    })[0] || null;
  }
  function ratingParameters(settings: RankSettingsDraft) {
    var parameters: Partial<RankSettingsDraft> = {};
    Object.keys(RATING_PRESETS[0].settings).forEach(function (key) { Object.assign(parameters, { [key]: settings[key as keyof RankSettingsDraft] }); });
    return parameters;
  }
  var asObject = DirtyPlugins.values.asObject;
  var parseMaybeJson = DirtyPlugins.values.parseMaybeJson;
  function slug(value: unknown) {
    var normalized = String(value || "").trim().toLowerCase();
    if (normalized.normalize)
      normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "category";
  }
  function uniqueCategoryId(name: string, used: Set<string>) {
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
  function parseGenderBoxes(value: unknown, enabledCohorts: string[]) {
    value = parseMaybeJson(value);
    var used = new Set();
    var boxes: RankGenderBox[] = [];
    if (Array.isArray(value))
      value.slice(0, 24).forEach(function (input) {
        var raw = asObject(input);
        if (!raw || typeof raw !== "object")
          return;
        var id = String(raw.id || "").trim().toUpperCase();
        if (!/^(FEMALE|MALE|TRANSGENDER_FEMALE|TRANSGENDER_MALE|INTERSEX|NON_BINARY|BOX-[A-Z0-9-]{1,60})$/.test(id) || used.has(id))
          return;
        used.add(id);
        boxes.push({
          id: id, name: String(raw.name || cohortLabel(id)).trim().slice(0, 80),
          genders: parseEnabledCohorts(raw.genders, COHORTS.some(function (item) { return item[0] === id; }) ? [id] : ["FEMALE"]),
          enabled: DirtyPlugins.values.coerceBoolean(raw.enabled, true)
        });
      });
    if (!boxes.length)
      boxes = COHORTS.map(function (item) {
        return { id: item[0], name: item[1], genders: [item[0]], enabled: enabledCohorts.indexOf(item[0]) !== -1 };
      });
    if (!boxes.some(function (box) { return box.enabled; }))
      boxes[0].enabled = true;
    return boxes;
  }
  function boxFor(settings: RankSettingsDraft, cohort: string) {
    return (settings.genderBoxes || []).find(function (box) { return box.id === cohort; }) ||
      { id: cohort, name: cohortLabel(cohort), genders: [cohort] };
  }
  function boxOptions(settings: RankSettingsDraft, enabledOnly?: boolean) {
    return settings.genderBoxes.filter(function (box) { return !enabledOnly || box.enabled; }).map(function (box) { return [box.id, box.name]; });
  }
  function boxGenders(settings: RankSettingsDraft, cohort: string) {
    return boxFor(settings, cohort).genders;
  }
  function boxGendersLabel(settings: RankSettingsDraft, cohort: string) {
    return boxGenders(settings, cohort).map(cohortLabel).join(" + ");
  }
  function categoryIncludes(performer: RankPerformer, _category: Partial<RankCategory>, cohort: string, settings: RankSettingsDraft) {
    return boxGenders(settings, cohort).indexOf(String(performer.gender || "").toUpperCase()) !== -1;
  }
  function categoryById(settings: RankSettingsDraft, categoryId: string, cohort: string) {
    return categoriesFor(settings, cohort).find(function (category) { return category.id === categoryId; });
  }
  function categoriesForPerformer(settings: RankSettingsDraft, cohort: string, performer?: RankPerformer | null) {
    return categoriesFor(settings, cohort).filter(function (category) {
      return category.enabled && (!performer || categoryIncludes(performer, category, cohort, settings));
    });
  }
  function battleCohortFor(settings: RankSettingsDraft, performer: RankPerformer | null | undefined, requestedCohort: string) {
    var available = settings.enabledCohorts.filter(function (cohort) {
      return categoriesForPerformer(settings, cohort, performer).length > 0;
    });
    if (available.indexOf(requestedCohort) !== -1)
      return requestedCohort;
    if (available.indexOf(settings.defaultCohort) !== -1)
      return settings.defaultCohort;
    var preferred = performer ? String(performer.gender || "").toUpperCase() : settings.defaultCohort;
    return available.indexOf(preferred) !== -1 ? preferred : available[0] || "";
  }
  function parseCategoryList(value: unknown, _cohort: string) {
    var inputs = Array.isArray(value) ? value : DEFAULT_CATEGORY_DEFINITIONS;
    var used = new Set(["overall"]);
    var categories: RankCategory[] = [];
    inputs.slice(0, 24).forEach(function (input) {
      var raw = asObject(input);
      if (!raw || typeof raw !== "object")
        return;
      var name = String(raw.name || "").trim().slice(0, 80);
      if (!name)
        return;
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
  function parseCategoriesByCohort(value: unknown, boxes?: RankGenderBox[]) {
    value = parseMaybeJson(value);
    var result: Record<string, RankCategory[]> = {};
    var source = asObject(value);
    COHORTS.forEach(function (cohort) {
      result[cohort[0]] = parseCategoryList(source[cohort[0]], cohort[0]);
    });
    Object.keys(source).concat((boxes || []).map(function (box) { return box.id; })).forEach(function (id) {
      if (!result[id])
        result[id] = parseCategoryList(source[id], id);
    });
    return result;
  }
  function categoriesFor(settings: RankSettingsDraft, cohort: string) {
    return (settings.categoriesByCohort && settings.categoriesByCohort[cohort]) || [];
  }
  function categoryPreferences(): Record<string, string> {
    try {
      var stored = JSON.parse(window.localStorage.getItem(CATEGORY_PREFERENCE_STORAGE_KEY) || "{}");
      return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    }
    catch (_error) {
      return {};
    }
  }
  function rememberCategory(cohort: string, categoryId: string) {
    if (!cohort || !categoryId)
      return;
    try {
      var stored = categoryPreferences();
      stored[String(cohort).toUpperCase()] = String(categoryId);
      window.localStorage.setItem(CATEGORY_PREFERENCE_STORAGE_KEY, JSON.stringify(stored));
    }
    catch (_error) {
      // The in-memory selection still remains stable if browser storage is unavailable.
    }
  }
  function preferredCategoryId(settings: RankSettingsDraft, cohort: string, fallback?: string) {
    var enabled = categoriesFor(settings, cohort).filter(function (category) { return category.enabled; });
    var remembered = categoryPreferences()[String(cohort).toUpperCase()];
    if (enabled.some(function (category) { return category.id === remembered; }))
      return remembered;
    if (enabled.some(function (category) { return category.id === fallback; }))
      return fallback!;
    return enabled[0] ? enabled[0].id : "";
  }
  function parseEnabledCohorts(value: unknown, fallback: string[]) {
    value = parseMaybeJson(value);
    if (typeof value === "string")
      value = value.split(",");
    var requested = new Set(Array.isArray(value) ? value.map(function (item) {
      return String(item || "").trim().toUpperCase();
    }) : []);
    var result = COHORTS.filter(function (item) { return requested.has(item[0]); }).map(function (item) { return item[0]; });
    return result.length ? result : fallback.slice();
  }
  function settingsFromConfiguration(configuration: unknown) {
    var source = asObject(configuration);
    var initialDeviation = number(source.initialDeviation, defaults.initialDeviation, limits.initialDeviation.min, limits.initialDeviation.max);
    // Floor and provisional threshold are bounded by the other deviations, not only their static limits.
    var deviationFloor = number(source.deviationFloor, defaults.deviationFloor, limits.deviationFloor.min, initialDeviation);
    var cohort = String(source.defaultCohort || defaults.defaultCohort).toUpperCase();
    var genderBoxes = parseGenderBoxes(source.genderBoxes, parseEnabledCohorts(source.enabledCohorts, [cohort]));
    var enabledCohorts = genderBoxes.filter(function (box) { return box.enabled; }).map(function (box) { return box.id; });
    if (enabledCohorts.indexOf(cohort) === -1)
      cohort = enabledCohorts[0];
    var confidenceGoal = String(source.confidenceGoal || defaults.confidenceGoal).toLowerCase();
    if (["all", "ranking", "top"].indexOf(confidenceGoal) === -1)
      confidenceGoal = defaults.confidenceGoal;
    return {
      categoriesByCohort: parseCategoriesByCohort(source.categories, genderBoxes),
      genderBoxes: genderBoxes,
      defaultCohort: cohort,
      enabledCohorts: enabledCohorts,
      showBattlesInMenu: DirtyPlugins.values.coerceBoolean(source.showBattlesInMenu, defaults.showBattlesInMenu),
      showLeaderboardsInMenu: DirtyPlugins.values.coerceBoolean(source.showLeaderboardsInMenu, defaults.showLeaderboardsInMenu),
      leaderboardTopCount: leaderboardTopCount(source.leaderboardTopCount),
      leaderboardPerformerCount: leaderboardPerformerCount(source.leaderboardPerformerCount, source.leaderboardTopCount),
      leaderboardView: source.leaderboardView === "table" ? "table" : defaults.leaderboardView,
      overallScoreStrategy: overallScoreStrategy(source.overallScoreStrategy).id,
      overallPower: number(source.overallPower, defaults.overallPower, limits.overallPower.min, limits.overallPower.max),
      showRatingsBeforeVote: DirtyPlugins.values.coerceBoolean(source.showRatingsBeforeVote, defaults.showRatingsBeforeVote),
      hidePerformerImages: DirtyPlugins.values.coerceBoolean(source.hidePerformerImages, defaults.hidePerformerImages),
      hideBattleStandings: DirtyPlugins.values.coerceBoolean(source.hideBattleStandings, defaults.hideBattleStandings),
      autoPlayTopScenes: DirtyPlugins.values.coerceBoolean(source.autoPlayTopScenes, defaults.autoPlayTopScenes),
      includePerformersWithoutImages: DirtyPlugins.values.coerceBoolean(source.includePerformersWithoutImages, defaults.includePerformersWithoutImages),
      confidenceGoal: confidenceGoal,
      confidenceTopN: integer(source.confidenceTopN, defaults.confidenceTopN, limits.confidenceTopN.min, limits.confidenceTopN.max),
      avoidRepeatWindow: integer(source.avoidRepeatWindow, defaults.avoidRepeatWindow, limits.avoidRepeatWindow.min, limits.avoidRepeatWindow.max),
      calibrationPercent: integer(source.calibrationPercent, defaults.calibrationPercent, limits.calibrationPercent.min, limits.calibrationPercent.max),
      initialRating: number(source.initialRating, defaults.initialRating, limits.initialRating.min, limits.initialRating.max),
      initialDeviation: initialDeviation,
      initialVolatility: number(source.initialVolatility, defaults.initialVolatility, limits.initialVolatility.min, limits.initialVolatility.max),
      evidenceWeight: number(source.evidenceWeight, defaults.evidenceWeight, limits.evidenceWeight.min, limits.evidenceWeight.max),
      tau: number(source.tau, defaults.tau, limits.tau.min, limits.tau.max),
      deviationFloor: deviationFloor,
      provisionalDeviation: number(source.provisionalDeviation, defaults.provisionalDeviation, deviationFloor, initialDeviation),
    };
  }
  function serializedSettings(settings: RankSettingsDraft) {
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
      }, {} as Record<string, RankCategory[]>)),
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
  function validateSettings(settings: RankSettingsDraft) {
    if (!settings.enabledCohorts.length)
      return "Enable at least one gender box.";
    var boxNames = new Set();
    for (var boxIndex = 0;boxIndex < settings.genderBoxes.length;boxIndex += 1) {
      var box = settings.genderBoxes[boxIndex];
      var boxName = String(box.name || "").trim().toLowerCase();
      if (!boxName)
        return "Every gender box needs a name.";
      if (boxNames.has(boxName))
        return "Gender box names must be unique.";
      if (!box.genders.length)
        return "Choose at least one gender for each box.";
      boxNames.add(boxName);
    }
    for (var parameterIndex = 0;parameterIndex < OVERALL_SCORE_PARAMETERS.length;parameterIndex += 1) {
      var definition = OVERALL_SCORE_PARAMETERS[parameterIndex];
      if (overallScoreParameterError(settings[definition.key], definition)) {
        return definition.label + ": " + overallScoreParameterError(settings[definition.key], definition);
      }
    }
    var performerCountError = leaderboardPerformerCountError(settings);
    if (performerCountError)
      return performerCountError;
    if (settings.confidenceGoal === "top" &&
      (!String(settings.confidenceTopN).trim() || !Number.isInteger(Number(settings.confidenceTopN)) ||
        Number(settings.confidenceTopN) < limits.confidenceTopN.min || Number(settings.confidenceTopN) > limits.confidenceTopN.max)) {
      return "Top performers to stabilize must be between " + limits.confidenceTopN.min + " and " + limits.confidenceTopN.max + ".";
    }
    for (var cohortIndex = 0;cohortIndex < settings.genderBoxes.length;cohortIndex += 1) {
      var cohort = settings.genderBoxes[cohortIndex].id;
      var names = new Set();
      var cohortCategories = categoriesFor(settings, cohort);
      if (settings.enabledCohorts.indexOf(cohort) !== -1 && !cohortCategories.some(function (category) { return category.enabled; })) {
        return boxFor(settings, cohort).name + " needs at least one enabled category.";
      }
      for (var index = 0;index < cohortCategories.length;index += 1) {
        var name = String(cohortCategories[index].name || "").trim();
        if (!name)
          return "Every category needs a name.";
        if (names.has(name.toLowerCase()))
          return "Category names must be unique within each performer cohort.";
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
  function comparableSettings(settings: RankSettingsDraft) {
    return JSON.stringify(serializedSettings(settings));
  }
  return {
    validateSettings: validateSettings, CATEGORY_PREFERENCE_STORAGE_KEY: CATEGORY_PREFERENCE_STORAGE_KEY, CONFIGURATION_CHANGED_EVENT: CONFIGURATION_CHANGED_EVENT, COHORTS: COHORTS, DEFAULT_CATEGORY_DEFINITIONS: DEFAULT_CATEGORY_DEFINITIONS,
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
