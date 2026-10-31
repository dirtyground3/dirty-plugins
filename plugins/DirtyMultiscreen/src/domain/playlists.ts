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

/** Move each list's first item not already leading an earlier list to the front; other items keep their order. */
export function distinctStarts<T extends { id: string }>(playlists: T[][]): T[][] {
  const leading = new Set<string>();
  return playlists.map(items => {
    const index = items.findIndex(item => !leading.has(item.id));
    if (index < 0) return items;
    leading.add(items[index].id);
    return index === 0 ? items : [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
  });
}

/** The first item at or after `from` that is not playing elsewhere, or -1. */
export function nextFreeIndex<T extends { id: string }>(items: T[], from: number, playing: Set<string>) {
  for (let index = from; index < items.length; index++) if (!playing.has(items[index].id)) return index;
  return -1;
}

export function createMultiscreenPlaylists<T extends { id: string; scene?: Scene }>(
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
  const playlists = Array.from({ length: Math.max(0, totalScreens) }, ordered);
  return ordering.distinct ? distinctStarts(playlists) : playlists;
}

/** Repeatable per-page permutations keep split assignments stable when panes advance independently. */
export function pagePlaylists<T extends { id: string; scene?: Scene }>(
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
