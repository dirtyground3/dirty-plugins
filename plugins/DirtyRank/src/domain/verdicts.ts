import { DEFAULT_THRESHOLDS } from "./rating";
import type { SavedVerdict, Thresholds } from "./rating";
import type { RankOperationResult } from "../types";
/** [low ID, high ID, score from the low ID's side or null, confirmations], as the backend sends it. */
export type VerdictEntry = [string, string, number | null, number];
/** One pool's verdicts, keyed by pair, each scored from the pair's first ID in text order. */
export interface PoolVerdicts {
  categoryId: string;
  cohort: string;
  thresholds: Thresholds;
  byPair: Map<string, { score: number; confirmations: number }>;
}
/** The pair's key and whether the left performer is its first ID: the backend's text order. */
function pairKey(leftId: string, rightId: string) {
  const left = String(leftId),
    right = String(rightId);
  return { key: left < right ? left + ":" + right : right + ":" + left, leftIsLow: left < right };
}
export function emptyPoolVerdicts(categoryId: string, cohort: string): PoolVerdicts {
  return { categoryId, cohort, thresholds: DEFAULT_THRESHOLDS, byPair: new Map() };
}
export function verdictFor(verdicts: PoolVerdicts | null, leftId: string, rightId: string): SavedVerdict | null {
  if (!verdicts) return null;
  const { key, leftIsLow } = pairKey(leftId, rightId);
  const stored = verdicts.byPair.get(key);
  return stored ? { score: leftIsLow ? stored.score : -stored.score, confirmations: stored.confirmations } : null;
}
/** The verdict after choosing `score` for this pair: a confirmation, a replacement or a new one. */
export function chosenVerdict(previous: SavedVerdict | null, score: number): SavedVerdict {
  return previous && previous.score === score
    ? { score, confirmations: previous.confirmations + 1 }
    : { score, confirmations: 0 };
}
/** A copy with one pair's verdict set from the left performer's side, or removed. */
export function withVerdict(
  verdicts: PoolVerdicts,
  leftId: string,
  rightId: string,
  verdict: SavedVerdict | null,
): PoolVerdicts {
  const { key, leftIsLow } = pairKey(leftId, rightId);
  const byPair = new Map(verdicts.byPair);
  if (verdict)
    byPair.set(key, {
      score: leftIsLow ? verdict.score : -verdict.score,
      confirmations: verdict.confirmations,
    });
  else byPair.delete(key);
  return Object.assign({}, verdicts, { byPair });
}
function validThresholds(value: unknown): Thresholds | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) && numbers[0] > 0 && numbers[0] < numbers[1] && numbers[1] < numbers[2]
    ? (numbers as unknown as Thresholds)
    : null;
}
function entryVerdict(entry: unknown): [string, string, SavedVerdict | null] | null {
  if (!Array.isArray(entry) || entry.length !== 4) return null;
  const [low, high, score, confirmations] = entry;
  if (score === null) return [String(low), String(high), null];
  const value = Number(score);
  if (!Number.isInteger(value) || Math.abs(value) > 3) return null;
  return [String(low), String(high), { score: value, confirmations: Math.max(0, Number(confirmations) || 0) }];
}
export function poolVerdictsFromResult(categoryId: string, cohort: string, result: RankOperationResult): PoolVerdicts {
  let verdicts = emptyPoolVerdicts(categoryId, cohort);
  const thresholds = validThresholds(result.thresholds);
  if (thresholds) verdicts.thresholds = thresholds;
  (Array.isArray(result.verdicts) ? result.verdicts : []).forEach(entry => {
    const parsed = entryVerdict(entry);
    if (parsed) verdicts = withVerdict(verdicts, parsed[0], parsed[1], parsed[2]);
  });
  return verdicts;
}
/** Apply a record or undo response: the pair's stored verdict and the refitted thresholds. */
export function applyVerdictResult(verdicts: PoolVerdicts, result: RankOperationResult): PoolVerdicts {
  const parsed = entryVerdict(result.verdict);
  let next = parsed ? withVerdict(verdicts, parsed[0], parsed[1], parsed[2]) : verdicts;
  const thresholds = validThresholds(result.thresholds);
  if (thresholds) next = Object.assign({}, next, { thresholds });
  return next;
}
const STRENGTHS = ["", "slightly better than", "better than", "much better than"];
/** A verdict in words, from the left performer's side. */
export function verdictLabel(score: number, leftName = "Left", rightName = "Right") {
  if (score === 0) return leftName + " and " + rightName + " are equal";
  const [better, worse] = score > 0 ? [leftName, rightName] : [rightName, leftName];
  return better + " is " + STRENGTHS[Math.min(3, Math.abs(score))] + " " + worse;
}
