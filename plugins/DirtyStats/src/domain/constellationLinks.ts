import type { StatsConstellationLink } from "../types";

export const CONSTELLATION_EDGE_BUDGET = 5000;

/** Strongest-first spanning forest, then strongest remaining edges within the display budget. */
export function displayedConstellationLinks<T extends StatsConstellationLink>(links: T[], budget: number): T[] {
  if (links.length <= budget) return links;
  const parents = new Map<string, string>();
  function root(id: string): string {
    let current = id;
    while (parents.has(current)) current = parents.get(current)!;
    while (parents.has(id)) {
      const next = parents.get(id)!;
      parents.set(id, current);
      id = next;
    }
    return current;
  }
  const retained = new Set<T>();
  for (const link of links) {
    const left = root(link.source),
      right = root(link.target);
    if (left !== right) {
      parents.set(left, right);
      retained.add(link);
      if (retained.size === budget) break;
    }
  }
  for (const link of links) {
    if (retained.size === budget) break;
    retained.add(link);
  }
  return links.filter(link => retained.has(link));
}
