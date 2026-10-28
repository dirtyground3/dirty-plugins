import { constants, defaults, limits } from "@generated/dirtyRank.settings";
import { COHORTS } from "../constants";
import type { RankCategory, RankGenderBox, RankPerformer, RankSettingsDraft } from "../types";
import { asObject, coerceBoolean, parseMaybeJson } from "../../../DirtyPlugins/src/shared/values";
import {
  cohortLabel,
  leaderboardPerformerCount,
  leaderboardPerformerCountError,
  leaderboardTopCount,
} from "./navigation";
import { integer, number } from "./numbers";
type FlagKey =
  | "showBattlesInMenu"
  | "showLeaderboardsInMenu"
  | "showRatingsBeforeVote"
  | "hidePerformerImages"
  | "hideBattleStandings"
  | "autoPlayTopScenes"
  | "includePerformersWithoutImages";
type BoundedKey = Exclude<keyof typeof limits, "leaderboardPerformerCount">;
export const CATEGORY_PREFERENCE_STORAGE_KEY = "dirtyRank:selectedCategoryByCohort";
export const CONFIGURATION_CHANGED_EVENT = "dirty-plugins:configuration-changed";
// Defaults, bounds and presets are generated from schemas/dirtyRank.settings.json.
export const DEFAULT_CATEGORY_DEFINITIONS = constants.defaultCategories.map(category => Object.assign({}, category));
function defaultCategoriesByCohort() {
  const result: Record<string, RankCategory[]> = {};
  COHORTS.forEach(cohort => {
    result[cohort[0]] = DEFAULT_CATEGORY_DEFINITIONS.map(category => Object.assign({}, category));
  });
  return result;
}
// Rating strategies subtract `uncertainty` category RDs before comparing with the category average.
export const OVERALL_SCORE_STRATEGIES = [
  {
    id: "weighted",
    name: "Simple weighted",
    uncertainty: null,
    description:
      "80% category position + 20% matchup strength, averaged using category weights. Scores stay between 0 and 100.",
  },
  {
    id: "power",
    name: "Power mean",
    uncertainty: null,
    description:
      "Combine the current category scores with a weighted power mean. Strong categories compensate more for weaker ones, while every category still contributes. Scores stay between 0 and 100.",
  },
  {
    id: "rating",
    name: "Rating strength",
    uncertainty: 0,
    description:
      "How far each category rating is above that category's average, in standard deviations, averaged using category weights. Large rating gaps at the top count fully. 0 is average; most scores fall between -2 and 3.",
  },
  {
    id: "proven",
    name: "Proven rating strength",
    uncertainty: 1,
    description:
      "Rating strength after subtracting each category's rating deviation (RD), so performers with few battles must earn their place. Unrated categories count as a new rating. 0 is average.",
  },
];
export function ratingStrengthStrategy(value: unknown) {
  return overallScoreStrategy(value).uncertainty !== null;
}
export const OVERALL_SCORE_PARAMETERS = [
  {
    key: "overallPower" as const,
    label: "Power",
    strategy: "power",
    min: limits.overallPower.min,
    max: limits.overallPower.max,
    step: limits.overallPower.step,
    help: "1 matches Simple weighted. 2 mildly emphasizes strengths, 3 is the recommended starting point, and 4 emphasizes them more. Decimals are supported.",
  },
];
export function overallScoreStrategy(value: unknown) {
  return OVERALL_SCORE_STRATEGIES.find(strategy => strategy.id === value) || OVERALL_SCORE_STRATEGIES[0];
}
export function overallScoreParameterError(
  value: unknown,
  definition: {
    min: number;
    max: number;
  },
) {
  return !String(value == null ? "" : value).trim() ||
    !Number.isFinite(Number(value)) ||
    Number(value) < definition.min ||
    Number(value) > definition.max
    ? "Enter a number from " + definition.min + " to " + definition.max + "."
    : "";
}
export const DEFAULT_SETTINGS = Object.assign(
  { categoriesByCohort: defaultCategoriesByCohort() },
  JSON.parse(JSON.stringify(defaults)) as typeof defaults,
);
// Lichess core values: lila Glicko.scala and scalachess glicko/model.scala.
// Evidence weight and matchmaking controls are DirtyRank extensions.
export const RATING_PRESETS: Array<{
  id: string;
  name: string;
  description: string;
  settings: Partial<RankSettingsDraft>;
}> = constants.ratingPresets;
export function ratingPresetFor(settings: RankSettingsDraft) {
  return (
    RATING_PRESETS.filter(preset => {
      return Object.keys(preset.settings).every(
        key => settings[key as keyof RankSettingsDraft] === preset.settings[key as keyof RankSettingsDraft],
      );
    })[0] || null
  );
}
export function ratingParameters(settings: RankSettingsDraft) {
  const parameters: Partial<RankSettingsDraft> = {};
  Object.keys(RATING_PRESETS[0].settings).forEach(key => {
    Object.assign(parameters, { [key]: settings[key as keyof RankSettingsDraft] });
  });
  return parameters;
}
export function slug(value: unknown) {
  let normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized.normalize) normalized = normalized.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return (
    normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "category"
  );
}
export function uniqueCategoryId(name: string, used: Set<string>) {
  const base = slug(name);
  let id = base;
  let suffix = 1;
  while (used.has(id)) {
    const ending = "-" + suffix;
    id = base.slice(0, 64 - ending.length).replace(/-+$/g, "") + ending;
    suffix += 1;
  }
  used.add(id);
  return id;
}
function parseGenderBoxes(value: unknown, enabledCohorts: string[]) {
  value = parseMaybeJson(value);
  const used = new Set();
  let boxes: RankGenderBox[] = [];
  if (Array.isArray(value))
    value.slice(0, 24).forEach(input => {
      const raw = asObject(input);
      if (!raw || typeof raw !== "object") return;
      const id = String(raw.id || "")
        .trim()
        .toUpperCase();
      if (
        !/^(FEMALE|MALE|TRANSGENDER_FEMALE|TRANSGENDER_MALE|INTERSEX|NON_BINARY|BOX-[A-Z0-9-]{1,60})$/.test(id) ||
        used.has(id)
      )
        return;
      used.add(id);
      boxes.push({
        id,
        name: String(raw.name || cohortLabel(id))
          .trim()
          .slice(0, 80),
        genders: parseEnabledCohorts(raw.genders, COHORTS.some(item => item[0] === id) ? [id] : ["FEMALE"]),
        enabled: coerceBoolean(raw.enabled, true),
      });
    });
  if (!boxes.length)
    boxes = COHORTS.map(item => ({
      id: item[0],
      name: item[1],
      genders: [item[0]],
      enabled: enabledCohorts.indexOf(item[0]) !== -1,
    }));
  if (!boxes.some(box => box.enabled)) boxes[0].enabled = true;
  return boxes;
}
export function boxFor(settings: RankSettingsDraft, cohort: string) {
  return (
    (settings.genderBoxes || []).find(box => box.id === cohort) || {
      id: cohort,
      name: cohortLabel(cohort),
      genders: [cohort],
    }
  );
}
export function boxOptions(settings: RankSettingsDraft, enabledOnly?: boolean) {
  return settings.genderBoxes.filter(box => !enabledOnly || box.enabled).map(box => [box.id, box.name]);
}
export function boxGenders(settings: RankSettingsDraft, cohort: string) {
  return boxFor(settings, cohort).genders;
}
export function boxGendersLabel(settings: RankSettingsDraft, cohort: string) {
  return boxGenders(settings, cohort).map(cohortLabel).join(" + ");
}
export function categoryIncludes(
  performer: RankPerformer,
  _category: Partial<RankCategory>,
  cohort: string,
  settings: RankSettingsDraft,
) {
  return boxGenders(settings, cohort).indexOf(String(performer.gender || "").toUpperCase()) !== -1;
}
export function categoryById(settings: RankSettingsDraft, categoryId: string, cohort: string) {
  return categoriesFor(settings, cohort).find(category => category.id === categoryId);
}
export function categoriesForPerformer(settings: RankSettingsDraft, cohort: string, performer?: RankPerformer | null) {
  return categoriesFor(settings, cohort).filter(
    category => category.enabled && (!performer || categoryIncludes(performer, category, cohort, settings)),
  );
}
export function battleCohortFor(
  settings: RankSettingsDraft,
  performer: RankPerformer | null | undefined,
  requestedCohort: string,
) {
  const available = settings.enabledCohorts.filter(
    cohort => categoriesForPerformer(settings, cohort, performer).length > 0,
  );
  if (available.indexOf(requestedCohort) !== -1) return requestedCohort;
  if (available.indexOf(settings.defaultCohort) !== -1) return settings.defaultCohort;
  const preferred = performer ? String(performer.gender || "").toUpperCase() : settings.defaultCohort;
  return available.indexOf(preferred) !== -1 ? preferred : available[0] || "";
}
function parseCategoryList(value: unknown) {
  const inputs = Array.isArray(value) ? value : DEFAULT_CATEGORY_DEFINITIONS;
  const used = new Set(["overall"]);
  const categories: RankCategory[] = [];
  inputs.slice(0, 24).forEach(input => {
    const raw = asObject(input);
    if (!raw || typeof raw !== "object") return;
    const name = String(raw.name || "")
      .trim()
      .slice(0, 80);
    if (!name) return;
    const id = uniqueCategoryId(name, used);
    categories.push({
      id,
      name,
      description: String(raw.description || "")
        .trim()
        .slice(0, 500),
      enabled: coerceBoolean(raw.enabled, true),
      weight: number(raw.weight, 1, 0.01, 1000),
    });
  });
  return categories.length ? categories : DEFAULT_CATEGORY_DEFINITIONS.map(item => Object.assign({}, item));
}
function parseCategoriesByCohort(value: unknown, boxes?: RankGenderBox[]) {
  value = parseMaybeJson(value);
  const result: Record<string, RankCategory[]> = {};
  const source = asObject(value);
  COHORTS.forEach(cohort => {
    result[cohort[0]] = parseCategoryList(source[cohort[0]]);
  });
  Object.keys(source)
    .concat((boxes || []).map(box => box.id))
    .forEach(id => {
      if (!result[id]) result[id] = parseCategoryList(source[id]);
    });
  return result;
}
export function categoriesFor(settings: RankSettingsDraft, cohort: string) {
  return (settings.categoriesByCohort && settings.categoriesByCohort[cohort]) || [];
}
function categoryPreferences(): Record<string, string> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CATEGORY_PREFERENCE_STORAGE_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch (_error) {
    return {};
  }
}
export function rememberCategory(cohort: string, categoryId: string) {
  if (!cohort || !categoryId) return;
  try {
    const stored = categoryPreferences();
    stored[String(cohort).toUpperCase()] = String(categoryId);
    window.localStorage.setItem(CATEGORY_PREFERENCE_STORAGE_KEY, JSON.stringify(stored));
  } catch (_error) {
    // The in-memory selection still remains stable if browser storage is unavailable.
  }
}
export function preferredCategoryId(settings: RankSettingsDraft, cohort: string, fallback?: string) {
  const enabled = categoriesFor(settings, cohort).filter(category => category.enabled);
  const remembered = categoryPreferences()[String(cohort).toUpperCase()];
  if (enabled.some(category => category.id === remembered)) return remembered;
  if (enabled.some(category => category.id === fallback)) return fallback!;
  return enabled[0] ? enabled[0].id : "";
}
export function parseEnabledCohorts(value: unknown, fallback: string[]) {
  value = parseMaybeJson(value);
  const requested = new Set(
    Array.isArray(value)
      ? value.map(item =>
          String(item || "")
            .trim()
            .toUpperCase(),
        )
      : [],
  );
  const result = COHORTS.filter(item => requested.has(item[0])).map(item => item[0]);
  return result.length ? result : fallback.slice();
}
export function settingsFromConfiguration(configuration: unknown) {
  const source = asObject(configuration);
  // Mirrors the backend's _bounded/_bounded_integer helpers and their schema limits.
  const flag = (key: FlagKey) => coerceBoolean(source[key], defaults[key]);
  const bounded = (key: BoundedKey, minimum: number = limits[key].min, maximum: number = limits[key].max) =>
    number(source[key], defaults[key], minimum, maximum);
  const boundedInteger = (key: BoundedKey) => integer(source[key], defaults[key], limits[key].min, limits[key].max);
  const initialDeviation = bounded("initialDeviation");
  // Floor and provisional threshold are bounded by the other deviations, not only their static limits.
  const deviationFloor = bounded("deviationFloor", limits.deviationFloor.min, initialDeviation);
  let cohort = String(source.defaultCohort || defaults.defaultCohort).toUpperCase();
  const genderBoxes = parseGenderBoxes(source.genderBoxes, [cohort]);
  const enabledCohorts = genderBoxes.filter(box => box.enabled).map(box => box.id);
  if (enabledCohorts.indexOf(cohort) === -1) cohort = enabledCohorts[0];
  let confidenceGoal = String(source.confidenceGoal || defaults.confidenceGoal).toLowerCase();
  if (["all", "ranking", "top"].indexOf(confidenceGoal) === -1) confidenceGoal = defaults.confidenceGoal;
  return {
    categoriesByCohort: parseCategoriesByCohort(source.categories, genderBoxes),
    genderBoxes,
    defaultCohort: cohort,
    enabledCohorts,
    showBattlesInMenu: flag("showBattlesInMenu"),
    showLeaderboardsInMenu: flag("showLeaderboardsInMenu"),
    leaderboardTopCount: leaderboardTopCount(source.leaderboardTopCount),
    leaderboardPerformerCount: leaderboardPerformerCount(source.leaderboardPerformerCount, source.leaderboardTopCount),
    leaderboardView: source.leaderboardView === "table" ? "table" : defaults.leaderboardView,
    overallScoreStrategy: overallScoreStrategy(source.overallScoreStrategy).id,
    overallPower: bounded("overallPower"),
    showRatingsBeforeVote: flag("showRatingsBeforeVote"),
    hidePerformerImages: flag("hidePerformerImages"),
    hideBattleStandings: flag("hideBattleStandings"),
    autoPlayTopScenes: flag("autoPlayTopScenes"),
    includePerformersWithoutImages: flag("includePerformersWithoutImages"),
    confidenceGoal,
    confidenceTopN: boundedInteger("confidenceTopN"),
    avoidRepeatWindow: boundedInteger("avoidRepeatWindow"),
    calibrationPercent: boundedInteger("calibrationPercent"),
    initialRating: bounded("initialRating"),
    initialDeviation,
    initialVolatility: bounded("initialVolatility"),
    evidenceWeight: bounded("evidenceWeight"),
    tau: bounded("tau"),
    deviationFloor,
    provisionalDeviation: bounded("provisionalDeviation", deviationFloor, initialDeviation),
  };
}
export function serializedSettings(settings: RankSettingsDraft) {
  return {
    categories: JSON.stringify(
      Object.keys(settings.categoriesByCohort).reduce(
        (result, cohort) => {
          result[cohort] = settings.categoriesByCohort[cohort].map(category => {
            return {
              id: category.id,
              name: String(category.name || "").trim(),
              description: String(category.description || "").trim(),
              enabled: Boolean(category.enabled),
              weight: number(category.weight, 1, 0.01, 1000),
            };
          });
          return result;
        },
        {} as Record<string, RankCategory[]>,
      ),
    ),
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
export function validateSettings(settings: RankSettingsDraft) {
  if (!settings.enabledCohorts.length) return "Enable at least one gender box.";
  const boxNames = new Set();
  for (const box of settings.genderBoxes) {
    const boxName = String(box.name || "")
      .trim()
      .toLowerCase();
    if (!boxName) return "Every gender box needs a name.";
    if (boxNames.has(boxName)) return "Gender box names must be unique.";
    if (!box.genders.length) return "Choose at least one gender for each box.";
    boxNames.add(boxName);
  }
  for (const definition of OVERALL_SCORE_PARAMETERS) {
    const error = overallScoreParameterError(settings[definition.key], definition);
    if (error) return definition.label + ": " + error;
  }
  const performerCountError = leaderboardPerformerCountError(settings);
  if (performerCountError) return performerCountError;
  if (
    settings.confidenceGoal === "top" &&
    (!String(settings.confidenceTopN).trim() ||
      !Number.isInteger(Number(settings.confidenceTopN)) ||
      Number(settings.confidenceTopN) < limits.confidenceTopN.min ||
      Number(settings.confidenceTopN) > limits.confidenceTopN.max)
  ) {
    return (
      "Top performers to stabilize must be between " +
      limits.confidenceTopN.min +
      " and " +
      limits.confidenceTopN.max +
      "."
    );
  }
  for (const box of settings.genderBoxes) {
    const names = new Set();
    const cohortCategories = categoriesFor(settings, box.id);
    if (settings.enabledCohorts.indexOf(box.id) !== -1 && !cohortCategories.some(category => category.enabled)) {
      return boxFor(settings, box.id).name + " needs at least one enabled category.";
    }
    for (const category of cohortCategories) {
      const name = String(category.name || "").trim(),
        weight = Number(category.weight);
      if (!name) return "Every category needs a name.";
      if (names.has(name.toLowerCase())) return "Category names must be unique within each performer cohort.";
      if (!String(category.weight).trim() || !Number.isFinite(weight) || weight < 0.01 || weight > 1000) {
        return "Every category needs a weight between 0.01 and 1000.";
      }
      names.add(name.toLowerCase());
    }
  }
  return "";
}
export function comparableSettings(settings: RankSettingsDraft) {
  return JSON.stringify(serializedSettings(settings));
}
