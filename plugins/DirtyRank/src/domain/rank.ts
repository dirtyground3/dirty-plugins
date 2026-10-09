import { GLICKO_SCALE, OVERALL_LEADERBOARD_ID, PLUGIN_ID } from "../constants";
import type { Runtime } from "../runtime";
import type { DisplayPool, LeaderboardProps, PerformerFilter, PerformerFilterModel, PreviewMedia, RankCategory, RankOperationResult, RankPerformer, RankPerformerState, RankSettings, RankSettingsDraft, StandingEntry } from "../types";
import { createMatchmaker } from "./matchmaking";
import * as navigation from "./navigation";
import { expectedDeviationAfterBattle, pairInformationGain } from "./rating";
import { createSettings } from "./settings";
const TIERS = { provisional: "Provisional", refined: "Refined", excellent: "Excellent" };
function tier(id: keyof typeof TIERS) {
  return { id, label: TIERS[id] };
}
export function createRankDomain(runtime: Runtime) {
  const { DirtyPlugins } = runtime;
  const { cohortLabel, leaderboardTopCount, leaderboardPerformerCount, leaderboardPerformerCountError } = navigation;
  const settingsApi = createSettings({ DirtyPlugins, cohortLabel, leaderboardTopCount, leaderboardPerformerCount, leaderboardPerformerCountError });
  const { number, integer, slug, boxGenders, categoriesFor, categoryIncludes, categoryById, categoriesForPerformer, battleCohortFor, overallScoreStrategy, settingsFromConfiguration } = settingsApi;
  let overallSortSettings = settingsFromConfiguration({});
  let overallSortRevision = 0, sortRequest = 0;
  const overallSortListeners = new Set<(revision: number) => void>();
  const ratingStateIndex = new Map<string, RankPerformerState>();
  let overallReferencePerformers: Map<string, RankPerformer> | null = null;
  const overallCategoryScoreCache = new Map<string, Map<string, {
    rating: number;
    position: number;
    strength: number;
  }>>();
  const categoryLeaderboardRankCache = new Map<string, Map<string, number>>();
  const performerMediaCache = new Map<string, PreviewMedia>();
  let ratingIndexRevision = 0;
  let ratingIndexPromise: Promise<RankOperationResult> | null = null;
  function dispose() {
    sortRequest += 1;
    overallSortListeners.clear();
    ratingStateIndex.clear();
    overallReferencePerformers = null;
    overallCategoryScoreCache.clear();
    categoryLeaderboardRankCache.clear();
    performerMediaCache.clear();
  }
  function refreshOverallSortSettings() {
    const request = ++sortRequest;
    return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), loadRatingIndex(), queryPerformers()]).then(values => {
      if (request !== sortRequest || (runtime.isActive && !runtime.isActive())) return;
      overallSortSettings = settingsFromConfiguration(values[0]);
      notifyRatingListeners();
    }).catch(error => {
      console.error("DirtyRank could not refresh overall score sort settings", error);
    });
  }
  function subscribeToOverallSortSettings(listener: (revision: number) => void) {
    overallSortListeners.add(listener);
    return () => { overallSortListeners.delete(listener); };
  }
  function runOperation(args: Record<string, unknown>) {
    return DirtyPlugins.runPluginOperation<RankOperationResult>(PLUGIN_ID, args);
  }
  function notifyRatingListeners() {
    if (runtime.isActive && !runtime.isActive()) return;
    overallCategoryScoreCache.clear();
    categoryLeaderboardRankCache.clear();
    overallSortRevision += 1;
    overallSortListeners.forEach(listener => { listener(overallSortRevision); });
  }
  function applyRatingIndex(payload: RankOperationResult) {
    if (runtime.isActive && !runtime.isActive()) return payload;
    const revision = Number(payload && payload.revision) || 0;
    // A vote can advance the index while a slower loadAll is in flight. Ignore a
    // stale response so it cannot erase the newer state or lower the revision.
    if (revision < ratingIndexRevision)
      return payload;
    const states = (payload.states || {}) as Record<string, RankPerformerState>;
    ratingStateIndex.clear();
    Object.keys(states).forEach(performerId => {
      ratingStateIndex.set(String(performerId), states[performerId]);
    });
    ratingIndexRevision = Math.max(ratingIndexRevision, revision);
    notifyRatingListeners();
    return payload;
  }
  function loadRatingIndex() {
    if (ratingIndexPromise)
      return ratingIndexPromise;
    ratingIndexPromise = runOperation({ mode: "loadAll" })
      .then(applyRatingIndex)
      .finally(() => { ratingIndexPromise = null; });
    return ratingIndexPromise;
  }
  function loadNativePerformerCard() {
    return DirtyPlugins.native.loadComponent("PerformerCard").catch(() => null);
  }
  function queryPerformers(withCardData?: boolean) {
    return DirtyPlugins.graphql<{
      findPerformers?: {
        performers: RankPerformer[];
      };
    }>("query DirtyRankPerformers($filter:FindFilterType){" +
      "findPerformers(filter:$filter){count performers{" +
      "id name gender image_path scene_count" +
      (withCardData ? " disambiguation birthdate country favorite rating100 o_counter image_count gallery_count group_count performer_count alias_list tags{id name} stash_ids{endpoint stash_id}" : "") +
      "}}}", { filter: { per_page: -1, sort: "name", direction: "ASC" } }).then(data => {
        const performers = (data.findPerformers && data.findPerformers.performers) || [];
        setOverallReferencePerformers(performers);
        return performers;
      });
  }
  function setOverallReferencePerformers(performers: RankPerformer[]) {
    if (runtime.isActive && !runtime.isActive()) return;
    // Always supplied by the unfiltered query, never by a page or search result.
    overallReferencePerformers = new Map();
    performers.forEach(performer => {
      overallReferencePerformers!.set(String(performer.id), performer);
    });
    notifyRatingListeners();
  }
  function loadNativePreviewPlayer() {
    return DirtyPlugins.native.loadComponent("ScenePlayer").catch(() => null);
  }
  function loadPreferredMedia(performerId: string, fullScene: boolean, signal?: AbortSignal) {
    const cacheKey = String(performerId) + (fullScene ? ":scene" : ":preferred");
    if (performerMediaCache.has(cacheKey))
      return Promise.resolve(performerMediaCache.get(cacheKey));
    const request = DirtyPlugins.graphql<{
      top?: {
        scenes: PreviewMedia[];
      };
      markers?: {
        scene_markers: Array<{
          id: string;
          title: string;
          seconds: number;
          end_seconds?: number;
          scene: PreviewMedia;
        }>;
      };
    }>("query DirtyRankPreferredMedia($filter:FindFilterType,$sceneFilter:SceneFilterType,$markerFilter:SceneMarkerFilterType,$includeMarkers:Boolean!){" +
      "top:findScenes(filter:$filter,scene_filter:$sceneFilter){scenes{" +
      "id title rating100 paths{stream} sceneStreams{url mime_type label}" +
      "}}" +
      "markers:findSceneMarkers(filter:{per_page:-1},scene_marker_filter:$markerFilter) @include(if:$includeMarkers){scene_markers{" +
      "id title seconds end_seconds scene{id title rating100 paths{stream} sceneStreams{url mime_type label}}" +
      "}}}", {
      filter: { per_page: 1, sort: "rating", direction: "DESC" },
      sceneFilter: { performers: { value: [String(performerId)], modifier: "INCLUDES" } },
      markerFilter: { performers: { value: [String(performerId)], modifier: "INCLUDES" } },
      includeMarkers: !fullScene,
    }, { signal }).then(data => {
      const markers = data.markers && Array.isArray(data.markers.scene_markers)
        ? data.markers.scene_markers.slice()
        : [];
      // Best-rated scene first (unrated last), then the earliest marker in it.
      const sceneRating = (marker: typeof markers[number]) => {
        const rating = Number(marker.scene && marker.scene.rating100);
        return Number.isFinite(rating) ? rating : -1;
      };
      markers.sort((left, right) => sceneRating(right) - sceneRating(left) || Number(left.seconds || 0) - Number(right.seconds || 0));
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
    }).then(media => {
      // Pending requests belong to their card so cancellation cannot affect another preview.
      if (media && (!runtime.isActive || runtime.isActive()) && (!signal || !signal.aborted))
        performerMediaCache.set(cacheKey, media);
      return media;
    });
    return request;
  }
  function scenePlaybackUrl(scene: PreviewMedia | null | undefined) {
    const streams = scene && Array.isArray(scene.sceneStreams) ? scene.sceneStreams : [];
    const directPath = scene && scene.paths && scene.paths.stream;
    const preferred = streams.find(stream => stream.mime_type === "video/mp4" && /direct/i.test(stream.label || "")) || streams.find(stream => stream.mime_type === "video/mp4" && /720p/i.test(stream.label || "")) || streams.find(stream => stream.mime_type === "video/mp4");
    // Stash's original stream can be a format the browser cannot play (e.g. WMV).
    return preferred && preferred.url || directPath || "";
  }
  function needsNativePreview(scene: PreviewMedia | null | undefined) {
    return /\/stream\.(mp4|webm)(?:\?|$)/i.test(scenePlaybackUrl(scene));
  }
  function parseState(performer: Pick<RankPerformer, "id"> | null) {
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
  function poolFor(performer: Pick<RankPerformer, "id">, categoryId: string, cohort: string, settings: RankSettings) {
    const pool = parseState(performer).pools[keyFor(categoryId, cohort)];
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
  function excellentDeviationThreshold(settings: RankSettings) {
    return Math.max(settings.deviationFloor, settings.provisionalDeviation * 0.6);
  }
  function precisionTier(pool: DisplayPool, settings: RankSettings) {
    if (!pool || pool.matches <= 0 || pool.deviation > settings.provisionalDeviation) return tier("provisional");
    return tier(pool.deviation <= excellentDeviationThreshold(settings) ? "excellent" : "refined");
  }
  /** Enabled, weighted categories that apply to this performer: the overall score's inputs. */
  function scoredCategories(performer: RankPerformer, cohort: string, settings: RankSettings) {
    return categoriesFor(settings, cohort).filter(category => category.enabled && Number(category.weight) > 0 && categoryIncludes(performer, category, cohort, settings));
  }
  function updatePerformerState(performer: RankPerformer, state: RankPerformerState) {
    if (performer && state) {
      ratingStateIndex.set(String(performer.id), state);
      ratingIndexRevision = Math.max(ratingIndexRevision, Number(state.revision) || 0);
      notifyRatingListeners();
    }
    return performer;
  }
  function categoryEligible(performer: RankPerformer, category: Partial<RankCategory> | null | undefined, settings: RankSettingsDraft, cohort: string) {
    if (!category || !categoryIncludes(performer, category, cohort, settings))
      return false;
    if (!settings.includePerformersWithoutImages && !performer.image_path)
      return false;
    return Boolean(category && category.enabled);
  }
  function pairToken(left: RankPerformer, right: RankPerformer) {
    return [String(left.id), String(right.id)].sort().join(":");
  }
  function recentPairWindow(recentTokens: string[], windowSize: number) {
    // slice(-0) returns the whole history, so zero must disable the penalty.
    if (!(windowSize > 0))
      return [];
    return recentTokens.slice(-windowSize);
  }
  function rankPerformers(performers: RankPerformer[], categoryId: string, cohort: string, settings: RankSettings) {
    const category = categoryById(settings, categoryId, cohort) || {};
    return performers.filter(performer => {
      return categoryIncludes(performer, category, cohort, settings) &&
        poolFor(performer, categoryId, cohort, settings).matches > 0;
    }).sort((left, right) => {
      return poolFor(right, categoryId, cohort, settings).rating -
        poolFor(left, categoryId, cohort, settings).rating;
    });
  }
  function overallCategoryScoreFor(performer: RankPerformer, categoryId: string, cohort: string, settings: RankSettings) {
    const cacheKey = keyFor(categoryId, cohort) + "|" + settings.initialRating + "|" + boxGenders(settings, cohort).join(",");
    if (!overallCategoryScoreCache.has(cacheKey)) {
      const entries: {
        id: string;
        rating: number;
      }[] = [];
      ratingStateIndex.forEach((_state, performerId) => {
        if (overallReferencePerformers) {
          const reference = overallReferencePerformers.get(performerId);
          if (!reference || !categoryIncludes(reference, categoryById(settings, categoryId, cohort) || {}, cohort, settings))
            return;
        }
        const pool = poolFor({ id: performerId }, categoryId, cohort, settings);
        if (pool.matches > 0)
          entries.push({ id: performerId, rating: pool.rating });
      });
      entries.sort((left, right) => left.rating - right.rating);
      const groups: Array<{
        rating: number;
        ids: string[];
        below: number;
      }> = [];
      entries.forEach(entry => {
        let group = groups[groups.length - 1];
        if (!group || group.rating !== entry.rating) {
          group = { rating: entry.rating, ids: [], below: groups.length ? group.below + group.ids.length : 0 };
          groups.push(group);
        }
        group.ids.push(entry.id);
      });
      const scores = new Map();
      groups.forEach(group => {
        let position = 50;
        let strength = 50;
        if (entries.length > 1) {
          // Average ties, excluding the performer itself from both comparisons.
          position = 100 * (group.below + (group.ids.length - 1) / 2) / (entries.length - 1);
          const expected = groups.reduce((sum, opponent) => {
            // Rating-only logistic expected score (no RD penalty). Extreme gaps
            // saturate safely; draws count half. Grouping also avoids repeat work.
            return sum + opponent.ids.length / (1 + Math.exp((opponent.rating - group.rating) / GLICKO_SCALE));
          }, 0);
          strength = 100 * (expected - 0.5) / (entries.length - 1);
        }
        const value = { rating: 0.8 * position + 0.2 * strength, position, strength };
        group.ids.forEach(id => { scores.set(id, value); });
      });
      overallCategoryScoreCache.set(cacheKey, scores);
    }
    // Missing categories and pools with no comparison evidence stay neutral.
    return overallCategoryScoreCache.get(cacheKey)!.get(String(performer.id)) ||
      { rating: 50, position: 50, strength: 50 };
  }
  function overallPoolFor(performer: RankPerformer, cohort: string, settings: RankSettings) {
    const categories = scoredCategories(performer, cohort, settings);
    const totalWeight = categories.reduce((sum, category) => sum + Number(category.weight), 0);
    if (!totalWeight) {
      return { rating: 50, deviation: settings.initialDeviation, matches: 0, overallScore: true, ratedCategories: 0, totalCategories: 0 };
    }
    const strategy = overallScoreStrategy(settings.overallScoreStrategy).id;
    const power = number(settings.overallPower, 3, 1, 4);
    const totals = categories.reduce((result, category) => {
      const pool = poolFor(performer, category.id, cohort, settings);
      const weight = Number(category.weight);
      const score = overallCategoryScoreFor(performer, category.id, cohort, settings).rating;
      result.rating += score * weight;
      // Power mean combines the same non-negative category scores as Simple weighted.
      // Scaling before exponentiation keeps intermediates in the 0–1 range.
      if (strategy === "power")
        result.powerRating += Math.pow(score / 100, power) * weight;
      result.deviation += pool.deviation * weight;
      result.matches += pool.matches;
      if (pool.matches > 0)
        result.ratedCategories += 1;
      return result;
    }, { rating: 0, powerRating: 0, deviation: 0, matches: 0, ratedCategories: 0 });
    let rating = totals.rating / totalWeight;
    if (strategy === "power" && power !== 1) {
      rating = 100 * Math.pow(totals.powerRating / totalWeight, 1 / power);
    }
    return {
      rating, deviation: totals.deviation / totalWeight, matches: totals.matches,
      overallScore: true, ratedCategories: totals.ratedCategories, totalCategories: categories.length,
    };
  }
  function rankOverallPerformers(performers: RankPerformer[], cohort: string, settings: RankSettings) {
    return performers.filter(performer => {
      return categoriesForPerformer(settings, cohort, performer).length > 0 &&
        overallPoolFor(performer, cohort, settings).matches > 0;
    }).sort((left, right) => {
      return overallPoolFor(right, cohort, settings).rating -
        overallPoolFor(left, cohort, settings).rating;
    });
  }
  function leaderboardPoolFor(performer: RankPerformer, leaderboardId: string, cohort: string, settings: RankSettings) {
    if (leaderboardId !== OVERALL_LEADERBOARD_ID) {
      const categoryPool = poolFor(performer, leaderboardId, cohort, settings);
      const categoryPrecision = precisionTier(categoryPool, settings);
      return Object.assign({}, categoryPool, {
        precision: categoryPrecision,
        stable: categoryPrecision.id !== "provisional",
      });
    }
    // The overall precision is the weakest category precision.
    const pools = scoredCategories(performer, cohort, settings).map(category => poolFor(performer, category.id, cohort, settings));
    const tiers = pools.map(pool => precisionTier(pool, settings).id);
    const precision = tier(tiers.length > 0 && tiers.every(id => id === "excellent") ? "excellent"
      : tiers.length > 0 && tiers.every(id => id !== "provisional") ? "refined" : "provisional");
    const total = (key: "wins" | "losses" | "draws") => pools.reduce((sum, pool) => sum + pool[key], 0);
    return Object.assign({}, overallPoolFor(performer, cohort, settings), {
      wins: total("wins"), losses: total("losses"), draws: total("draws"), precision,
      stable: pools.length > 0 && pools.every(pool => pool.matches > 0 && pool.deviation <= settings.provisionalDeviation),
    });
  }
  function leaderboardData(performers: RankPerformer[], leaderboardId: string, cohort: string, settings: RankSettings) {
    const eligible = performers.filter(performer => {
      return (leaderboardId === OVERALL_LEADERBOARD_ID ? categoriesForPerformer(settings, cohort, performer).length > 0 :
        categoryIncludes(performer, categoryById(settings, leaderboardId, cohort) || {}, cohort, settings)) &&
        (settings.includePerformersWithoutImages || Boolean(performer.image_path));
    });
    const ranked = leaderboardId === OVERALL_LEADERBOARD_ID
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
        coverage: eligible.length ? ranked.length / eligible.length * 100 : 0,
        drawRate: completedBattles ? drawBattles / completedBattles * 100 : 0,
        medianDeviation: deviations.length ? deviations[Math.floor(deviations.length / 2)] : settings.initialDeviation,
        rated: ranked.length,
        ratingSpread: ranked.length > 1
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
  function sortPerformersByOverall(performers: RankPerformer[], direction: string, settings: RankSettings) {
    const descending = String(direction || "ASC").toUpperCase() === "DESC";
    return performers.map(performer => overallSortData(performer, settings)).sort((left, right) => {
      if (left.rated !== right.rated)
        return left.rated ? -1 : 1;
      if (left.rated && right.rated && left.rating !== right.rating) {
        return descending ? right.rating - left.rating : left.rating - right.rating;
      }
      const nameOrder = String(left.performer.name || "").localeCompare(String(right.performer.name || ""), undefined, { numeric: true, sensitivity: "base" });
      if (nameOrder)
        return nameOrder;
      return String(left.performer.id).localeCompare(String(right.performer.id), undefined, { numeric: true });
    }).map(item => item.performer);
  }
  function leaderboardFeaturedCount(props: Pick<LeaderboardProps, "topCount" | "featuredCount" | "settings">) {
    return leaderboardTopCount(props.topCount === undefined ? props.settings.leaderboardTopCount : props.topCount);
  }
  function leaderboardPageSize(settings: RankSettings, topCount: number, featuredCount: number) {
    return leaderboardPerformerCount(settings.leaderboardPerformerCount, topCount) - featuredCount;
  }
  function overallCategoryScoresTitle(performer: RankPerformer, leaderboardId: string, cohort: string, settings: RankSettings) {
    if (leaderboardId !== OVERALL_LEADERBOARD_ID)
      return undefined;
    const overall = overallPoolFor(performer, cohort, settings);
    return "Overall: " + overall.rating.toFixed(1) + " · " + overallScoreStrategy(settings.overallScoreStrategy).name +
      " · " + overall.ratedCategories + "/" + overall.totalCategories +
      " categories rated\n" + scoredCategories(performer, cohort, settings).map(category => {
        const pool = poolFor(performer, category.id, cohort, settings);
        const rank = categoryLeaderboardRankFor(performer, category.id, cohort, settings);
        const score = overallCategoryScoreFor(performer, category.id, cohort, settings);
        return category.name + ": " + (pool.matches
          ? (rank ? "#" + rank.toLocaleString() : "Unranked") + " (" + Math.round(pool.rating).toLocaleString() + ")"
          : "Unrated") + " · score " + score.rating.toFixed(2);
      }).join("\n");
  }
  function categoryLeaderboardRankFor(performer: RankPerformer, categoryId: string, cohort: string, settings: RankSettings) {
    if (!overallReferencePerformers)
      return null;
    const cacheKey = keyFor(categoryId, cohort) + "|" + settings.initialRating + "|" + settings.includePerformersWithoutImages + "|" + boxGenders(settings, cohort).join(",");
    if (!categoryLeaderboardRankCache.has(cacheKey)) {
      const eligible = Array.from(overallReferencePerformers.values()).filter(reference => settings.includePerformersWithoutImages || Boolean(reference.image_path));
      const ranks = new Map();
      rankPerformers(eligible, categoryId, cohort, settings).forEach((reference, index) => {
        ranks.set(String(reference.id), index + 1);
      });
      categoryLeaderboardRankCache.set(cacheKey, ranks);
    }
    return categoryLeaderboardRankCache.get(cacheKey)!.get(String(performer.id)) || null;
  }
  function leaderboardRatingText(pool: DisplayPool, settings: RankSettings) {
    const precision = pool.precision || precisionTier(pool, settings);
    const text = pool.overallScore ? pool.rating.toFixed(1) : Math.round(pool.rating).toLocaleString();
    return text + (precision.id === "refined" || precision.id === "excellent" ? "" : "*");
  }
  function leaderboardEntries(ranked: RankPerformer[]) {
    return ranked.map((performer, index) => ({ performer, rank: index + 1 }));
  }
  function filteredLeaderboardEntries(entries: StandingEntry[], performerIds: Set<string> | null) {
    if (!performerIds)
      return entries;
    return entries.filter(entry => performerIds.has(String(entry.performer.id)));
  }
  function serializeLeaderboardPerformerFilter(filter: PerformerFilter | null) {
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
  function queryLeaderboardPerformerIds(model: PerformerFilterModel, signal?: AbortSignal) {
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
      }>("query DirtyRankFilteredPerformerIds($filter:FindFilterType!,$performerFilter:PerformerFilterType){" +
        "findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id}}}", {
        filter: Object.assign({}, model.find, { page, per_page: 500, sort: "id", direction: "ASC" }),
        performerFilter: model.object,
      }, { signal }).then(data => {
        const result = data.findPerformers;
        const performers = result?.performers || [];
        performers.forEach(performer => { ids.add(String(performer.id)); });
        if (performers.length && page * 500 < Number(result?.count || 0)) {
          page += 1;
          return next();
        }
        return ids;
      });
    }
    return next();
  }
  function leaderboardStandingEntries(props: LeaderboardProps) {
    if (props.entries)
      return props.entries;
    return leaderboardEntries(props.ranked).slice(leaderboardFeaturedCount(props));
  }
  function filteredLeaderboardPanelProps() {
    return {
      emptyMessage: "No rated performers match these filters.",
    };
  }
  function paginatedLeaderboard(entries: StandingEntry[], page: number, pageSize: number) {
    const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
    const currentPage = Math.max(1, Math.min(totalPages, page));
    const start = (currentPage - 1) * pageSize;
    const lastIndex = Math.min(start + pageSize, entries.length) - 1;
    return {
      currentPage, firstRank: entries.length ? entries[start].rank : 0, items: entries.slice(start, start + pageSize),
      lastRank: entries.length ? entries[lastIndex].rank : 0, start, total: entries.length, totalPages,
    };
  }
  const matchmaker = createMatchmaker({ categoryEligible, poolFor, precisionTier, rankPerformers, settingsFromConfiguration, pairToken, recentPairWindow, expectedDeviationAfterBattle, pairInformationGain });
  return { dispose, ...navigation, ...settingsApi, ...matchmaker, expectedDeviationAfterBattle, pairInformationGain, refreshOverallSortSettings, subscribeToOverallSortSettings, runOperation, applyRatingIndex, loadRatingIndex, loadNativePerformerCard, queryPerformers, setOverallReferencePerformers, loadNativePreviewPlayer, loadPreferredMedia, scenePlaybackUrl, needsNativePreview, parseState, poolFor, excellentDeviationThreshold, precisionTier, updatePerformerState, categoryEligible, pairToken, recentPairWindow, rankPerformers, overallCategoryScoreFor, overallPoolFor, rankOverallPerformers, leaderboardPoolFor, leaderboardData, sortPerformersByOverall, leaderboardFeaturedCount, leaderboardPageSize, overallCategoryScoresTitle, leaderboardRatingText, leaderboardEntries, filteredLeaderboardEntries, serializeLeaderboardPerformerFilter, queryLeaderboardPerformerIds, leaderboardStandingEntries, filteredLeaderboardPanelProps, paginatedLeaderboard, getOverallSortSettings: () => overallSortSettings, getRatingIndexRevision: () => ratingIndexRevision, getOverallSortRevision: () => overallSortRevision };
}
export type RankDomain = ReturnType<typeof createRankDomain>;
