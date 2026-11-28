import { categoryEligible, confidenceRevisionFor, pairToken, poolFor, precisionTier, rankPerformers } from "./rank";
import { DEFAULT_THRESHOLDS, expectedDeviationAfterBattle, verdictInformation } from "./rating";
import { settingsFromConfiguration } from "./settings";
import { verdictFor } from "./verdicts";
import type { PoolVerdicts } from "./verdicts";
import type {
  RankCategory,
  RankConfidence,
  RankEntry,
  RankOpponentCandidate,
  RankPairCandidate,
  RankPairResult,
  RankPerformer,
  RankPool,
  RankSettings,
} from "../types";
const ORDER_CONFIDENCE_Z = 0.84,
  MATCHMAKER_FOCUS_LIMIT = 48,
  // Share of the less needy side's weighted gain that a pair also earns: the needier side
  // leads. In simulated 300-performer libraries a quarter ranked better than both in full.
  PARTNER_GAIN_SHARE = 0.25;
type CategorySummary = { key: string; entries: RankEntry[]; confidence?: RankConfidence };
// Library arrays are immutable snapshots. Weak ownership releases replaced populations.
const categorySummaries = new WeakMap<RankPerformer[], Map<string, CategorySummary>>();
function categorySummary(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings) {
  let summaries = categorySummaries.get(performers);
  if (!summaries) {
    summaries = new Map();
    categorySummaries.set(performers, summaries);
  }
  const scope = category.id + "|" + cohort;
  const key = confidenceRevisionFor(category.id, cohort) + "|" + JSON.stringify([category, settings]);
  let summary = summaries.get(scope);
  if (!summary || summary.key !== key) {
    summary = { key, entries: buildCategoryEntries(performers, category, cohort, settings) };
    summaries.set(scope, summary);
  }
  return summary;
}
export function representativeOpponent(pool: RankPool, opponentDeviation: number, settings: RankSettings) {
  return { rating: pool.rating, deviation: opponentDeviation, matches: 1 };
}
export function estimatedMatchesToConfidence(
  pool: RankPool,
  targetDeviation: number,
  opponent: RankPool,
  settings: RankSettings,
) {
  if (pool.matches > 0 && pool.deviation <= targetDeviation) return 0;
  let subject = Object.assign({}, pool);
  let counterpart = Object.assign({}, opponent || representativeOpponent(pool, settings.initialDeviation, settings));
  for (let matches = 1; matches <= 1000; matches += 1) {
    const nextSubjectDeviation = expectedDeviationAfterBattle(subject, counterpart, settings);
    const nextOpponentDeviation = expectedDeviationAfterBattle(counterpart, subject, settings);
    subject = Object.assign({}, subject, { deviation: nextSubjectDeviation, matches: subject.matches + 1 });
    counterpart = Object.assign({}, counterpart, {
      deviation: nextOpponentDeviation,
      matches: counterpart.matches + 1,
    });
    if (nextSubjectDeviation <= targetDeviation) return matches;
  }
  return 1000;
}
export function freshCategoryBattleEstimate(performerCount: number, settings: unknown) {
  // Compare presets on a fresh pool, not on ratings already earned in one
  // category. Informative, similarly rated opponents refine both participants.
  const effective = settingsFromConfiguration(settings);
  const count = Math.max(0, Math.floor(performerCount));
  if (count < 2) return { battles: 0, performers: count, capped: false };
  const initial = {
    rating: effective.initialRating,
    deviation: effective.initialDeviation,
    matches: 0,
  };
  const matches = estimatedMatchesToConfidence(initial, effective.provisionalDeviation, initial, effective);
  return { battles: Math.ceil((count * matches) / 2), performers: count, capped: matches === 1000 };
}
function confidenceGoalLabel(settings: RankSettings) {
  if (settings.confidenceGoal === "all") return "Every performer";
  if (settings.confidenceGoal === "top") return "Top " + settings.confidenceTopN;
  return "Leaderboard order";
}
export function confidenceProgress(completedBattles: number, remainingBattles: number) {
  const total = completedBattles + remainingBattles;
  return total > 0 ? (completedBattles / total) * 100 : 0;
}
export function categoryEntries(
  performers: RankPerformer[],
  category: RankCategory,
  cohort: string,
  settings: RankSettings,
) {
  return categorySummary(performers, category, cohort, settings).entries;
}
function buildCategoryEntries(
  performers: RankPerformer[],
  category: RankCategory,
  cohort: string,
  settings: RankSettings,
) {
  return performers
    .filter(performer => categoryEligible(performer, category, settings, cohort))
    .map(performer => ({ performer, pool: poolFor(performer, category.id, cohort, settings) }))
    .sort((left, right) => {
      if (right.pool.rating !== left.pool.rating) return right.pool.rating - left.pool.rating;
      if (left.pool.matches !== right.pool.matches) return right.pool.matches - left.pool.matches;
      return String(left.performer.name || "").localeCompare(String(right.performer.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
}
function orderBoundary(left: RankEntry, right: RankEntry, settings: RankSettings, kind: string) {
  const bothRated = left.pool.matches > 0 && right.pool.matches > 0;
  const gap = Math.max(0, left.pool.rating - right.pool.rating);
  const combinedDeviation = Math.sqrt(
    left.pool.deviation * left.pool.deviation + right.pool.deviation * right.pool.deviation,
  );
  const separation = combinedDeviation > 0 ? gap / combinedDeviation : ORDER_CONFIDENCE_Z;
  const probabilityProgress = bothRated ? Math.min(1, separation / ORDER_CONFIDENCE_Z) : 0;
  const refinedTie =
    bothRated &&
    separation < ORDER_CONFIDENCE_Z &&
    left.pool.deviation <= settings.provisionalDeviation &&
    right.pool.deviation <= settings.provisionalDeviation;
  const tieProgress =
    bothRated && separation < ORDER_CONFIDENCE_Z
      ? Math.min(1, settings.provisionalDeviation / Math.max(left.pool.deviation, right.pool.deviation))
      : 0;
  return {
    confident: bothRated && (separation >= ORDER_CONFIDENCE_Z || refinedTie),
    kind,
    left,
    progress: Math.max(probabilityProgress, tieProgress),
    right,
  };
}
function confidenceBoundaries(entries: RankEntry[], settings: RankSettings) {
  const boundaries: ReturnType<typeof orderBoundary>[] = [];
  if (settings.confidenceGoal === "all" || entries.length < 2) return boundaries;
  if (settings.confidenceGoal === "ranking") {
    for (let index = 0; index < entries.length - 1; index += 1) {
      boundaries.push(orderBoundary(entries[index], entries[index + 1], settings, "order"));
    }
    return boundaries;
  }
  const topCount = Math.min(settings.confidenceTopN, entries.length);
  for (let topIndex = 0; topIndex < topCount - 1; topIndex += 1) {
    boundaries.push(orderBoundary(entries[topIndex], entries[topIndex + 1], settings, "top-order"));
  }
  if (topCount < entries.length) {
    const cutoff = entries[topCount - 1];
    for (let outsideIndex = topCount; outsideIndex < entries.length; outsideIndex += 1) {
      boundaries.push(orderBoundary(cutoff, entries[outsideIndex], settings, "top-membership"));
    }
  }
  return boundaries;
}
export function categoryConfidence(
  performers: RankPerformer[],
  category: RankCategory,
  cohort: string,
  settings: RankSettings,
): RankConfidence {
  const cached = categorySummary(performers, category, cohort, settings);
  if (!cached.confidence) cached.confidence = buildCategoryConfidence(cached.entries, settings);
  return cached.confidence;
}
function buildCategoryConfidence(entries: RankEntry[], settings: RankSettings): RankConfidence {
  const activeWeights = new Map<string, number>();
  entries.forEach(entry => {
    activeWeights.set(String(entry.performer.id), 0.02);
  });
  const pools = entries.map(entry => entry.pool);
  type Goal = Pick<RankConfidence, "completedBattles" | "established" | "goalTotal" | "goalUnit" | "remainingBattles">;
  const summary = (goal: Goal): RankConfidence => ({
    activeWeights,
    entries,
    eligible: entries.length,
    goalLabel: confidenceGoalLabel(settings),
    rated: pools.filter(pool => pool.matches > 0).length,
    refined: pools.filter(pool => precisionTier(pool, settings).id !== "provisional").length,
    excellent: pools.filter(pool => precisionTier(pool, settings).id === "excellent").length,
    progress: confidenceProgress(goal.completedBattles, goal.remainingBattles),
    ...goal,
  });
  if (!entries.length)
    return summary({
      completedBattles: 0,
      established: 0,
      goalTotal: 0,
      goalUnit: "performers",
      remainingBattles: 0,
    });
  const deviations = pools.map(pool => pool.deviation).sort((left, right) => left - right);
  const opponentDeviation = deviations[Math.floor(deviations.length / 2)] || settings.initialDeviation;
  const completedBattles = Math.floor(pools.reduce((sum, pool) => sum + pool.matches, 0) / 2);
  if (settings.confidenceGoal === "all") {
    let established = 0;
    let remainingParticipations = 0;
    let maximumIndividualBattles = 0;
    entries.forEach(entry => {
      const pool = entry.pool;
      const stable = pool.matches > 0 && pool.deviation <= settings.provisionalDeviation;
      if (stable) established += 1;
      else {
        const uncertainty = Math.max(1, pool.deviation / settings.provisionalDeviation);
        activeWeights.set(
          String(entry.performer.id),
          pool.matches > 0 ? Math.min(12, 1 + uncertainty * uncertainty) : 8,
        );
      }
      const requiredBattles = estimatedMatchesToConfidence(
        pool,
        settings.provisionalDeviation,
        representativeOpponent(pool, opponentDeviation, settings),
        settings,
      );
      remainingParticipations += requiredBattles;
      maximumIndividualBattles = Math.max(maximumIndividualBattles, requiredBattles);
    });
    return summary({
      completedBattles,
      established,
      goalTotal: entries.length,
      goalUnit: "performers",
      remainingBattles: Math.max(Math.ceil(remainingParticipations / 2), maximumIndividualBattles),
    });
  }
  const boundaries = confidenceBoundaries(entries, settings);
  const needs = new Map<string, number>();
  function addWeight(entry: RankEntry, amount: number) {
    const id = String(entry.performer.id);
    activeWeights.set(id, Math.min(12, (activeWeights.get(id) || 0) + amount));
  }
  function requireMatches(entry: RankEntry, opponent: RankEntry | null) {
    const id = String(entry.performer.id);
    const required = estimatedMatchesToConfidence(
      entry.pool,
      settings.provisionalDeviation,
      opponent ? opponent.pool : representativeOpponent(entry.pool, opponentDeviation, settings),
      settings,
    );
    needs.set(id, Math.max(needs.get(id) || 0, Math.max(1, required)));
  }
  entries.forEach(entry => {
    if (entry.pool.matches === 0) {
      addWeight(entry, 8);
      requireMatches(entry, null);
    }
  });
  boundaries.forEach(boundary => {
    if (boundary.confident) return;
    const priority = 1 + (1 - boundary.progress) * 4;
    addWeight(boundary.left, priority);
    addWeight(boundary.right, priority);
    requireMatches(boundary.left, boundary.right);
    requireMatches(boundary.right, boundary.left);
  });
  return summary({
    completedBattles,
    established: boundaries.filter(boundary => boundary.confident).length,
    goalTotal: boundaries.length,
    goalUnit: settings.confidenceGoal === "top" ? "top-list boundaries" : "order/tie boundaries",
    remainingBattles: Math.ceil(Array.from(needs.values()).reduce((sum, value) => sum + value, 0) / 2),
  });
}
/** Leaderboard positions (1-based) by performer ID. */
function rankIndex(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings) {
  const ranks: Record<string, number> = {};
  rankPerformers(performers, category.id, cohort, settings).forEach((performer, index) => {
    ranks[performer.id] = index + 1;
  });
  return ranks;
}
/** A tiny jitter so equally informative pairs do not always come in the same order. */
function jittered(score: number) {
  return score * (0.995 + Math.random() * 0.01);
}
/**
 * The pair whose verdict adds the most expected information to the standings the
 * confidence goal cares about. Judged pairs compete too: their answer replaces the saved
 * verdict, so they only win when the saved verdict looks like a slip.
 */
export function selectPair(
  performers: RankPerformer[],
  category: RankCategory,
  cohort: string,
  settings: RankSettings,
  verdicts: PoolVerdicts | null,
  excluded: Set<string> = new Set(),
): RankPairResult {
  const confidence = categoryConfidence(performers, category, cohort, settings);
  const eligible = confidence.entries.map(entry => entry.performer);
  if (eligible.length < 2) return { pair: null, eligible: eligible.length, ranks: {} };
  const ranks = rankIndex(eligible, category, cohort, settings);
  const thresholds = verdicts ? verdicts.thresholds : DEFAULT_THRESHOLDS;
  const weight = (entry: RankEntry) => confidence.activeWeights.get(String(entry.performer.id)) || 0;
  const byId = new Map(confidence.entries.map(entry => [String(entry.performer.id), entry]));
  const focus = confidence.entries
    .slice()
    .sort((left, right) => weight(right) - weight(left) || right.pool.deviation - left.pool.deviation)
    .slice(0, MATCHMAKER_FOCUS_LIMIT);
  const evaluated = new Set<string>();
  let best: RankPairCandidate | null = null;
  function consider(leftEntry: RankEntry, rightEntry: RankEntry) {
    if (leftEntry.performer.id === rightEntry.performer.id) return;
    const token = pairToken(leftEntry.performer, rightEntry.performer);
    if (evaluated.has(token) || excluded.has(token)) return;
    evaluated.add(token);
    const saved = verdictFor(verdicts, leftEntry.performer.id, rightEntry.performer.id);
    const information = verdictInformation(leftEntry.pool, rightEntry.pool, settings, thresholds, saved);
    const leftValue = information.leftGain * (0.25 + weight(leftEntry));
    const rightValue = information.rightGain * (0.25 + weight(rightEntry));
    let score = Math.max(leftValue, rightValue) + Math.min(leftValue, rightValue) * PARTNER_GAIN_SHARE;
    // Without rated opponents, still give everyone a first verdict before anyone a second.
    if (leftEntry.pool.matches === 0 && rightEntry.pool.matches === 0) score *= 1.12;
    score = jittered(score);
    if (!best || score > best.score)
      best = { information, left: leftEntry.performer, right: rightEntry.performer, score, saved };
  }
  for (const leftEntry of focus) {
    for (const rightEntry of confidence.entries) consider(leftEntry, rightEntry);
  }
  // A slip between two settled performers can matter as much as a new pair.
  if (verdicts) {
    for (const key of verdicts.byPair.keys()) {
      const [lowId, highId] = key.split(":");
      const low = byId.get(lowId),
        high = byId.get(highId);
      if (low && high) consider(low, high);
    }
  }
  if (!best) return { pair: null, eligible: eligible.length, ranks };
  const chosen: RankPairCandidate = best;
  const swap = Math.random() < 0.5;
  return {
    eligible: eligible.length,
    expectedInformation: chosen.information.leftGain + chosen.information.rightGain,
    goalLabel: confidence.goalLabel,
    pair: swap ? [chosen.right, chosen.left] : [chosen.left, chosen.right],
    ranks,
    saved: chosen.saved ? (swap ? { ...chosen.saved, score: -chosen.saved.score } : chosen.saved) : null,
  };
}
/**
 * Orient the next pair so a performer who stays from the previous battle keeps their
 * side. The saved verdict, scored from the left, follows the swap.
 */
export function keepSides(previous: RankPerformer[] | null | undefined, next: RankPairResult): RankPairResult {
  if (!previous || previous.length !== 2 || !next.pair) return next;
  const [left, right] = next.pair.map(performer => String(performer.id));
  const [wasLeft, wasRight] = previous.map(performer => String(performer.id));
  if (left === wasLeft || right === wasRight || (right !== wasLeft && left !== wasRight)) return next;
  return Object.assign({}, next, {
    pair: [next.pair[1], next.pair[0]],
    saved: next.saved ? { score: -next.saved.score, confirmations: next.saved.confirmations } : next.saved,
  });
}
/**
 * The opponent whose verdict tells the most about the target performer's rating. Only the
 * target keeps battling, so an uncertain opponent counts for less.
 */
export function selectGauntletPair(
  performers: RankPerformer[],
  target: RankPerformer,
  category: RankCategory,
  cohort: string,
  settings: RankSettings,
  verdicts: PoolVerdicts | null,
  excluded: Set<string> = new Set(),
): RankPairResult {
  const eligible = performers.filter(performer => categoryEligible(performer, category, settings, cohort));
  const targetEntry = eligible.find(performer => String(performer.id) === String(target.id));
  const ranks = rankIndex(eligible, category, cohort, settings);
  if (!targetEntry || eligible.length < 2) return { pair: null, eligible: eligible.length, ranks };
  const thresholds = verdicts ? verdicts.thresholds : DEFAULT_THRESHOLDS;
  const targetPool = poolFor(targetEntry, category.id, cohort, settings);
  let best: RankOpponentCandidate | null = null;
  for (const opponent of eligible) {
    if (String(opponent.id) === String(targetEntry.id) || excluded.has(pairToken(targetEntry, opponent))) continue;
    const opponentPool = poolFor(opponent, category.id, cohort, settings);
    const saved = verdictFor(verdicts, targetEntry.id, opponent.id);
    const information = verdictInformation(targetPool, opponentPool, settings, thresholds, saved, true);
    const score = jittered(information.leftGain + information.rightGain * 0.08);
    if (!best || score > best.score) best = { information, opponent, score, saved };
  }
  const chosen = best as RankOpponentCandidate | null;
  return {
    eligible: eligible.length,
    expectedInformation: chosen ? chosen.information.leftGain : 0,
    goalLabel: "Target performer",
    pair: chosen ? [targetEntry, chosen.opponent] : null,
    ranks,
    saved: chosen ? chosen.saved : null,
  };
}
