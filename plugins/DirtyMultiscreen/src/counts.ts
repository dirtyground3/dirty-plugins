export function createCounts(now: () => number = Date.now) {
  const cache = new Map<string, { count: number; timestamp: number }>();
  return {
    getCachedSceneCount(key: string) { const entry = cache.get(key); return !entry || now() - entry.timestamp > 30000 ? null : entry.count; },
    cacheSceneCount(key: string, count: number) { cache.set(key, { count, timestamp: now() }); if (cache.size > 100) { const oldest = cache.keys().next().value; if (oldest) cache.delete(oldest); } },
    clear() { cache.clear(); },
  };
}
