import type { RankCategory, RankConfidence, RankEntry, RankMatchmakerDependencies, RankOpponentCandidate, RankPairCandidate, RankPairResult, RankPerformer, RankPool, RankSettings } from "../types";
export function createMatchmaker(dependencies: RankMatchmakerDependencies) {
  const {
    categoryEligible, poolFor, precisionTier, rankPerformers, settingsFromConfiguration, pairToken, recentPairWindow,
    expectedDeviationAfterBattle, pairInformationGain,
  } = dependencies;
  const ORDER_CONFIDENCE_Z = 0.84, MATCHMAKER_FOCUS_LIMIT = 48;
  function representativeOpponent(pool: RankPool, opponentDeviation: number, settings: RankSettings) {
    return { rating: pool.rating, deviation: opponentDeviation, volatility: settings.initialVolatility, matches: 1 };
  }
  function estimatedMatchesToConfidence(pool: RankPool, targetDeviation: number, opponent: RankPool, settings: RankSettings) {
    if (pool.matches > 0 && pool.deviation <= targetDeviation)
      return 0;
    let subject = Object.assign({}, pool);
    let counterpart = Object.assign({}, opponent || representativeOpponent(pool, settings.initialDeviation, settings));
    for (let matches = 1; matches <= 1000; matches += 1) {
      const nextSubjectDeviation = expectedDeviationAfterBattle(subject, counterpart, settings);
      const nextOpponentDeviation = expectedDeviationAfterBattle(counterpart, subject, settings);
      subject = Object.assign({}, subject, { deviation: nextSubjectDeviation, matches: subject.matches + 1 });
      counterpart = Object.assign({}, counterpart, { deviation: nextOpponentDeviation, matches: counterpart.matches + 1 });
      if (nextSubjectDeviation <= targetDeviation)
        return matches;
    }
    return 1000;
  }
  function freshCategoryBattleEstimate(performerCount: number, settings: unknown) {
    // Compare presets on a fresh pool, not on ratings already earned in one
    // category. Informative, similarly rated opponents refine both participants.
    const effective = settingsFromConfiguration(settings);
    const count = Math.max(0, Math.floor(performerCount));
    if (count < 2)
      return { battles: 0, performers: count, capped: false };
    const initial = {
      rating: effective.initialRating, deviation: effective.initialDeviation,
      volatility: effective.initialVolatility, matches: 0,
    };
    const matches = estimatedMatchesToConfidence(initial, effective.provisionalDeviation, initial, effective);
    return { battles: Math.ceil(count * matches / 2), performers: count, capped: matches === 1000 };
  }
  function confidenceGoalLabel(settings: RankSettings) {
    if (settings.confidenceGoal === "all")
      return "Every performer";
    if (settings.confidenceGoal === "top")
      return "Top " + settings.confidenceTopN;
    return "Leaderboard order";
  }
  function confidenceProgress(completedBattles: number, remainingBattles: number) {
    const total = completedBattles + remainingBattles;
    return total > 0 ? completedBattles / total * 100 : 0;
  }
  function categoryEntries(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings) {
    return performers.filter(performer => categoryEligible(performer, category, settings, cohort))
      .map(performer => ({ performer, pool: poolFor(performer, category.id, cohort, settings) }))
      .sort((left, right) => {
        if (right.pool.rating !== left.pool.rating)
          return right.pool.rating - left.pool.rating;
        if (left.pool.matches !== right.pool.matches)
          return right.pool.matches - left.pool.matches;
        return String(left.performer.name || "").localeCompare(String(right.performer.name || ""), undefined, { numeric: true, sensitivity: "base" });
      });
  }
  function orderBoundary(left: RankEntry, right: RankEntry, settings: RankSettings, kind: string) {
    const bothRated = left.pool.matches > 0 && right.pool.matches > 0;
    const gap = Math.max(0, left.pool.rating - right.pool.rating);
    const combinedDeviation = Math.sqrt(left.pool.deviation * left.pool.deviation + right.pool.deviation * right.pool.deviation);
    const separation = combinedDeviation > 0 ? gap / combinedDeviation : ORDER_CONFIDENCE_Z;
    const probabilityProgress = bothRated ? Math.min(1, separation / ORDER_CONFIDENCE_Z) : 0;
    const refinedTie = bothRated && separation < ORDER_CONFIDENCE_Z &&
      left.pool.deviation <= settings.provisionalDeviation &&
      right.pool.deviation <= settings.provisionalDeviation;
    const tieProgress = bothRated && separation < ORDER_CONFIDENCE_Z
      ? Math.min(1, settings.provisionalDeviation / Math.max(left.pool.deviation, right.pool.deviation))
      : 0;
    return {
      confident: bothRated && (separation >= ORDER_CONFIDENCE_Z || refinedTie),
      kind, left, progress: Math.max(probabilityProgress, tieProgress), right,
    };
  }
  function confidenceBoundaries(entries: RankEntry[], settings: RankSettings) {
    const boundaries: ReturnType<typeof orderBoundary>[] = [];
    if (settings.confidenceGoal === "all" || entries.length < 2)
      return boundaries;
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
  function categoryConfidence(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings): RankConfidence {
    const entries = categoryEntries(performers, category, cohort, settings);
    const activeWeights = new Map<string, number>();
    entries.forEach(entry => { activeWeights.set(String(entry.performer.id), 0.02); });
    const pools = entries.map(entry => entry.pool);
    type Goal = Pick<RankConfidence, "completedBattles" | "established" | "goalTotal" | "goalUnit" | "remainingBattles">;
    const summary = (goal: Goal): RankConfidence => ({
      activeWeights, entries, eligible: entries.length, goalLabel: confidenceGoalLabel(settings),
      rated: pools.filter(pool => pool.matches > 0).length,
      refined: pools.filter(pool => precisionTier(pool, settings).id !== "provisional").length,
      excellent: pools.filter(pool => precisionTier(pool, settings).id === "excellent").length,
      progress: confidenceProgress(goal.completedBattles, goal.remainingBattles), ...goal,
    });
    if (!entries.length) return summary({ completedBattles: 0, established: 0, goalTotal: 0, goalUnit: "performers", remainingBattles: 0 });
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
        if (stable)
          established += 1;
        else {
          const uncertainty = Math.max(1, pool.deviation / settings.provisionalDeviation);
          activeWeights.set(String(entry.performer.id), pool.matches > 0 ? Math.min(12, 1 + uncertainty * uncertainty) : 8);
        }
        const requiredBattles = estimatedMatchesToConfidence(pool, settings.provisionalDeviation, representativeOpponent(pool, opponentDeviation, settings), settings);
        remainingParticipations += requiredBattles;
        maximumIndividualBattles = Math.max(maximumIndividualBattles, requiredBattles);
      });
      return summary({
        completedBattles, established, goalTotal: entries.length, goalUnit: "performers",
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
      const required = estimatedMatchesToConfidence(entry.pool, settings.provisionalDeviation, opponent ? opponent.pool : representativeOpponent(entry.pool, opponentDeviation, settings), settings);
      needs.set(id, Math.max(needs.get(id) || 0, Math.max(1, required)));
    }
    entries.forEach(entry => {
      if (entry.pool.matches === 0) {
        addWeight(entry, 8);
        requireMatches(entry, null);
      }
    });
    boundaries.forEach(boundary => {
      if (boundary.confident)
        return;
      const priority = 1 + (1 - boundary.progress) * 4;
      addWeight(boundary.left, priority);
      addWeight(boundary.right, priority);
      requireMatches(boundary.left, boundary.right);
      requireMatches(boundary.right, boundary.left);
    });
    return summary({
      completedBattles, established: boundaries.filter(boundary => boundary.confident).length, goalTotal: boundaries.length,
      goalUnit: settings.confidenceGoal === "top" ? "top-list boundaries" : "order/tie boundaries",
      remainingBattles: Math.ceil(Array.from(needs.values()).reduce((sum, value) => sum + value, 0) / 2),
    });
  }
  /** Leaderboard positions (1-based) by performer ID. */
  function rankIndex(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings) {
    const ranks: Record<string, number> = {};
    rankPerformers(performers, category.id, cohort, settings).forEach((performer, index) => { ranks[performer.id] = index + 1; });
    return ranks;
  }
  /** Penalize recent repeats, widen calibration gaps, then add a small tie-breaking jitter. */
  function finishScore(score: number, repeated: boolean, calibration: boolean, ratingDistance: number, settings: RankSettings) {
    if (repeated)
      score *= 0.04;
    if (calibration)
      score *= 0.8 + Math.min(0.35, ratingDistance / Math.max(1, settings.initialDeviation * 4));
    return score * (0.995 + Math.random() * 0.01);
  }
  function selectPair(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings, recentTokens: string[]): RankPairResult {
    const confidence = categoryConfidence(performers, category, cohort, settings);
    const eligible = confidence.entries.map(entry => entry.performer);
    if (eligible.length < 2)
      return { pair: null, eligible: eligible.length, ranks: {} };
    const ranks = rankIndex(eligible, category, cohort, settings);
    const weight = (entry: RankEntry) => confidence.activeWeights.get(String(entry.performer.id)) || 0;
    const focus = confidence.entries.slice()
      .sort((left, right) => weight(right) - weight(left) || right.pool.deviation - left.pool.deviation)
      .slice(0, MATCHMAKER_FOCUS_LIMIT);
    const recent = new Set(recentPairWindow(recentTokens, settings.avoidRepeatWindow));
    const calibration = Math.random() * 100 < settings.calibrationPercent;
    const evaluated = new Set();
    let best: RankPairCandidate | null = null;
    for (const leftEntry of focus) {
      for (const rightEntry of confidence.entries) {
        if (leftEntry.performer.id === rightEntry.performer.id)
          continue;
        const token = pairToken(leftEntry.performer, rightEntry.performer);
        if (evaluated.has(token))
          continue;
        evaluated.add(token);
        const information = pairInformationGain(leftEntry.pool, rightEntry.pool, settings);
        let score = information.leftGain * (0.25 + weight(leftEntry)) + information.rightGain * (0.25 + weight(rightEntry));
        if (leftEntry.pool.matches === 0 && rightEntry.pool.matches === 0)
          score *= 1.12;
        score = finishScore(score, recent.has(token), calibration, Math.abs(leftEntry.pool.rating - rightEntry.pool.rating), settings);
        if (!best || score > best.score)
          best = { information, left: leftEntry.performer, right: rightEntry.performer, score };
      }
    }
    if (!best)
      return { pair: null, eligible: eligible.length, ranks };
    return {
      calibration, eligible: eligible.length, expectedRdReduction: best.information.rdReduction, goalLabel: confidence.goalLabel,
      pair: Math.random() < 0.5 ? [best.left, best.right] : [best.right, best.left], ranks,
    };
  }
  function selectGauntletPair(performers: RankPerformer[], target: RankPerformer, category: RankCategory, cohort: string, settings: RankSettings, recentTokens: string[]): RankPairResult {
    const eligible = performers.filter(performer => categoryEligible(performer, category, settings, cohort));
    const targetEntry = eligible.find(performer => String(performer.id) === String(target.id));
    const ranks = rankIndex(eligible, category, cohort, settings);
    if (!targetEntry || eligible.length < 2)
      return { pair: null, eligible: eligible.length, ranks };
    const targetPool = poolFor(targetEntry, category.id, cohort, settings);
    const recent = new Set(recentPairWindow(recentTokens, settings.avoidRepeatWindow));
    const calibration = Math.random() * 100 < settings.calibrationPercent;
    let best: RankOpponentCandidate | null = null;
    for (const opponent of eligible) {
      if (String(opponent.id) === String(targetEntry.id))
        continue;
      const opponentPool = poolFor(opponent, category.id, cohort, settings);
      const information = pairInformationGain(targetPool, opponentPool, settings);
      const score = finishScore(information.leftGain + information.rightGain * 0.08, recent.has(pairToken(targetEntry, opponent)),
        calibration, Math.abs(targetPool.rating - opponentPool.rating), settings);
      if (!best || score > best.score)
        best = { information, opponent, score };
    }
    return {
      calibration,
      eligible: eligible.length,
      expectedRdReduction: best && best.information.leftGain > 0 ? Math.max(0, targetPool.deviation - best.information.nextLeftDeviation) : 0,
      goalLabel: "Target performer",
      pair: best ? [targetEntry, best.opponent] : null,
      ranks,
    };
  }
  function kingsOrder(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings) {
    const eligible = performers.filter(performer => categoryEligible(performer, category, settings, cohort));
    const ranked = rankPerformers(eligible, category.id, cohort, settings);
    const ranks: Record<string, number> = {};
    const rankedIds = new Set();
    ranked.forEach((performer, index) => {
      ranks[performer.id] = index + 1;
      rankedIds.add(String(performer.id));
    });
    const unrated = eligible.filter(performer => !rankedIds.has(String(performer.id)));
    // Unrated performers have no leaderboard position, so vary their order within the starting group.
    for (let index = unrated.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const previous = unrated[index];
      unrated[index] = unrated[swapIndex];
      unrated[swapIndex] = previous;
    }
    return { eligible: eligible.length, ordered: unrated.concat(ranked.reverse()), ranks };
  }
  function takeKingsChallenger(ordered: RankPerformer[]): RankPerformer {
    // Stay close to the bottom of the remaining ranking without making every round predictable.
    const band = Math.min(3, ordered.length);
    const index = Math.floor(Math.pow(Math.random(), 2) * band);
    return ordered.splice(index, 1)[0];
  }
  function selectKingsStartingPair(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings): RankPairResult {
    const order = kingsOrder(performers, category, cohort, settings);
    if (order.ordered.length < 2)
      return { pair: null, eligible: order.eligible, ranks: order.ranks };
    const startingBand = order.ordered.slice(0, Math.min(3, order.ordered.length));
    const first = takeKingsChallenger(startingBand);
    const second = takeKingsChallenger(startingBand);
    const information = pairInformationGain(poolFor(first, category.id, cohort, settings), poolFor(second, category.id, cohort, settings), settings);
    return {
      eligible: order.eligible,
      expectedRdReduction: information.rdReduction,
      goalLabel: "Kings of the hill",
      pair: Math.random() < 0.5 ? [first, second] : [second, first],
      ranks: order.ranks,
    };
  }
  function selectKingsPair(performers: RankPerformer[], winner: RankPerformer, winnerSide: string, defeatedIds: string[], category: RankCategory, cohort: string, settings: RankSettings): RankPairResult {
    const order = kingsOrder(performers, category, cohort, settings);
    const defeated = new Set(defeatedIds.map(id => String(id)));
    const incumbent = order.ordered.find(performer => String(performer.id) === String(winner.id));
    const challengers = order.ordered.filter(performer => String(performer.id) !== String(winner.id) && !defeated.has(String(performer.id)));
    const challenger = incumbent && challengers.length ? takeKingsChallenger(challengers) : null;
    const information = challenger ? pairInformationGain(poolFor(incumbent!, category.id, cohort, settings), poolFor(challenger, category.id, cohort, settings), settings) : null;
    return {
      eligible: order.eligible,
      expectedRdReduction: information ? information.rdReduction : 0,
      goalLabel: "Kings of the hill",
      incumbentId: String(winner.id),
      incumbentSide: winnerSide,
      pair: challenger ? winnerSide === "right" ? [challenger, incumbent!] : [incumbent!, challenger] : null,
      ranks: order.ranks,
    };
  }
  return {
    representativeOpponent, estimatedMatchesToConfidence, freshCategoryBattleEstimate, confidenceProgress, categoryEntries,
    categoryConfidence, selectPair, selectGauntletPair, selectKingsStartingPair, selectKingsPair,
  };
}
