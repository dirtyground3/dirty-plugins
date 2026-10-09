export function shuffleMultiscreenItems<T>(items: T[], random: () => number = Math.random): T[] {
  const shuffledItems = items.slice();
  for (let i = shuffledItems.length - 1;i > 0;i--) {
    const j = Math.floor(random() * (i + 1));
    const item = shuffledItems[i];
    shuffledItems[i] = shuffledItems[j];
    shuffledItems[j] = item;
  }
  return shuffledItems;
}

export function splitMultiscreenItemsByIndex<T>(items: T[], total: number): T[][] {
  const groups = Array.from({ length: Math.max(0, total) }, function() { return [] as T[]; });
  items.forEach(function(item, index) {
    const group = groups[index % total];
    if (group) group.push(item);
  });
  return groups;
}

export function createMultiscreenPlaylists<T>(items: T[], totalScreens: number, randomize: boolean, splitItems: boolean, random: () => number = Math.random): T[][] {
  if (items.length === 0) {
    return Array.from({ length: Math.max(0, totalScreens) }, function() { return [] as T[]; });
  }
  if (splitItems) {
    const sourceItems = randomize ? shuffleMultiscreenItems(items, random) : items.slice();
    return splitMultiscreenItemsByIndex(sourceItems, totalScreens);
  }
  return Array.from(
    { length: Math.max(0, totalScreens) },
    function() { return randomize ? shuffleMultiscreenItems(items, random) : items.slice(); }
  );
}
