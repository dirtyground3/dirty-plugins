import { GLICKO_SCALE } from "../constants";
import type { RankPool, RankSettings } from "../types";
type RatingPool = Pick<RankPool, "rating" | "deviation" | "volatility">;
type RatingSettings = Pick<RankSettings, "initialVolatility" | "evidenceWeight" | "deviationFloor">;
/** @typedef {{rating: number, deviation: number, volatility: number}} RatingPool */
/** @typedef {{initialVolatility: number, evidenceWeight: number, deviationFloor: number}} RatingSettings */
/** @param {RatingPool} pool @param {RatingPool} opponent @param {RatingSettings} settings @returns {number} */
export function expectedDeviationAfterBattle(pool: RatingPool, opponent: RatingPool, settings: RatingSettings): number {
  const phi = pool.deviation / GLICKO_SCALE;
  const phiStar = Math.sqrt(phi * phi + pool.volatility * pool.volatility);
  const opponentPhi = opponent.deviation / GLICKO_SCALE;
  const g = 1 / Math.sqrt(1 + 3 * opponentPhi * opponentPhi / (Math.PI * Math.PI));
  const expected = 1 / (1 + Math.exp(-g * (pool.rating - opponent.rating) / GLICKO_SCALE));
  const information = g * g * expected * (1 - expected) * settings.evidenceWeight;
  const nextPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + information);
  return Math.max(settings.deviationFloor, nextPhi * GLICKO_SCALE);
}
/** @param {RatingPool} leftPool @param {RatingPool} rightPool @param {RatingSettings} settings */
export function pairInformationGain(leftPool: RatingPool, rightPool: RatingPool, settings: RatingSettings) {
  const nextLeftDeviation = expectedDeviationAfterBattle(leftPool, rightPool, settings);
  const nextRightDeviation = expectedDeviationAfterBattle(rightPool, leftPool, settings);
  const leftGain = Math.max(0, Math.log(leftPool.deviation / nextLeftDeviation));
  const rightGain = Math.max(0, Math.log(rightPool.deviation / nextRightDeviation));
  return {
    entropyGain: leftGain + rightGain,
    leftGain,
    nextLeftDeviation,
    nextRightDeviation,
    rdReduction: Math.max(0, leftPool.deviation - nextLeftDeviation) + Math.max(0, rightPool.deviation - nextRightDeviation),
    rightGain,
  };
}
