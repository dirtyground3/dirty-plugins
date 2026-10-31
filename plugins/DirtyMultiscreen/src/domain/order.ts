import type { Scene, SceneOrder } from "../types";

const DAY = 86400000;
const NEWEST_HALF_LIFE_DAYS = 30;
const REPEAT_HALF_LIFE_DAYS = 7;
const FRESH_CANDIDATES = 16;
const UNRATED = 50;
type Ordered = { scene?: Scene };
type Random = () => number;
export interface Ordering {
  order: SceneOrder;
  /** Keep scenes that share a performer or studio apart. */
  spread: boolean;
  /** One clock per pool keeps weighted pages identical when panes load them at different times. */
  now: number;
}

const daysSince = (value: string | null | undefined, now: number) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? Math.max(0, (now - time) / DAY) : Infinity;
};
const ageInDays = (value: string | null | undefined, now: number) => {
  const days = daysSince(value, now);
  return Number.isFinite(days) ? days : 0;
};

/** Natural-log weights: a scene with weight w comes early w times as often as one with weight 1. */
const LOG_WEIGHTS: Partial<Record<SceneOrder, (scene: Scene, now: number) => number>> = {
  // Each earlier play divides the chance: once played is 8x, twice 27x less likely to lead.
  unwatched: scene => -3 * Math.log1p(Math.max(0, scene.play_count ?? 0)),
  // Every 20 rating points multiply the weight by e; each O adds the base weight again.
  favorites: scene => (scene.rating100 ?? UNRATED) / 20 + Math.log1p(Math.max(0, scene.o_counter ?? 0)),
  // Halves every 30 days since the scene was added.
  newest: (scene, now) => (-Math.LN2 * ageInDays(scene.created_at, now)) / NEWEST_HALF_LIFE_DAYS,
};

/** The Stash sort of a playback query; the list order keeps the launching list's own sort. */
export function playbackSort(order: SceneOrder, contextualSort: string, seed: number): Record<string, string> {
  if (order === "newest") return { sort: "created_at", direction: "DESC" };
  if (order !== "list" || contextualSort === "random") return { sort: "random_" + seed };
  return { sort: contextualSort };
}

const performerAndStudio = (item: Ordered) => {
  const scene = item.scene;
  if (!scene) return [];
  const groups = (scene.performers || []).map(performer => "p" + performer.id);
  if (scene.studio?.id) groups.push("s" + scene.studio.id);
  return groups;
};

export function shuffleMultiscreenItems<T>(items: T[], random: Random = Math.random): T[] {
  const shuffledItems = items.slice();
  for (let i = shuffledItems.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const item = shuffledItems[i];
    shuffledItems[i] = shuffledItems[j];
    shuffledItems[j] = item;
  }
  return shuffledItems;
}

/**
 * Spotify's 2014 artist spreading: each group's shuffled members sit at evenly spaced positions with a
 * random offset and +-20% jitter, then all groups merge by position. Ungrouped items land uniformly.
 */
export function spreadShuffle<T>(items: T[], groupOf: (item: T) => string | undefined, random: Random = Math.random) {
  const groups = new Map<string, T[]>();
  items.forEach((item, index) => {
    const key = groupOf(item) ?? "#" + index;
    const members = groups.get(key);
    if (members) members.push(item);
    else groups.set(key, [item]);
  });
  const placed: { item: T; position: number }[] = [];
  for (const members of groups.values()) {
    const spacing = 1 / members.length;
    let position = random() * spacing;
    for (const item of shuffleMultiscreenItems(members, random)) {
      placed.push({ item, position });
      position += spacing * (0.8 + 0.4 * random());
    }
  }
  return placed.sort((left, right) => left.position - right.position).map(entry => entry.item);
}

/**
 * Weighted random permutation (Efraimidis-Spirakis): sort by E / w with E ~ Exp(1), in log space
 * so tiny or huge weights neither underflow nor overflow.
 */
export function weightedShuffle<T>(items: T[], logWeight: (item: T) => number, random: Random = Math.random) {
  return items
    .map(item => {
      const weight = logWeight(item);
      return { item, key: Math.log(-Math.log(1 - random())) - (Number.isFinite(weight) ? weight : 0) };
    })
    .sort((left, right) => left.key - right.key)
    .map(entry => entry.item);
}

/**
 * Keep a priority order but pull forward the nearest item that shares no group with the last
 * `window` placed ones. The bounded lookahead keeps weighted priorities mostly intact.
 */
export function separateGroups<T>(items: T[], groupsOf: (item: T) => string[], window: number) {
  const groups = new Map(items.map(item => [item, groupsOf(item)]));
  const remaining = items.slice();
  const result: T[] = [];
  const lookahead = 2 * window + 4;
  while (remaining.length) {
    const recent = new Set(result.slice(-window).flatMap(item => groups.get(item)!));
    let index = remaining.slice(0, lookahead).findIndex(item => !groups.get(item)!.some(key => recent.has(key)));
    if (index < 0) index = 0;
    result.push(remaining.splice(index, 1)[0]);
  }
  return result;
}

/** How much playing recently played scenes early costs: recency halves weekly, earlier positions weigh more. */
export function repeatPenalty<T extends Ordered>(items: T[], now: number) {
  return items.reduce((total, item, index) => {
    const days = daysSince(item.scene?.last_played_at, now);
    return total + Math.pow(2, -days / REPEAT_HALF_LIFE_DAYS) / (1 + index);
  }, 0);
}

/** Spotify's 2025 "Fewer Repeats": draw several shuffles and keep the one that plays recent scenes last. */
export function freshShuffle<T extends Ordered>(items: T[], shuffle: () => T[], now: number) {
  let best = shuffle();
  let bestPenalty = repeatPenalty(best, now);
  for (let candidate = 1; candidate < FRESH_CANDIDATES && bestPenalty > 0; candidate++) {
    const next = shuffle();
    const penalty = repeatPenalty(next, now);
    if (penalty < bestPenalty) [best, bestPenalty] = [next, penalty];
  }
  return best;
}

/** Smart-shuffle style mix: two favourites, then one discovery, without repeating an item. */
export function mixOrders<T>(primary: T[], discoveries: T[]) {
  const used = new Set<T>();
  const result: T[] = [];
  const take = (source: T[], cursor: { index: number }) => {
    while (cursor.index < source.length) {
      const item = source[cursor.index++];
      if (used.has(item)) continue;
      used.add(item);
      result.push(item);
      return;
    }
  };
  const first = { index: 0 },
    second = { index: 0 };
  while (result.length < primary.length) {
    take(primary, first);
    take(primary, first);
    take(discoveries, second);
  }
  return result;
}

/** One pane's playback list in the selected order; the list order shares its immutable source. */
export function orderMultiscreenItems<T extends Ordered>(
  items: T[],
  ordering: Ordering,
  random: Random = Math.random,
  window = 1,
): T[] {
  const { order, spread, now } = ordering;
  if (order === "list") return items;
  const weighted = (name: SceneOrder) => {
    const logWeight = LOG_WEIGHTS[name]!;
    return weightedShuffle(items, item => (item.scene ? logWeight(item.scene, now) : 0), random);
  };
  const shuffle = () => (spread ? spreadShuffle(items, item => performerAndStudio(item)[0], random) : null);
  if (order === "random") return shuffle() ?? shuffleMultiscreenItems(items, random);
  if (order === "fresh") return freshShuffle(items, () => shuffle() ?? shuffleMultiscreenItems(items, random), now);
  const ordered = order === "mix" ? mixOrders(weighted("favorites"), weighted("unwatched")) : weighted(order);
  return spread ? separateGroups(ordered, performerAndStudio, window) : ordered;
}
