import type { RankCategory, RankConfidence, RankEntry, RankMatchmakerDependencies, RankOpponentCandidate, RankPairCandidate, RankPairResult, RankPerformer, RankPool, RankSettings } from "../types";
export function createMatchmaker(dependencies: RankMatchmakerDependencies) {
  var categoryEligible = dependencies.categoryEligible, poolFor = dependencies.poolFor;
  var precisionTier = dependencies.precisionTier, rankPerformers = dependencies.rankPerformers;
  var settingsFromConfiguration = dependencies.settingsFromConfiguration;
  var pairToken = dependencies.pairToken, recentPairWindow = dependencies.recentPairWindow;
  var expectedDeviationAfterBattle = dependencies.expectedDeviationAfterBattle;
  var pairInformationGain = dependencies.pairInformationGain;
  var ORDER_CONFIDENCE_Z = 0.84, MATCHMAKER_FOCUS_LIMIT = 48;
  /** @param {RankPool} pool @param {number} opponentDeviation @param {RankSettings} settings */
  function representativeOpponent(pool: RankPool, opponentDeviation: number, settings: RankSettings) {
    return {
      rating: pool.rating,
      deviation: opponentDeviation,
      volatility: settings.initialVolatility,
      matches: 1,
    };
  }
  /** @param {RankPool} pool @param {number} targetDeviation @param {RankPool} opponent @param {RankSettings} settings */
  function estimatedMatchesToConfidence(pool: RankPool, targetDeviation: number, opponent: RankPool, settings: RankSettings) {
    if (pool.matches > 0 && pool.deviation <= targetDeviation)
      return 0;
    var subject = Object.assign({}, pool);
    var counterpart = Object.assign({}, opponent || representativeOpponent(pool, settings.initialDeviation, settings));
    for (var matches = 1;matches <= 1000;matches += 1) {
      var nextSubjectDeviation = expectedDeviationAfterBattle(subject, counterpart, settings);
      var nextOpponentDeviation = expectedDeviationAfterBattle(counterpart, subject, settings);
      subject = Object.assign({}, subject, { deviation: nextSubjectDeviation, matches: subject.matches + 1 });
      counterpart = Object.assign({}, counterpart, { deviation: nextOpponentDeviation, matches: counterpart.matches + 1 });
      if (nextSubjectDeviation <= targetDeviation)
        return matches;
    }
    return 1000;
  }
  /** @param {number} performerCount @param {unknown} settings */
  function freshCategoryBattleEstimate(performerCount: number, settings: unknown) {
    // Compare presets on a fresh pool, not on ratings already earned in one
    // category. Informative, similarly rated opponents refine both participants.
    var effective = settingsFromConfiguration(settings);
    var count = Math.max(0, Math.floor(performerCount));
    if (count < 2)
      return { battles: 0, performers: count, capped: false };
    var initial = {
      rating: effective.initialRating, deviation: effective.initialDeviation,
      volatility: effective.initialVolatility, matches: 0,
    };
    var matches = estimatedMatchesToConfidence(initial, effective.provisionalDeviation, initial, effective);
    return { battles: Math.ceil(count * matches / 2), performers: count, capped: matches === 1000 };
  }
  /** @param {RankSettings} settings */
  function confidenceGoalLabel(settings: RankSettings) {
    if (settings.confidenceGoal === "all")
      return "Every performer";
    if (settings.confidenceGoal === "top")
      return "Top " + settings.confidenceTopN;
    return "Leaderboard order";
  }
  /** @param {number} completedBattles @param {number} remainingBattles */
  function confidenceProgress(completedBattles: number, remainingBattles: number) {
    var total = completedBattles + remainingBattles;
    return total > 0 ? completedBattles / total * 100 : 0;
  }
  /** @param {RankPerformer[]} performers @param {RankCategory} category @param {string} cohort @param {RankSettings} settings */
  function categoryEntries(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings) {
    return performers.filter(function (performer) {
      return categoryEligible(performer, category, settings, cohort);
    }).map(function (performer) {
      return {
        performer: performer,
        pool: poolFor(performer, category.id, cohort, settings),
      };
    }).sort(function (left, right) {
      if (right.pool.rating !== left.pool.rating)
        return right.pool.rating - left.pool.rating;
      if (left.pool.matches !== right.pool.matches)
        return right.pool.matches - left.pool.matches;
      return String(left.performer.name || "").localeCompare(String(right.performer.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }
  /** @param {RankEntry} left @param {RankEntry} right @param {RankSettings} settings @param {string} kind */
  function orderBoundary(left: RankEntry, right: RankEntry, settings: RankSettings, kind: string) {
    var bothRated = left.pool.matches > 0 && right.pool.matches > 0;
    var gap = Math.max(0, left.pool.rating - right.pool.rating);
    var combinedDeviation = Math.sqrt(left.pool.deviation * left.pool.deviation + right.pool.deviation * right.pool.deviation);
    var separation = combinedDeviation > 0 ? gap / combinedDeviation : ORDER_CONFIDENCE_Z;
    var probabilityProgress = bothRated ? Math.min(1, separation / ORDER_CONFIDENCE_Z) : 0;
    var refinedTie = bothRated && separation < ORDER_CONFIDENCE_Z &&
      left.pool.deviation <= settings.provisionalDeviation &&
      right.pool.deviation <= settings.provisionalDeviation;
    var tieProgress = bothRated && separation < ORDER_CONFIDENCE_Z
      ? Math.min(1, settings.provisionalDeviation / Math.max(left.pool.deviation, right.pool.deviation))
      : 0;
    return {
      confident: bothRated && (separation >= ORDER_CONFIDENCE_Z ||
        refinedTie),
      kind: kind,
      left: left,
      progress: Math.max(probabilityProgress, tieProgress),
      right: right,
    };
  }
  /** @param {RankEntry[]} entries @param {RankSettings} settings */
  function confidenceBoundaries(entries: RankEntry[], settings: RankSettings) {
    var boundaries: ReturnType<typeof orderBoundary>[] = [];
    if (settings.confidenceGoal === "all" || entries.length < 2)
      return boundaries;
    if (settings.confidenceGoal === "ranking") {
      for (var index = 0;index < entries.length - 1;index += 1) {
        boundaries.push(orderBoundary(entries[index], entries[index + 1], settings, "order"));
      }
      return boundaries;
    }
    var topCount = Math.min(settings.confidenceTopN, entries.length);
    for (var topIndex = 0;topIndex < topCount - 1;topIndex += 1) {
      boundaries.push(orderBoundary(entries[topIndex], entries[topIndex + 1], settings, "top-order"));
    }
    if (topCount < entries.length) {
      var cutoff = entries[topCount - 1];
      for (var outsideIndex = topCount;outsideIndex < entries.length;outsideIndex += 1) {
        boundaries.push(orderBoundary(cutoff, entries[outsideIndex], settings, "top-membership"));
      }
    }
    return boundaries;
  }
  /** @param {RankPerformer[]} performers @param {RankCategory} category @param {string} cohort @param {RankSettings} settings @returns {RankConfidence} */
  function categoryConfidence(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings): RankConfidence {
    var entries = categoryEntries(performers, category, cohort, settings);
    var activeWeights = new Map<string, number>();
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
        if (stable)
          established += 1;
        if (!stable) {
          var uncertainty = Math.max(1, pool.deviation / settings.provisionalDeviation);
          activeWeights.set(String(entry.performer.id), pool.matches > 0 ? Math.min(12, 1 + uncertainty * uncertainty) : 8);
        }
        var requiredBattles = estimatedMatchesToConfidence(pool, settings.provisionalDeviation, representativeOpponent(pool, opponentDeviation, settings), settings);
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
    var needs = new Map<string, number>();
    function addWeight(entry: RankEntry, amount: number) {
      var id = String(entry.performer.id);
      activeWeights.set(id, Math.min(12, (activeWeights.get(id) || 0) + amount));
    }
    function requireMatches(entry: RankEntry, opponent: RankEntry | null) {
      var id = String(entry.performer.id);
      var required = estimatedMatchesToConfidence(entry.pool, settings.provisionalDeviation, opponent ? opponent.pool : representativeOpponent(entry.pool, opponentDeviation, settings), settings);
      needs.set(id, Math.max(needs.get(id) || 0, Math.max(1, required)));
    }
    entries.forEach(function (entry) {
      if (entry.pool.matches === 0) {
        addWeight(entry, 8);
        requireMatches(entry, null);
      }
    });
    boundaries.forEach(function (boundary) {
      if (boundary.confident)
        return;
      var priority = 1 + (1 - boundary.progress) * 4;
      addWeight(boundary.left, priority);
      addWeight(boundary.right, priority);
      requireMatches(boundary.left, boundary.right);
      requireMatches(boundary.right, boundary.left);
    });
    var remainingBoundaryParticipations = Array.from(needs.values()).reduce(function (sum, value) { return sum + value; }, 0);
    var completedBattles = Math.floor(totalMatches / 2);
    var remainingBattles = Math.ceil(remainingBoundaryParticipations / 2);
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
  /** @param {RankPerformer[]} performers @param {RankCategory} category @param {string} cohort @param {RankSettings} settings @param {string[]} recentTokens @returns {RankPairResult} */
  function selectPair(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings, recentTokens: string[]): RankPairResult {
    var confidence = categoryConfidence(performers, category, cohort, settings);
    var eligible = confidence.entries.map(function (entry) { return entry.performer; });
    if (eligible.length < 2)
      return { pair: null, eligible: eligible.length, ranks: {} };
    var rankList = rankPerformers(eligible, category.id, cohort, settings);
    /** @type {Record<string, number>} */
    var ranks: Record<string, number> = {};
    rankList.forEach(function (performer, index) { ranks[performer.id] = index + 1; });
    var focus = confidence.entries.slice().sort(function (left, right) {
      var priorityDifference = (confidence.activeWeights.get(String(right.performer.id)) || 0) -
        (confidence.activeWeights.get(String(left.performer.id)) || 0);
      if (priorityDifference)
        return priorityDifference;
      return right.pool.deviation - left.pool.deviation;
    }).slice(0, MATCHMAKER_FOCUS_LIMIT);
    var recent = new Set(recentPairWindow(recentTokens, settings.avoidRepeatWindow));
    var calibration = Math.random() * 100 < settings.calibrationPercent;
    var evaluated = new Set();
    var best: RankPairCandidate | null = null;
    focus.forEach(function (leftEntry) {
      confidence.entries.forEach(function (rightEntry) {
        if (leftEntry.performer.id === rightEntry.performer.id)
          return;
        var token = pairToken(leftEntry.performer, rightEntry.performer);
        if (evaluated.has(token))
          return;
        evaluated.add(token);
        var information = pairInformationGain(leftEntry.pool, rightEntry.pool, settings);
        var leftPriority = 0.25 + (confidence.activeWeights.get(String(leftEntry.performer.id)) || 0);
        var rightPriority = 0.25 + (confidence.activeWeights.get(String(rightEntry.performer.id)) || 0);
        var score = information.leftGain * leftPriority + information.rightGain * rightPriority;
        if (leftEntry.pool.matches === 0 && rightEntry.pool.matches === 0)
          score *= 1.12;
        if (recent.has(token))
          score *= 0.04;
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
    best = best as RankPairCandidate | null;
    best = best as RankPairCandidate | null;
    if (!best)
      return { pair: null, eligible: eligible.length, ranks: ranks };
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
  /** @param {RankPerformer[]} performers @param {RankCategory} category @param {string} cohort @param {RankSettings} settings @param {RankPerformer} target @param {string[]} recentTokens @returns {RankPairResult} */
  function selectGauntletPair(performers: RankPerformer[], target: RankPerformer, category: RankCategory, cohort: string, settings: RankSettings, recentTokens: string[]): RankPairResult {
    var eligible = performers.filter(function (performer) {
      return categoryEligible(performer, category, settings, cohort);
    });
    var targetEntry = eligible.find(function (performer) { return String(performer.id) === String(target.id); });
    /** @type {Record<string, number>} */
    var ranks: Record<string, number> = {};
    rankPerformers(eligible, category.id, cohort, settings).forEach(function (performer, index) {
      ranks[performer.id] = index + 1;
    });
    if (!targetEntry || eligible.length < 2)
      return { pair: null, eligible: eligible.length, ranks: ranks };
    var targetPool = poolFor(targetEntry, category.id, cohort, settings);
    var recent = new Set(recentPairWindow(recentTokens, settings.avoidRepeatWindow));
    var calibration = Math.random() * 100 < settings.calibrationPercent;
    var best: RankOpponentCandidate | null = null;
    eligible.forEach(function (opponent) {
      if (String(opponent.id) === String(targetEntry!.id))
        return;
      var opponentPool = poolFor(opponent, category.id, cohort, settings);
      var information = pairInformationGain(targetPool, opponentPool, settings);
      var token = pairToken(targetEntry!, opponent);
      var score = information.leftGain + information.rightGain * 0.08;
      if (recent.has(token))
        score *= 0.04;
      if (calibration) {
        var ratingDistance = Math.abs(targetPool.rating - opponentPool.rating);
        score *= 0.8 + Math.min(0.35, ratingDistance / Math.max(1, settings.initialDeviation * 4));
      }
      score *= 0.995 + Math.random() * 0.01;
      if (!best || score > best.score) {
        best = { information: information, opponent: opponent, score: score };
      }
    });
    best = best as RankOpponentCandidate | null;
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
  /** @param {RankPerformer[]} performers @param {RankCategory} category @param {string} cohort @param {RankSettings} settings */
  function kingsOrder(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings) {
    var eligible = performers.filter(function (performer) {
      return categoryEligible(performer, category, settings, cohort);
    });
    var ranked = rankPerformers(eligible, category.id, cohort, settings);
    /** @type {Record<string, number>} */
    var ranks: Record<string, number> = {};
    var rankedIds = new Set();
    ranked.forEach(function (performer, index) {
      ranks[performer.id] = index + 1;
      rankedIds.add(String(performer.id));
    });
    var unrated = eligible.filter(function (performer) { return !rankedIds.has(String(performer.id)); });
    // Unrated performers have no leaderboard position, so vary their order within the starting group.
    for (var index = unrated.length - 1;index > 0;index -= 1) {
      var swapIndex = Math.floor(Math.random() * (index + 1));
      var previous = unrated[index];
      unrated[index] = unrated[swapIndex];
      unrated[swapIndex] = previous;
    }
    return { eligible: eligible.length, ordered: unrated.concat(ranked.reverse()), ranks: ranks };
  }
  /** @param {RankPerformer[]} ordered @returns {RankPerformer | null} */
  function takeKingsChallenger(ordered: RankPerformer[]): RankPerformer {
    // Stay close to the bottom of the remaining ranking without making every round predictable.
    var band = Math.min(3, ordered.length);
    var index = Math.floor(Math.pow(Math.random(), 2) * band);
    return ordered.splice(index, 1)[0];
  }
  /** @param {RankPerformer[]} performers @param {RankCategory} category @param {string} cohort @param {RankSettings} settings @returns {RankPairResult} */
  function selectKingsStartingPair(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings): RankPairResult {
    var order = kingsOrder(performers, category, cohort, settings);
    if (order.ordered.length < 2)
      return { pair: null, eligible: order.eligible, ranks: order.ranks };
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
  /** @param {RankPerformer[]} performers @param {RankCategory} category @param {string} cohort @param {RankSettings} settings @param {RankPerformer} winner @param {string} winnerSide @param {string[]} defeatedIds @returns {RankPairResult} */
  function selectKingsPair(performers: RankPerformer[], winner: RankPerformer, winnerSide: string, defeatedIds: string[], category: RankCategory, cohort: string, settings: RankSettings): RankPairResult {
    var order = kingsOrder(performers, category, cohort, settings);
    var defeated = new Set(defeatedIds.map(function (id) { return String(id); }));
    var incumbent = order.ordered.find(function (performer) { return String(performer.id) === String(winner.id); });
    var challengers = order.ordered.filter(function (performer) {
      return String(performer.id) !== String(winner.id) && !defeated.has(String(performer.id));
    });
    var challenger = incumbent && challengers.length ? takeKingsChallenger(challengers) : null;
    var information = challenger ? pairInformationGain(poolFor(incumbent!, category.id, cohort, settings), poolFor(challenger, category.id, cohort, settings), settings) : null;
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
    representativeOpponent: representativeOpponent, estimatedMatchesToConfidence: estimatedMatchesToConfidence,
    freshCategoryBattleEstimate: freshCategoryBattleEstimate,
    confidenceProgress: confidenceProgress, categoryEntries: categoryEntries,
    categoryConfidence: categoryConfidence, selectPair: selectPair,
    selectGauntletPair: selectGauntletPair,
    selectKingsStartingPair: selectKingsStartingPair, selectKingsPair: selectKingsPair
  };
}
