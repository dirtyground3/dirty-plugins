import { GLICKO_SCALE } from "../constants";

export interface CategoryScore {
  rating: number;
  position: number;
  strength: number;
}
interface RatingGroup {
  rating: number;
  count: number;
  expected: number;
  score: CategoryScore;
}
export interface CategoryScoreIndex {
  performers: Map<string, RatingGroup>;
  groups: Map<number, RatingGroup>;
  /** Population mean and standard deviation of the category's Glicko ratings. */
  mean: number;
  spread: number;
}
export interface CategoryScoreUpdate {
  id: string;
  rating: number | null;
}

/** Complementary probabilities use one exponential, including saturated rating gaps. */
function expectation(rating: number, opponent: number) {
  if (rating === opponent) return 0.5;
  const lower = 1 / (1 + Math.exp(Math.abs(opponent - rating) / GLICKO_SCALE));
  return rating < opponent ? lower : 1 - lower;
}
function orderedGroups(index: CategoryScoreIndex) {
  return Array.from(index.groups.values()).sort((left, right) => left.rating - right.rating);
}
// Keep shifted weights finite and away from subnormal arithmetic. Wider ranges
// retain the stable pairwise calculation instead of losing small rating gaps.
const MAX_WEIGHT_SPAN = 512;
function comparisonWeights(groups: RatingGroup[]) {
  if (groups.length < 2) return null;
  const first = groups[0]?.rating || 0;
  const span = ((groups[groups.length - 1]?.rating || 0) - first) / GLICKO_SCALE;
  return span <= MAX_WEIGHT_SPAN ? groups.map(group => Math.exp((group.rating - first) / GLICKO_SCALE)) : null;
}
function publishScores(index: CategoryScoreIndex, groups = orderedGroups(index)) {
  const count = index.performers.size;
  let sum = 0,
    squares = 0;
  for (const group of groups) sum += group.rating * group.count;
  index.mean = count ? sum / count : 0;
  for (const group of groups) squares += group.count * (group.rating - index.mean) ** 2;
  index.spread = count ? Math.sqrt(squares / count) : 0;
  let below = 0;
  for (const group of groups) {
    const position = count > 1 ? (100 * (below + (group.count - 1) / 2)) / (count - 1) : 50;
    const strength = count > 1 ? (100 * (group.expected - 0.5)) / (count - 1) : 50;
    // Published values stay immutable even when the retained group changes later.
    group.score = { rating: 0.8 * position + 0.2 * strength, position, strength };
    below += group.count;
  }
}
function* categoryScoreWork(entries: Iterable<{ id: string; rating: number }>) {
  const index: CategoryScoreIndex = { performers: new Map(), groups: new Map(), mean: 0, spread: 0 };
  for (const entry of entries) {
    let group = index.groups.get(entry.rating);
    if (!group) {
      group = { rating: entry.rating, count: 0, expected: 0, score: { rating: 50, position: 50, strength: 50 } };
      index.groups.set(entry.rating, group);
    }
    group.count++;
    index.performers.set(entry.id, group);
  }
  const groups = orderedGroups(index);
  for (const group of groups) group.expected = group.count / 2;
  const weights = comparisonWeights(groups);
  let left = 0,
    right = 1;
  while (left < groups.length - 1) {
    let remaining = 32768;
    while (remaining && left < groups.length - 1) {
      const first = groups[left];
      const weight = weights?.[left] || 0;
      const end = Math.min(groups.length, right + remaining);
      remaining -= end - right;
      for (; right < end; right++) {
        const second = groups[right];
        // The common exponential shift cancels in this logistic ratio.
        const probability = weights ? weight / (weight + weights[right]) : expectation(first.rating, second.rating);
        first.expected += second.count * probability;
        second.expected += first.count * (1 - probability);
      }
      if (right === groups.length) right = ++left + 1;
    }
    if (left < groups.length - 1) yield;
  }
  publishScores(index, groups);
  return index;
}
export function buildCategoryScoreIndex(entries: Iterable<{ id: string; rating: number }>): CategoryScoreIndex {
  const work = categoryScoreWork(entries);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}
/** Publish only complete scores, yielding browser tasks between bounded comparison batches. */
export async function buildCategoryScoreIndexAsync(
  entries: Iterable<{ id: string; rating: number }>,
  signal?: AbortSignal,
): Promise<CategoryScoreIndex> {
  const work = categoryScoreWork(entries);
  let channel: MessageChannel | undefined;
  try {
    for (;;) {
      if (signal?.aborted) throw Object.assign(new Error("Score calculation cancelled."), { name: "AbortError" });
      const step = work.next();
      if (step.done) return step.value;
      await new Promise<void>(resolve => {
        // Message tasks allow input/paint without the nested timeout clamp.
        channel ||= new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
      });
    }
  } finally {
    channel?.port1.close();
    channel?.port2.close();
  }
}

/** Small accepted batches replace contributions in O(changed performers × rating groups). */
export function updateCategoryScoreIndex(index: CategoryScoreIndex, updates: CategoryScoreUpdate[]) {
  const changes = updates.filter(update => (index.performers.get(update.id)?.rating ?? null) !== update.rating);
  if (!changes.length) return index;
  // Large changes are cheaper to rebuild than to repeatedly adjust every group.
  if (changes.length * 4 >= index.groups.size) {
    const ratings = new Map(Array.from(index.performers, ([id, group]) => [id, group.rating]));
    for (const change of changes) {
      if (change.rating === null) ratings.delete(change.id);
      else ratings.set(change.id, change.rating);
    }
    return buildCategoryScoreIndex(Array.from(ratings, ([id, rating]) => ({ id, rating })));
  }
  for (const change of changes) {
    const previous = index.performers.get(change.id);
    if (previous) {
      for (const group of index.groups.values()) group.expected -= expectation(group.rating, previous.rating);
      previous.count--;
      if (!previous.count) index.groups.delete(previous.rating);
      index.performers.delete(change.id);
    }
    if (change.rating === null) continue;
    let expected = 0.5;
    const existing = index.groups.get(change.rating);
    for (const group of index.groups.values()) {
      const probability = expectation(group.rating, change.rating);
      group.expected += probability;
      if (!existing) expected += group.count * (1 - probability);
    }
    const group = existing || {
      rating: change.rating,
      count: 0,
      expected,
      score: { rating: 50, position: 50, strength: 50 },
    };
    group.count++;
    index.groups.set(change.rating, group);
    index.performers.set(change.id, group);
  }
  publishScores(index);
  return index;
}
