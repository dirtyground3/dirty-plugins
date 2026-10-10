export function shuffleMultiscreenItems<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffledItems = items.slice();
  for (let i = shuffledItems.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const item = shuffledItems[i];
    shuffledItems[i] = shuffledItems[j];
    shuffledItems[j] = item;
  }
  return shuffledItems;
}

export function splitMultiscreenItemsByIndex<T>(items: T[], total: number): T[][] {
  const groups = Array.from({ length: Math.max(0, total) }, () => [] as T[]);
  items.forEach((item, index) => {
    const group = groups[index % total];
    if (group) group.push(item);
  });
  return groups;
}

export function createMultiscreenPlaylists<T>(
  items: T[],
  totalScreens: number,
  randomize: boolean,
  splitItems: boolean,
  random: () => number = Math.random,
): T[][] {
  if (items.length === 0) {
    return Array.from({ length: Math.max(0, totalScreens) }, () => [] as T[]);
  }
  if (splitItems) {
    const sourceItems = randomize ? shuffleMultiscreenItems(items, random) : items;
    return splitMultiscreenItemsByIndex(sourceItems, totalScreens);
  }
  return Array.from({ length: Math.max(0, totalScreens) }, () =>
    randomize ? shuffleMultiscreenItems(items, random) : items,
  );
}

/** Repeatable per-page permutations keep split assignments stable when panes advance independently. */
export function pagePlaylists<T>(
  items: T[],
  totalScreens: number,
  randomize: boolean,
  split: boolean,
  seed: number,
  page: number,
) {
  let value = (seed + Math.imul(page, 2654435761)) >>> 0;
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  return createMultiscreenPlaylists(items, totalScreens, randomize, split, random);
}
