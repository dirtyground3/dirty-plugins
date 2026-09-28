// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyRankRating";
  if (window[INSTANCE_KEY]) return;
  var GLICKO_SCALE = 173.7178;

  /** @typedef {{rating: number, deviation: number, volatility: number}} RatingPool */
  /** @typedef {{initialVolatility: number, evidenceWeight: number, deviationFloor: number}} RatingSettings */

  /** @param {RatingPool} pool @param {RatingPool} opponent @param {RatingSettings} settings @returns {number} */
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

  /** @param {RatingPool} leftPool @param {RatingPool} rightPool @param {RatingSettings} settings */
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

  window[INSTANCE_KEY] = { expectedDeviationAfterBattle: expectedDeviationAfterBattle, pairInformationGain: pairInformationGain };
})();
