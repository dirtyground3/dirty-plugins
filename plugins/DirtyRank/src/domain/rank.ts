import { OVERALL_LEADERBOARD_ID, PLUGIN_ID } from "../constants";
import {
  buildCategoryScoreIndex,
  buildCategoryScoreIndexAsync,
  categoryScoreAt,
  updateCategoryScoreIndex,
} from "./scores";
import type { CategoryScoreIndex } from "./scores";
import type {
  DisplayPool,
  LeaderboardProps,
  PerformerFilter,
  PerformerFilterModel,
  RankCategory,
  RankOperationResult,
  RankPerformer,
  RankPerformerState,
  RankRange,
  RankSettings,
  RankSettingsDraft,
  StandingEntry,
} from "../types";
import {
  cohortLabel,
  leaderboardPerformerCount,
  leaderboardPerformerCountError,
  leaderboardTopCount,
} from "./navigation";
import { integer, number } from "./numbers";
import {
  battleCohortFor,
  boxGenders,
  categoriesFor,
  categoriesForPerformer,
  categoryById,
  categoryIncludes,
  overallScoreStrategy,
  ratingStrengthStrategy,
  settingsFromConfiguration,
  slug,
} from "./settings";
import { DirtyPlugins } from "../runtime";
const TIERS = { provisional: "Provisional", refined: "Refined", excellent: "Excellent" };
function tier(id: keyof typeof TIERS) {
  return { id, label: TIERS[id] };
}
let overallSortSettings = settingsFromConfiguration({});
let overallSortRevision = 0,
  sortRequest = 0;
const overallSortListeners = new Set<(revision: number) => void>();
const ratingStateIndex = new Map<string, RankPerformerState>();
let overallReferencePerformers: Map<string, RankPerformer> | null = null;
interface CategoryScoreCache {
  categoryId: string;
  cohort: string;
  settings: RankSettings;
  genders: Set<string>;
  index: CategoryScoreIndex;
}
const overallCategoryScoreCache = new Map<string, CategoryScoreCache>();
const scorePreparations = new Map<string, { controller: AbortController; promise: Promise<void> }>();
const categoryLeaderboardRankCache = new Map<string, Map<string, number>>();
const confidencePoolRevisions = new Map<string, number>();
let confidenceGeneration = 0;
export function confidenceRevisionFor(categoryId: string, cohort: string) {
  return confidenceGeneration + ":" + (confidencePoolRevisions.get(keyFor(categoryId, cohort)) || 0);
}
export { loadPreferredMedia, scenePlaybackUrl, needsNativePreview, invalidatePerformerMedia } from "./media";
import { invalidatePerformerMedia } from "./media";
let performerGeneration = 0;
let performerCache: { performers: RankPerformer[]; cardData: boolean } | null = null;
let performerRequest: { promise: Promise<RankPerformer[]>; cardData: boolean; started: boolean } | null = null;
let ratingIndexRevision = 0;
let ratingSnapshotRevision = 0;
let ratingIndexPromise: Promise<RankOperationResult> | null = null;
export function refreshOverallSortSettings() {
  const request = ++sortRequest;
  return DirtyPlugins.getPluginSettings(PLUGIN_ID)
    .then(configuration => {
      if (request !== sortRequest) return;
      overallSortSettings = settingsFromConfiguration(configuration);
      notifyRatingListeners();
    })
    .catch(error => {
      console.error("DirtyRank could not refresh overall score sort settings", error);
    });
}
export function subscribeToOverallSortSettings(listener: (revision: number) => void) {
  overallSortListeners.add(listener);
  return () => {
    overallSortListeners.delete(listener);
  };
}
export function runOperation(args: Record<string, unknown>) {
  return DirtyPlugins.runPluginOperation<RankOperationResult>(PLUGIN_ID, args);
}
function notifyRatingListeners(changedPools?: Set<string>, changedPerformers?: Set<string>) {
  const prefixes = changedPools ? Array.from(changedPools, poolKey => poolKey + "|") : null;
  for (const [key, preparation] of scorePreparations) {
    if (!prefixes || prefixes.some(prefix => key.startsWith(prefix))) {
      preparation.controller.abort();
      scorePreparations.delete(key);
    }
  }
  if (changedPools) {
    for (const [cacheKey, cache] of overallCategoryScoreCache) {
      if (prefixes!.some(prefix => cacheKey.startsWith(prefix)))
        cache.index = updateCategoryScoreIndex(
          cache.index,
          Array.from(changedPerformers!, id => ({ id, rating: categoryScoreRating(id, cache) })),
        );
    }
    for (const cacheKey of categoryLeaderboardRankCache.keys()) {
      if (prefixes!.some(prefix => cacheKey.startsWith(prefix))) categoryLeaderboardRankCache.delete(cacheKey);
    }
  } else {
    confidenceGeneration += 1;
    confidencePoolRevisions.clear();
    overallCategoryScoreCache.clear();
    categoryLeaderboardRankCache.clear();
  }
  overallSortRevision += 1;
  overallSortListeners.forEach(listener => {
    listener(overallSortRevision);
  });
}
export function applyRatingIndex(payload: RankOperationResult) {
  const revision = Number(payload && payload.revision) || 0;
  // A vote can advance the index while a slower loadAll is in flight. Ignore a
  // stale response so it cannot erase the newer state or lower the revision.
  if (revision < ratingIndexRevision) return payload;
  const states = (payload.states || {}) as Record<string, RankPerformerState>;
  ratingStateIndex.clear();
  Object.keys(states).forEach(performerId => {
    ratingStateIndex.set(String(performerId), states[performerId]);
  });
  ratingIndexRevision = Math.max(ratingIndexRevision, revision);
  ratingSnapshotRevision = revision;
  notifyRatingListeners();
  return payload;
}
export function loadRatingIndex() {
  if (ratingIndexPromise) return ratingIndexPromise;
  ratingIndexPromise = runOperation({ mode: "loadAll" })
    .then(applyRatingIndex)
    .finally(() => {
      ratingIndexPromise = null;
    });
  return ratingIndexPromise;
}
export function loadNativePerformerCard() {
  return DirtyPlugins.native.loadComponent("PerformerCard").catch(() => null);
}
export function invalidateRankLibrary() {
  performerGeneration++;
  performerCache = null;
  performerRequest = null;
  invalidatePerformerMedia();
}
export function queryPerformers(withCardData = false, { refresh = true } = {}): Promise<RankPerformer[]> {
  if (performerRequest) {
    if (withCardData && !performerRequest.cardData) {
      if (performerRequest.started) return performerRequest.promise.then(() => queryPerformers(true));
      performerRequest.cardData = true;
    }
    return performerRequest.promise;
  }
  if (!refresh && performerCache && (!withCardData || performerCache.cardData))
    return Promise.resolve(performerCache.performers);
  if (refresh) invalidateRankLibrary();
  const generation = performerGeneration;
  const request = { cardData: withCardData, started: false, promise: null as unknown as Promise<RankPerformer[]> };
  request.promise = Promise.resolve()
    .then(async () => {
      request.started = true;
      const performers: RankPerformer[] = [];
      for (let page = 1; ; page++) {
        const data = await DirtyPlugins.graphql<{
          findPerformers?: {
            count: number;
            performers: RankPerformer[];
          };
        }>(
          "query DirtyRankPerformers($filter:FindFilterType){" +
            "findPerformers(filter:$filter){count performers{" +
            "id name gender image_path scene_count" +
            (request.cardData
              ? " disambiguation birthdate country favorite rating100 o_counter image_count gallery_count group_count performer_count alias_list tags{id name} stash_ids{endpoint stash_id}"
              : "") +
            "}}}",
          { filter: { page, per_page: 500, sort: "name", direction: "ASC" } },
        );
        const batch = data.findPerformers?.performers || [];
        performers.push(...batch);
        if (batch.length < 500 || performers.length >= data.findPerformers!.count) break;
      }
      if (generation === performerGeneration) {
        performerCache = { performers, cardData: request.cardData };
        setOverallReferencePerformers(performers);
      }
      return performers;
    })
    .finally(() => {
      if (performerRequest === request) performerRequest = null;
    });
  performerRequest = request;
  return request.promise;
}
export function setOverallReferencePerformers(performers: RankPerformer[]) {
  // Always supplied by the unfiltered query, never by a page or search result.
  overallReferencePerformers = new Map();
  performers.forEach(performer => {
    overallReferencePerformers!.set(String(performer.id), performer);
  });
  notifyRatingListeners();
}
export function loadNativePreviewPlayer() {
  return DirtyPlugins.native.loadComponent("ScenePlayer").catch(() => null);
}
export function parseState(performer: Pick<RankPerformer, "id"> | null) {
  const state = performer && ratingStateIndex.get(String(performer.id));
  if (!state || typeof state !== "object" || Array.isArray(state))
    return { version: 2, revision: ratingIndexRevision, pools: {} };
  return {
    version: 2,
    revision: Number(state.revision) || 0,
    pools: state.pools && typeof state.pools === "object" ? state.pools : {},
  };
}
function keyFor(categoryId: string, cohort: string) {
  return slug(categoryId) + "|" + String(cohort || "").toUpperCase();
}
export function poolFor(
  performer: Pick<RankPerformer, "id">,
  categoryId: string,
  cohort: string,
  settings: RankSettings,
) {
  const pool = parseState(performer).pools[keyFor(categoryId, cohort)];
  if (!pool || typeof pool !== "object") {
    return {
      rating: settings.initialRating,
      deviation: settings.initialDeviation,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
  }
  return {
    rating: number(pool.rating, settings.initialRating, -1000000, 1000000),
    deviation: number(pool.deviation, settings.initialDeviation, settings.deviationFloor, settings.initialDeviation),
    matches: integer(pool.matches, 0, 0, 2000000000),
    wins: integer(pool.wins, 0, 0, 2000000000),
    losses: integer(pool.losses, 0, 0, 2000000000),
    draws: integer(pool.draws, 0, 0, 2000000000),
    lastRatedAt: pool.lastRatedAt || null,
  };
}
export function excellentDeviationThreshold(settings: RankSettings) {
  return Math.max(settings.deviationFloor, settings.provisionalDeviation * 0.6);
}
export function precisionTier(pool: DisplayPool, settings: RankSettings) {
  if (!pool || pool.matches <= 0 || pool.deviation > settings.provisionalDeviation) return tier("provisional");
  return tier(pool.deviation <= excellentDeviationThreshold(settings) ? "excellent" : "refined");
}
/** Enabled, weighted categories that apply to this performer: the overall score's inputs. */
function scoredCategories(performer: RankPerformer, cohort: string, settings: RankSettings) {
  return categoriesFor(settings, cohort).filter(
    category =>
      category.enabled && Number(category.weight) > 0 && categoryIncludes(performer, category, cohort, settings),
  );
}
export function updatePerformerState(performer: RankPerformer, state: RankPerformerState) {
  updatePerformerStates([{ id: performer.id, state }]);
  return performer;
}
/** Publish the complete response after accepting each performer's latest state. */
export function updatePerformerStates(updates: Array<{ id: string; state: RankPerformerState }>) {
  const changedPools = new Set<string>();
  const changedPerformers = new Set<string>();
  for (const { id, state } of updates) {
    const performerId = String(id);
    const current = ratingStateIndex.get(performerId);
    const revision = Number(state.revision) || 0;
    // The full snapshot also covers performers with no pools. The global maximum
    // may belong to another performer and must not reject this performer's reply.
    if (revision <= (current ? Number(current.revision) || 0 : ratingSnapshotRevision)) continue;
    const previousPools = current?.pools || {};
    const nextPools = state.pools || {};
    for (const poolKey of new Set([...Object.keys(previousPools), ...Object.keys(nextPools)])) {
      const previous = previousPools[poolKey];
      const next = nextPools[poolKey];
      if (JSON.stringify(previous) !== JSON.stringify(next))
        confidencePoolRevisions.set(poolKey, (confidencePoolRevisions.get(poolKey) || 0) + 1);
      if (previous?.rating !== next?.rating || previous?.matches !== next?.matches) changedPools.add(poolKey);
    }
    ratingStateIndex.set(performerId, state);
    ratingIndexRevision = Math.max(ratingIndexRevision, revision);
    changedPerformers.add(performerId);
  }
  if (changedPerformers.size) notifyRatingListeners(changedPools, changedPerformers);
  return changedPerformers.size > 0;
}
export function categoryEligible(
  performer: RankPerformer,
  category: Partial<RankCategory> | null | undefined,
  settings: RankSettingsDraft,
  cohort: string,
) {
  if (!category || !categoryIncludes(performer, category, cohort, settings)) return false;
  if (!settings.includePerformersWithoutImages && !performer.image_path) return false;
  return Boolean(category && category.enabled);
}
export function pairToken(left: RankPerformer, right: RankPerformer) {
  return [String(left.id), String(right.id)].sort().join(":");
}
export function recentPairWindow(recentTokens: string[], windowSize: number) {
  // slice(-0) returns the whole history, so zero must disable the penalty.
  if (!(windowSize > 0)) return [];
  return recentTokens.slice(-windowSize);
}
export function rankPerformers(
  performers: RankPerformer[],
  categoryId: string,
  cohort: string,
  settings: RankSettings,
) {
  const category = categoryById(settings, categoryId, cohort) || {};
  return performers
    .filter(performer => {
      return (
        categoryIncludes(performer, category, cohort, settings) &&
        poolFor(performer, categoryId, cohort, settings).matches > 0
      );
    })
    .sort((left, right) => {
      return poolFor(right, categoryId, cohort, settings).rating - poolFor(left, categoryId, cohort, settings).rating;
    });
}
function categoryScoreRating(id: string, cache: Omit<CategoryScoreCache, "index">) {
  if (overallReferencePerformers) {
    const reference = overallReferencePerformers.get(id);
    if (!reference || !cache.genders.has(String(reference.gender || "").toUpperCase())) return null;
  }
  const pool = poolFor({ id }, cache.categoryId, cache.cohort, cache.settings);
  return pool.matches > 0 ? pool.rating : null;
}
function categoryScoreKey(categoryId: string, cohort: string, settings: RankSettings) {
  return keyFor(categoryId, cohort) + "|" + settings.initialRating + "|" + boxGenders(settings, cohort).join(",");
}
function categoryScoreContext(categoryId: string, cohort: string, settings: RankSettings) {
  return { categoryId, cohort, settings: { ...settings }, genders: new Set(boxGenders(settings, cohort)) };
}
function categoryScoreEntries(context: Omit<CategoryScoreCache, "index">) {
  const entries: { id: string; rating: number }[] = [];
  ratingStateIndex.forEach((_state, id) => {
    const rating = categoryScoreRating(id, context);
    if (rating !== null) entries.push({ id, rating });
  });
  return entries;
}
function scoreContexts(settings: RankSettings, cohorts: string[]) {
  return cohorts.flatMap(cohort =>
    categoriesFor(settings, cohort)
      .filter(category => category.enabled && Number(category.weight) > 0)
      .map(category => ({ key: categoryScoreKey(category.id, cohort, settings), categoryId: category.id, cohort })),
  );
}
export function overallScoresReady(settings: RankSettings, cohorts: string[]) {
  return scoreContexts(settings, cohorts).every(({ key }) => overallCategoryScoreCache.has(key));
}
/** Shared cache preparation survives route changes; mutations cancel only obsolete work. */
export async function prepareOverallScores(settings: RankSettings, cohorts: string[], signal?: AbortSignal) {
  while (!signal?.aborted) {
    const jobs = scoreContexts(settings, cohorts).map(({ key, categoryId, cohort }) => {
      if (overallCategoryScoreCache.has(key)) return Promise.resolve();
      const pending = scorePreparations.get(key);
      if (pending) return pending.promise;
      const context = categoryScoreContext(categoryId, cohort, settings);
      const controller = new AbortController();
      const job = { controller, promise: null as unknown as Promise<void> };
      scorePreparations.set(key, job);
      job.promise = buildCategoryScoreIndexAsync(categoryScoreEntries(context), controller.signal)
        .then(index => {
          if (scorePreparations.get(key) === job) overallCategoryScoreCache.set(key, { ...context, index });
        })
        .finally(() => {
          if (scorePreparations.get(key) === job) scorePreparations.delete(key);
        });
      return job.promise;
    });
    try {
      await Promise.all(jobs);
    } catch (error) {
      if ((error as Error).name !== "AbortError") throw error;
      // A newer accepted state or population invalidated an unfinished index.
      continue;
    }
    if (overallScoresReady(settings, cohorts)) return;
  }
}
function categoryScoreIndexFor(categoryId: string, cohort: string, settings: RankSettings) {
  const cacheKey = categoryScoreKey(categoryId, cohort, settings);
  if (!overallCategoryScoreCache.has(cacheKey)) {
    const pending = scorePreparations.get(cacheKey);
    pending?.controller.abort();
    scorePreparations.delete(cacheKey);
    const context = categoryScoreContext(categoryId, cohort, settings);
    overallCategoryScoreCache.set(cacheKey, {
      ...context,
      index: buildCategoryScoreIndex(categoryScoreEntries(context)),
    });
  }
  return overallCategoryScoreCache.get(cacheKey)!.index;
}
export function overallCategoryScoreFor(
  performer: RankPerformer,
  categoryId: string,
  cohort: string,
  settings: RankSettings,
) {
  // Missing categories and pools with no comparison evidence stay neutral.
  return (
    categoryScoreIndexFor(categoryId, cohort, settings).performers.get(String(performer.id))?.score || {
      rating: 50,
      position: 50,
      strength: 50,
    }
  );
}
/** Standard deviations above the category's average rating after subtracting `uncertainty` RDs. */
export function overallCategoryStrengthFor(
  performer: RankPerformer,
  categoryId: string,
  cohort: string,
  settings: RankSettings,
  uncertainty: number,
) {
  const index = categoryScoreIndexFor(categoryId, cohort, settings);
  // Unrated pools keep the initial rating and RD, so they sit near average before the penalty.
  const pool = poolFor(performer, categoryId, cohort, settings);
  const mean = index.performers.size ? index.mean : settings.initialRating;
  // A tied or empty population has no spread; the initial RD keeps scores on a comparable scale.
  const spread = index.spread > 0 ? index.spread : settings.initialDeviation;
  return (pool.rating - uncertainty * pool.deviation - mean) / spread;
}
/** The category value the selected overall strategy combines. */
function overallCategoryValue(performer: RankPerformer, categoryId: string, cohort: string, settings: RankSettings) {
  const uncertainty = overallScoreStrategy(settings.overallScoreStrategy).uncertainty;
  return uncertainty === null
    ? overallCategoryScoreFor(performer, categoryId, cohort, settings).rating
    : overallCategoryStrengthFor(performer, categoryId, cohort, settings, uncertainty);
}
/** The same category value if the performer's rating were `rating`, everyone else unchanged. */
function overallCategoryValueAt(
  performer: RankPerformer,
  categoryId: string,
  cohort: string,
  settings: RankSettings,
  rating: number,
) {
  const index = categoryScoreIndexFor(categoryId, cohort, settings);
  const uncertainty = overallScoreStrategy(settings.overallScoreStrategy).uncertainty;
  if (uncertainty === null) {
    const own = index.performers.get(String(performer.id));
    return categoryScoreAt(index, rating, own ? own.rating : null);
  }
  const pool = poolFor(performer, categoryId, cohort, settings);
  const mean = index.performers.size ? index.mean : settings.initialRating;
  const spread = index.spread > 0 ? index.spread : settings.initialDeviation;
  return (rating - uncertainty * pool.deviation - mean) / spread;
}
/** Weighted mean, or weighted power mean, of the category values. */
function combineOverall(values: number[], weights: number[], settings: RankSettings) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const power = number(settings.overallPower, 3, 1, 4);
  if (overallScoreStrategy(settings.overallScoreStrategy).id === "power" && power !== 1) {
    // Power mean combines the same non-negative category scores as Simple weighted.
    // Scaling before exponentiation keeps intermediates in the 0–1 range.
    const mean = values.reduce((sum, value, index) => sum + Math.pow(value / 100, power) * weights[index], 0);
    return 100 * Math.pow(mean / totalWeight, 1 / power);
  }
  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}
/** How far the overall score moves when each category rating moves by its deviation. */
export function overallScoreDeviation(performer: RankPerformer, cohort: string, settings: RankSettings) {
  const categories = scoredCategories(performer, cohort, settings);
  if (!categories.length) return 0;
  const weights = categories.map(category => Number(category.weight));
  const values = categories.map(category => overallCategoryValue(performer, category.id, cohort, settings));
  let variance = 0;
  categories.forEach((category, index) => {
    const pool = poolFor(performer, category.id, cohort, settings);
    const moved = (rating: number) => {
      const next = values.slice();
      next[index] = overallCategoryValueAt(performer, category.id, cohort, settings, rating);
      return combineOverall(next, weights, settings);
    };
    const half = (moved(pool.rating + pool.deviation) - moved(pool.rating - pool.deviation)) / 2;
    variance += half * half;
  });
  return Math.sqrt(variance);
}
/** Percentile strategies score 0–100 with one decimal; rating strengths are small signed values. */
export function overallScoreText(value: number, settings: RankSettings) {
  return ratingStrengthStrategy(settings.overallScoreStrategy) ? value.toFixed(2) : value.toFixed(1);
}
export function overallPoolFor(performer: RankPerformer, cohort: string, settings: RankSettings) {
  const categories = scoredCategories(performer, cohort, settings);
  const totalWeight = categories.reduce((sum, category) => sum + Number(category.weight), 0);
  if (!totalWeight) {
    return {
      rating: ratingStrengthStrategy(settings.overallScoreStrategy) ? 0 : 50,
      deviation: settings.initialDeviation,
      matches: 0,
      overallScore: true,
      ratedCategories: 0,
      totalCategories: 0,
    };
  }
  const totals = categories.reduce(
    (result, category) => {
      const pool = poolFor(performer, category.id, cohort, settings);
      const weight = Number(category.weight);
      result.deviation += pool.deviation * weight;
      result.matches += pool.matches;
      if (pool.matches > 0) result.ratedCategories += 1;
      return result;
    },
    { deviation: 0, matches: 0, ratedCategories: 0 },
  );
  return {
    rating: combineOverall(
      categories.map(category => overallCategoryValue(performer, category.id, cohort, settings)),
      categories.map(category => Number(category.weight)),
      settings,
    ),
    deviation: totals.deviation / totalWeight,
    matches: totals.matches,
    overallScore: true,
    ratedCategories: totals.ratedCategories,
    totalCategories: categories.length,
  };
}
export function rankOverallPerformers(performers: RankPerformer[], cohort: string, settings: RankSettings) {
  return performers
    .filter(performer => categoriesForPerformer(settings, cohort, performer).length > 0)
    .map(performer => ({ performer, pool: overallPoolFor(performer, cohort, settings) }))
    .filter(entry => entry.pool.matches > 0)
    .sort((left, right) => right.pool.rating - left.pool.rating)
    .map(entry => entry.performer);
}
export function leaderboardPoolFor(
  performer: RankPerformer,
  leaderboardId: string,
  cohort: string,
  settings: RankSettings,
) {
  if (leaderboardId !== OVERALL_LEADERBOARD_ID) {
    const categoryPool = poolFor(performer, leaderboardId, cohort, settings);
    const categoryPrecision = precisionTier(categoryPool, settings);
    return Object.assign({}, categoryPool, {
      precision: categoryPrecision,
      stable: categoryPrecision.id !== "provisional",
    });
  }
  // The overall precision is the weakest category precision.
  const pools = scoredCategories(performer, cohort, settings).map(category =>
    poolFor(performer, category.id, cohort, settings),
  );
  const tiers = pools.map(pool => precisionTier(pool, settings).id);
  const precision = tier(
    tiers.length > 0 && tiers.every(id => id === "excellent")
      ? "excellent"
      : tiers.length > 0 && tiers.every(id => id !== "provisional")
        ? "refined"
        : "provisional",
  );
  const total = (key: "wins" | "losses" | "draws") => pools.reduce((sum, pool) => sum + pool[key], 0);
  return Object.assign({}, overallPoolFor(performer, cohort, settings), {
    wins: total("wins"),
    losses: total("losses"),
    draws: total("draws"),
    precision,
    stable:
      pools.length > 0 && pools.every(pool => pool.matches > 0 && pool.deviation <= settings.provisionalDeviation),
  });
}
export function leaderboardData(
  performers: RankPerformer[],
  leaderboardId: string,
  cohort: string,
  settings: RankSettings,
) {
  const eligible = performers.filter(performer => {
    return (
      (leaderboardId === OVERALL_LEADERBOARD_ID
        ? categoriesForPerformer(settings, cohort, performer).length > 0
        : categoryIncludes(performer, categoryById(settings, leaderboardId, cohort) || {}, cohort, settings)) &&
      (settings.includePerformersWithoutImages || Boolean(performer.image_path))
    );
  });
  const ranked =
    leaderboardId === OVERALL_LEADERBOARD_ID
      ? rankOverallPerformers(eligible, cohort, settings)
      : rankPerformers(eligible, leaderboardId, cohort, settings);
  const pools = ranked.map(performer => leaderboardPoolFor(performer, leaderboardId, cohort, settings));
  const deviations = pools.map(pool => pool.deviation).sort((left, right) => left - right);
  const completedBattles = Math.floor(pools.reduce((sum, pool) => sum + pool.matches, 0) / 2);
  const drawBattles = pools.reduce((sum, pool) => sum + pool.draws, 0) / 2;
  return {
    eligible: eligible.length,
    ranked,
    stats: {
      completedBattles,
      coverage: eligible.length ? (ranked.length / eligible.length) * 100 : 0,
      drawRate: completedBattles ? (drawBattles / completedBattles) * 100 : 0,
      medianDeviation: deviations.length ? deviations[Math.floor(deviations.length / 2)] : settings.initialDeviation,
      rated: ranked.length,
      ratingSpread:
        ranked.length > 1
          ? leaderboardPoolFor(ranked[0], leaderboardId, cohort, settings).rating -
            leaderboardPoolFor(ranked[ranked.length - 1], leaderboardId, cohort, settings).rating
          : 0,
      stable: pools.filter(pool => pool.stable).length,
      excellent: pools.filter(pool => pool.precision.id === "excellent").length,
      refined: pools.filter(pool => pool.precision.id === "refined").length,
    },
  };
}
function overallSortData(performer: RankPerformer, settings: RankSettings) {
  const cohort = battleCohortFor(settings, performer, "");
  const pool = overallPoolFor(performer, cohort, settings);
  return { performer, rating: pool.rating, rated: pool.matches > 0 };
}
export function sortPerformersByOverall(performers: RankPerformer[], direction: string, settings: RankSettings) {
  const descending = String(direction || "ASC").toUpperCase() === "DESC";
  return performers
    .map(performer => overallSortData(performer, settings))
    .sort((left, right) => {
      if (left.rated !== right.rated) return left.rated ? -1 : 1;
      if (left.rated && right.rated && left.rating !== right.rating) {
        return descending ? right.rating - left.rating : left.rating - right.rating;
      }
      const nameOrder = String(left.performer.name || "").localeCompare(String(right.performer.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (nameOrder) return nameOrder;
      return String(left.performer.id).localeCompare(String(right.performer.id), undefined, { numeric: true });
    })
    .map(item => item.performer);
}
export function leaderboardFeaturedCount(props: Pick<LeaderboardProps, "topCount" | "featuredCount" | "settings">) {
  return leaderboardTopCount(props.topCount === undefined ? props.settings.leaderboardTopCount : props.topCount);
}
export function leaderboardPageSize(settings: RankSettings, topCount: number, featuredCount: number) {
  return leaderboardPerformerCount(settings.leaderboardPerformerCount, topCount) - featuredCount;
}
export function overallCategoryScoresTitle(
  performer: RankPerformer,
  leaderboardId: string,
  cohort: string,
  settings: RankSettings,
) {
  if (leaderboardId !== OVERALL_LEADERBOARD_ID) return undefined;
  const overall = overallPoolFor(performer, cohort, settings);
  return (
    "Overall: " +
    overallScoreText(overall.rating, settings) +
    " · " +
    overallScoreStrategy(settings.overallScoreStrategy).name +
    " · " +
    overall.ratedCategories +
    "/" +
    overall.totalCategories +
    " categories rated\n" +
    scoredCategories(performer, cohort, settings)
      .map(category => {
        const pool = poolFor(performer, category.id, cohort, settings);
        const rank = categoryLeaderboardRankFor(performer, category.id, cohort, settings);
        const score = overallCategoryValue(performer, category.id, cohort, settings);
        return (
          category.name +
          ": " +
          (pool.matches
            ? (rank ? "#" + rank.toLocaleString() : "Unranked") + " (" + Math.round(pool.rating).toLocaleString() + ")"
            : "Unrated") +
          " · score " +
          score.toFixed(2)
        );
      })
      .join("\n")
  );
}
export function performerCategoryRanks(performer: RankPerformer, settings: RankSettings) {
  return settings.enabledCohorts.flatMap(cohort =>
    categoriesForPerformer(settings, cohort, performer).flatMap(category => {
      if (poolFor(performer, category.id, cohort, settings).matches <= 0) return [];
      const rank = categoryLeaderboardRankFor(performer, category.id, cohort, settings);
      return rank ? [{ category, cohort, rank }] : [];
    }),
  );
}
function categoryLeaderboardRankFor(
  performer: RankPerformer,
  categoryId: string,
  cohort: string,
  settings: RankSettings,
) {
  if (!overallReferencePerformers) return null;
  const cacheKey =
    keyFor(categoryId, cohort) +
    "|" +
    settings.initialRating +
    "|" +
    settings.includePerformersWithoutImages +
    "|" +
    boxGenders(settings, cohort).join(",");
  if (!categoryLeaderboardRankCache.has(cacheKey)) {
    const eligible = Array.from(overallReferencePerformers.values()).filter(
      reference => settings.includePerformersWithoutImages || Boolean(reference.image_path),
    );
    const ranks = new Map();
    rankPerformers(eligible, categoryId, cohort, settings).forEach((reference, index) => {
      ranks.set(String(reference.id), index + 1);
    });
    categoryLeaderboardRankCache.set(cacheKey, ranks);
  }
  return categoryLeaderboardRankCache.get(cacheKey)!.get(String(performer.id)) || null;
}
export function leaderboardRatingText(pool: DisplayPool, settings: RankSettings) {
  const precision = pool.precision || precisionTier(pool, settings);
  const text = pool.overallScore ? overallScoreText(pool.rating, settings) : Math.round(pool.rating).toLocaleString();
  return text + (precision.id === "refined" || precision.id === "excellent" ? "" : "*");
}
// A rival is clearly ahead when it is at least this likely to be better.
const CLEARLY = 0.9;
/** Standard normal CDF (Abramowitz and Stegun 7.1.26, error below 1.5e-7). */
function normalCdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
/**
 * Likely positions for each entry of a ranked list, from pairwise comparisons: the best
 * rank counts only rivals clearly ahead, the worst also counts rivals too close to call.
 * The ranges agree with each other: if a leader could drop below a rival, that rival is
 * not clearly behind, so the leader is not clearly ahead of it and its best rank rises.
 */
export function rankRanges(points: Array<{ rating: number; deviation: number }>): RankRange[] {
  return points.map((point, index) => {
    let ahead = 0,
      behind = 0;
    points.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      const spread = Math.max(Math.sqrt(point.deviation * point.deviation + other.deviation * other.deviation), 1e-9);
      const better = normalCdf((other.rating - point.rating) / spread);
      if (better >= CLEARLY) ahead += 1;
      else if (better <= 1 - CLEARLY) behind += 1;
    });
    return { low: Math.min(index + 1, 1 + ahead), high: Math.max(index + 1, points.length - behind) };
  });
}
const leaderboardRangeCache = new WeakMap<RankPerformer[], Map<string, RankRange[]>>();
/** Likely positions for a leaderboard's ranked performers, cached per ranking. */
export function leaderboardRanges(
  ranked: RankPerformer[],
  leaderboardId: string,
  cohort: string,
  settings: RankSettings,
) {
  let cached = leaderboardRangeCache.get(ranked);
  if (!cached) leaderboardRangeCache.set(ranked, (cached = new Map()));
  const key = leaderboardId + "|" + cohort + "|" + JSON.stringify(settings);
  let ranges = cached.get(key);
  if (!ranges) {
    ranges = rankRanges(
      ranked.map(performer => {
        if (leaderboardId !== OVERALL_LEADERBOARD_ID) return poolFor(performer, leaderboardId, cohort, settings);
        return {
          rating: overallPoolFor(performer, cohort, settings).rating,
          deviation: overallScoreDeviation(performer, cohort, settings),
        };
      }),
    );
    cached.set(key, ranges);
  }
  return ranges;
}
export function leaderboardEntries(
  ranked: RankPerformer[],
  leaderboardId?: string,
  cohort?: string,
  settings?: RankSettings,
): StandingEntry[] {
  const ranges = settings && leaderboardId ? leaderboardRanges(ranked, leaderboardId, cohort || "", settings) : null;
  return ranked.map((performer, index) => ({ performer, rank: index + 1, range: ranges ? ranges[index] : undefined }));
}
export function filteredLeaderboardEntries(entries: StandingEntry[], performerIds: Set<string> | null) {
  if (!performerIds) return entries;
  return entries.filter(entry => performerIds.has(String(entry.performer.id)));
}
export function serializeLeaderboardPerformerFilter(filter: PerformerFilter | null) {
  const find = filter && typeof filter.makeFindFilter === "function" ? filter.makeFindFilter() : {};
  const object = filter && typeof filter.makeFilter === "function" ? filter.makeFilter() : {};
  const cleanFind = Object.assign({}, find || {});
  delete cleanFind.page;
  delete cleanFind.per_page;
  delete cleanFind.sort;
  delete cleanFind.direction;
  const count = filter && typeof filter.count === "function" ? Number(filter.count()) || 0 : 0;
  return {
    find: JSON.parse(JSON.stringify(cleanFind)),
    object: JSON.parse(JSON.stringify(object || {})),
    count: count + (cleanFind.q ? 1 : 0),
  };
}
export function queryLeaderboardPerformerIds(model: PerformerFilterModel, signal?: AbortSignal) {
  const ids = new Set<string>();
  let page = 1;
  function next(): Promise<Set<string>> {
    return DirtyPlugins.graphql<{
      findPerformers?: {
        count?: number;
        performers?: Array<{
          id: string;
        }>;
      };
    }>(
      "query DirtyRankFilteredPerformerIds($filter:FindFilterType!,$performerFilter:PerformerFilterType){" +
        "findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id}}}",
      {
        filter: Object.assign({}, model.find, { page, per_page: 500, sort: "id", direction: "ASC" }),
        performerFilter: model.object,
      },
      { signal },
    ).then(data => {
      const result = data.findPerformers;
      const performers = result?.performers || [];
      performers.forEach(performer => {
        ids.add(String(performer.id));
      });
      if (performers.length && page * 500 < Number(result?.count || 0)) {
        page += 1;
        return next();
      }
      return ids;
    });
  }
  return next();
}
export function leaderboardStandingEntries(props: LeaderboardProps) {
  if (props.entries) return props.entries;
  return leaderboardEntries(props.ranked, props.leaderboardId, props.cohort, props.settings).slice(
    leaderboardFeaturedCount(props),
  );
}
export function filteredLeaderboardPanelProps() {
  return {
    emptyMessage: "No rated performers match these filters.",
  };
}
export function paginatedLeaderboard(entries: StandingEntry[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.max(1, Math.min(totalPages, page));
  const start = (currentPage - 1) * pageSize;
  const lastIndex = Math.min(start + pageSize, entries.length) - 1;
  return {
    currentPage,
    firstRank: entries.length ? entries[start].rank : 0,
    items: entries.slice(start, start + pageSize),
    lastRank: entries.length ? entries[lastIndex].rank : 0,
    start,
    total: entries.length,
    totalPages,
  };
}

export function getOverallSortSettings() {
  return overallSortSettings;
}

export function getRatingIndexRevision() {
  return ratingIndexRevision;
}

export function getOverallSortRevision() {
  return overallSortRevision;
}
