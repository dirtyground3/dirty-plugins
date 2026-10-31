import type { Item, Scene } from "../types";
import { orderMultiscreenItems, type Ordering } from "./order";

/** Keep searched items from another split lane between this lane's neighbors. */
export function locatePlaylistItem(playlists: Item[][], screen: number, selected: Item) {
  const own = playlists[screen] || [];
  let cursor = own.findIndex(item => item.id === selected.id);
  if (cursor >= 0) return { items: own, cursor };
  const lane = playlists.findIndex(items => items.some(item => item.id === selected.id));
  if (lane < 0) return null;
  const position = playlists[lane].findIndex(item => item.id === selected.id);
  cursor = Math.min(own.length, position + (lane > screen ? 1 : 0));
  return { items: [...own.slice(0, cursor), selected, ...own.slice(cursor)], cursor };
}

export function splitMultiscreenItemsByIndex<T>(items: T[], total: number): T[][] {
  const groups = Array.from({ length: Math.max(0, total) }, () => [] as T[]);
  items.forEach((item, index) => {
    const group = groups[index % total];
    if (group) group.push(item);
  });
  return groups;
}

export function createMultiscreenPlaylists<T extends { scene?: Scene }>(
  items: T[],
  totalScreens: number,
  ordering: Ordering,
  splitItems: boolean,
  random: () => number = Math.random,
): T[][] {
  if (items.length === 0) {
    return Array.from({ length: Math.max(0, totalScreens) }, () => [] as T[]);
  }
  // Split lanes play neighbouring items at the same time, so spreading spans one row of panes.
  const ordered = () => orderMultiscreenItems(items, ordering, random, splitItems ? totalScreens : 1);
  if (splitItems) return splitMultiscreenItemsByIndex(ordered(), totalScreens);
  return Array.from({ length: Math.max(0, totalScreens) }, ordered);
}

/** Repeatable per-page permutations keep split assignments stable when panes advance independently. */
export function pagePlaylists<T extends { scene?: Scene }>(
  items: T[],
  totalScreens: number,
  ordering: Ordering,
  split: boolean,
  seed: number,
  page: number,
) {
  let value = (seed + Math.imul(page, 2654435761)) >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  return createMultiscreenPlaylists(items, totalScreens, ordering, split, random);
}
