import { constants } from "@generated/dirtyRank.settings";
import { RATING_SCALE } from "../constants";
import type { RankPool, RankSettings } from "../types";
type RatingPool = Pick<RankPool, "rating" | "deviation">;
type RatingSettings = Pick<RankSettings, "evidenceWeight" | "deviationFloor">;
/** Where "slightly", "better" and "much better" begin on the log-odds scale. */
export type Thresholds = readonly [number, number, number];
export const DEFAULT_THRESHOLDS = constants.verdictThresholds as unknown as Thresholds;
/** A verdict runs from -3 (the right performer is much better) to +3 (the left one is). */
export const VERDICT_LIMIT = 3;
export const VERDICT_SCORES = [-3, -2, -1, 0, 1, 2, 3];
export function sigmoid(value: number) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}
/** The latent interval of a verdict of this size (0 to 3) for the favoured performer. */
function verdictBounds(size: number, thresholds: Thresholds): [number, number] {
  const [slightly, better, much] = thresholds;
  if (size === 0) return [-slightly, slightly];
  if (size === 1) return [slightly, better];
  if (size === 2) return [better, much];
  return [much, Infinity];
}
/**
 * Chance of this verdict when the left performer leads by `difference` log-odds: where a
 * logistic perception of the difference falls between thresholds that mirror around
 * equal (an ordinal Bradley-Terry model). Matches the backend's verdict_probability.
 */
export function verdictProbability(difference: number, score: number, thresholds: Thresholds) {
  if (score < 0) {
    difference = -difference;
    score = -score;
  }
  const [low, high] = verdictBounds(score, thresholds);
  return sigmoid(difference - low) - (high === Infinity ? 0 : sigmoid(difference - high));
}
/**
 * Chances of the seven verdicts, from -3 to 3, when the left performer's lead is normal
 * with this mean and variance (the probit approximation of the logistic average).
 */
export function predictedVerdicts(mean: number, variance: number, thresholds: Thresholds) {
  const shrink = 1 / Math.sqrt(1 + (Math.PI * variance) / 8);
  const [slightly, better, much] = thresholds;
  // P(verdict >= -2), ..., P(verdict >= 3).
  const atLeast = [-much, -better, -slightly, slightly, better, much].map(bound => sigmoid((mean - bound) * shrink));
  return VERDICT_SCORES.map((_score, index) =>
    Math.max(0, (index === 0 ? 1 : atLeast[index - 1]) - (index === 6 ? 0 : atLeast[index])),
  );
}
/**
 * Gradient and curvature of one verdict's log-likelihood in a performer's rating, from its
 * own side (score > 0 favours it). `shrink` discounts an uncertain opponent, as Glicko does.
 */
function verdictTerms(lead: number, score: number, thresholds: Thresholds, shrink: number) {
  const side = score < 0 ? -1 : 1;
  const [low, high] = verdictBounds(Math.abs(score), thresholds);
  const lower = sigmoid(shrink * (side * lead - low));
  const upper = high === Infinity ? 0 : sigmoid(shrink * (side * lead - high));
  return {
    gradient: side * shrink * (1 - lower - upper),
    curvature: shrink * shrink * (lower * (1 - lower) + upper * (1 - upper)),
  };
}
/** Expected information (Fisher) of one verdict about a performer's rating, in log-odds units. */
function expectedVerdictInformation(lead: number, thresholds: Thresholds, shrink: number) {
  const [slightly, better, much] = thresholds;
  const bounds = [-much, -better, -slightly, slightly, better, much];
  const atLeast = bounds.map(bound => sigmoid(shrink * (lead - bound)));
  let information = 0;
  for (let index = 0; index < 7; index += 1) {
    const upper = index === 0 ? 1 : atLeast[index - 1];
    const lower = index === 6 ? 0 : atLeast[index];
    const probability = upper - lower;
    const slope = shrink * (upper * (1 - upper) - lower * (1 - lower));
    if (probability > 1e-12) information += (slope * slope) / probability;
  }
  return information;
}
function opponentShrink(opponent: RatingPool) {
  const phi = opponent.deviation / RATING_SCALE;
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}
/**
 * The deviation one more verdict against `opponent` is expected to leave. An uncertain
 * opponent tells less (Glicko's g factor), so matchmaking prefers established opponents.
 */
export function expectedDeviationAfterBattle(
  pool: RatingPool,
  opponent: RatingPool,
  settings: RatingSettings,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): number {
  const phi = pool.deviation / RATING_SCALE;
  const lead = (pool.rating - opponent.rating) / RATING_SCALE;
  const information = expectedVerdictInformation(lead, thresholds, opponentShrink(opponent)) * settings.evidenceWeight;
  const nextPhi = 1 / Math.sqrt(1 / (phi * phi) + information);
  return Math.max(settings.deviationFloor, nextPhi * RATING_SCALE);
}
/** Kullback-Leibler divergence of N(mean, variance) from N(baseMean, baseVariance), in nats. */
function normalDivergence(mean: number, variance: number, baseMean: number, baseVariance: number) {
  const shift = mean - baseMean;
  return 0.5 * (Math.log(baseVariance / variance) + (variance + shift * shift) / baseVariance - 1);
}
interface Side {
  mean: number;
  variance: number;
}
function sideOf(pool: RatingPool): Side {
  const deviation = pool.deviation / RATING_SCALE;
  return { mean: pool.rating / RATING_SCALE, variance: deviation * deviation };
}
/** One Newton step adding (sign 1) or removing (sign -1) a verdict from this side's rating. */
function stepped(side: Side, lead: number, score: number, thresholds: Thresholds, shrink: number, weight: number) {
  const terms = verdictTerms(lead, score, thresholds, shrink);
  const precision = 1 / side.variance + weight * terms.curvature;
  return { mean: side.mean + (weight * terms.gradient) / precision, variance: 1 / precision };
}
function removed(
  side: Side,
  lead: number,
  score: number,
  thresholds: Thresholds,
  shrink: number,
  weight: number,
  floor: number,
) {
  const terms = verdictTerms(lead, score, thresholds, shrink);
  const precision = Math.max(floor, 1 / side.variance - weight * terms.curvature);
  return { mean: side.mean - (weight * terms.gradient) / precision, variance: 1 / precision };
}
export interface SavedVerdict {
  /** From the left performer's side. */
  score: number;
  /** How often the same verdict was chosen again. */
  confirmations: number;
}
/** The prior chance that one answer is a slip, landing on any verdict at random. */
export const SLIP_RATE = 0.1;
export interface VerdictInformation {
  /** Expected information (nats) the answer adds to each performer's rating. */
  leftGain: number;
  rightGain: number;
  /**
   * For a judged pair: how much the other verdicts raise the chance that its saved
   * verdict was a slip, above the chance any verdict has before there is evidence.
   */
  slipChance: number;
}
/** Chance that a verdict chosen `answers` times is a slip, when an opinion gives it `likelihood`. */
function slipPosterior(likelihood: number, answers: number) {
  // A slip lands on any of the seven answers. Every time the same verdict was chosen,
  // a slip would have had to land on it again; a real opinion simply repeats.
  const slips = Math.pow(SLIP_RATE / VERDICT_SCORES.length, answers);
  return slips / (slips + (1 - Math.pow(SLIP_RATE, answers)) * likelihood);
}
/**
 * Expected Shannon information a verdict on this pair adds to the two ratings: the
 * mutual information between the answer and each rating, as the expected divergence of
 * the rating after the answer from the rating now.
 *
 * A judged pair's answer replaces its saved verdict. Choosing the same verdict changes
 * nothing, so the pair is only worth asking again when the other verdicts point to a slip:
 * when they make the saved verdict less likely than it is with no evidence at all. A
 * verdict nothing else can check (a newcomer's only one) does not come back; a new
 * opponent tells more. Each confirmation makes a slip much less likely.
 */
export function verdictInformation(
  leftPool: RatingPool,
  rightPool: RatingPool,
  settings: RatingSettings & Pick<RankSettings, "initialDeviation">,
  thresholds: Thresholds,
  saved?: SavedVerdict | null,
): VerdictInformation {
  const weight = settings.evidenceWeight;
  const left = sideOf(leftPool);
  const right = sideOf(rightPool);
  const leftShrink = opponentShrink(rightPool);
  const rightShrink = opponentShrink(leftPool);
  const priorDeviation = settings.initialDeviation / RATING_SCALE;
  const floor = 1 / (priorDeviation * priorDeviation);
  // Without the saved verdict: what the other verdicts alone say about the pair.
  let baseLeft = left;
  let baseRight = right;
  let slipChance = 1;
  if (saved) {
    const lead = left.mean - right.mean;
    baseLeft = removed(left, lead, saved.score, thresholds, leftShrink, weight, floor);
    baseRight = removed(right, -lead, -saved.score, thresholds, rightShrink, weight, floor);
  }
  const lead = baseLeft.mean - baseRight.mean;
  const predicted = predictedVerdicts(lead, baseLeft.variance + baseRight.variance, thresholds);
  if (saved) {
    const answers = 1 + Math.max(0, saved.confirmations);
    const index = saved.score + VERDICT_LIMIT;
    const uninformed = predictedVerdicts(0, 2 * priorDeviation * priorDeviation, thresholds);
    slipChance = Math.max(0, slipPosterior(predicted[index], answers) - slipPosterior(uninformed[index], answers));
  }
  let leftGain = 0;
  let rightGain = 0;
  VERDICT_SCORES.forEach((score, index) => {
    // The same answer again leaves both ratings as they are.
    if (saved && score === saved.score) return;
    const chance = predicted[index];
    if (chance <= 0) return;
    const nextLeft = stepped(baseLeft, lead, score, thresholds, leftShrink, weight);
    const nextRight = stepped(baseRight, -lead, -score, thresholds, rightShrink, weight);
    leftGain += chance * normalDivergence(nextLeft.mean, nextLeft.variance, left.mean, left.variance);
    rightGain += chance * normalDivergence(nextRight.mean, nextRight.variance, right.mean, right.variance);
  });
  return { leftGain: leftGain * slipChance, rightGain: rightGain * slipChance, slipChance: saved ? slipChance : 0 };
}
