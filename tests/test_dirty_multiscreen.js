"use strict";
const assert = require("node:assert/strict"),
  { requireSource } = require("./plugin_paths");
const SOURCES = {
  context: "src/domain/context.ts",
  contexts: "src/contexts.ts",
  counts: "src/counts.ts",
  items: "src/domain/items.ts",
  order: "src/domain/order.ts",
  playlists: "src/domain/playlists.ts",
  queries: "src/queries.ts",
  settings: "src/domain/settings.ts",
};
const feature = name => requireSource("DirtyMultiscreen", SOURCES[name]);
const { createMultiscreenHarness } = require("./multiscreen_harness");
const h = createMultiscreenHarness(),
  settings = feature("settings"),
  queries = feature("queries").createQueries(h.hub);
const storedValues = h.storage;
global.window = h.window;
const contexts = feature("contexts").createContexts();
const a = {
  ...settings,
  ...queries,
  ...feature("order"),
  ...feature("playlists"),
  ...feature("context"),
  ...feature("items"),
};
const seeded = seed => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const plain = value => JSON.parse(JSON.stringify(value));
async function main() {
  const defaults = a.normalizeSettings({});
  assert.deepEqual(plain(defaults), {
    totalScreens: 4,
    rows: 2,
    columns: 2,
    sceneOrder: "random",
    spreadScenes: true,
    splitScenes: false,
    startMuted: true,
    randomStart: true,
    loopScenes: true,
    markerDuration: 30,
    pauseWhenHidden: true,
  });
  assert.equal(
    a.normalizeSettings({ totalScreens: 6, rows: 2, columns: 2 }).totalScreens,
    4,
    "tiles must not exceed rows x columns",
  );
  assert.equal(a.normalizeSettings({ totalScreens: 99, rows: 3, columns: 3 }).totalScreens, 9);
  assert.equal(a.normalizeSettings({ totalScreens: 0, rows: 0, columns: 40 }).totalScreens, 1);
  assert.equal(a.normalizeSettings({ rows: 40 }).rows, 12);
  assert.equal(a.normalizeSettings({ markerDuration: 10000 }).markerDuration, 600);
  assert.equal(a.normalizeSettings({ sceneOrder: "fresh" }).sceneOrder, "fresh");
  assert.equal(a.normalizeSettings({ sceneOrder: "sideways" }).sceneOrder, "random", "unknown orders fall back");
  assert.equal(a.normalizeSettings({ spreadScenes: "false" }).spreadScenes, false);
  assert.equal(a.normalizeSettings({ pauseWhenHidden: "invalid" }).pauseWhenHidden, true);

  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const listOrder = { order: "list", spread: true, now: 0 },
    randomOrder = { order: "random", spread: false, now: 0 };
  const reused = a.createMultiscreenPlaylists(items, 3, listOrder, false);
  assert.equal(reused.length, 3);
  reused.forEach(playlist => {
    assert.deepEqual(plain(playlist.map(item => item.id)), ["a", "b", "c", "d", "e"]);
  });
  assert.strictEqual(reused[0], items, "non-random unsplit playback shares its immutable source");
  assert.strictEqual(reused[1], items);
  assert.deepEqual(
    items.map(item => item.id),
    ["a", "b", "c", "d", "e"],
    "the source list must stay untouched",
  );

  const split = a.createMultiscreenPlaylists(items, 2, listOrder, true);
  assert.deepEqual(plain(split.map(playlist => playlist.map(item => item.id))), [
    ["a", "c", "e"],
    ["b", "d"],
  ]);
  assert.equal(a.createMultiscreenPlaylists([], 3, randomOrder, true).length, 3);
  assert.deepEqual(
    plain(a.pagePlaylists(items, 3, randomOrder, true, 42, 2)),
    plain(a.pagePlaylists(items, 3, randomOrder, true, 42, 2)),
    "split assignments stay identical when different panes request the page at different times",
  );
  assert.deepEqual(
    plain(
      a
        .pagePlaylists(items, 3, randomOrder, true, 42, 2)
        .flat()
        .map(item => item.id)
        .sort(),
    ),
    items.map(item => item.id),
  );
  assert.deepEqual(plain(a.splitMultiscreenItemsByIndex([1, 2, 3, 4, 5], 3).map(group => group.length)), [2, 2, 1]);
  assert.deepEqual(plain(a.splitMultiscreenItemsByIndex([1, 2], 0)), []);

  const random = Math.random;
  Math.random = () => 0;
  assert.deepEqual(plain(a.shuffleMultiscreenItems(["a", "b", "c"])), ["b", "c", "a"]);
  const shuffledSplit = a.createMultiscreenPlaylists(items, 2, randomOrder, true);
  Math.random = random;
  assert.deepEqual(
    plain(shuffledSplit.map(playlist => playlist.map(item => item.id))),
    [
      ["b", "d", "a"],
      ["c", "e"],
    ],
    "randomized splits must use the shuffled order",
  );

  const clock = Date.parse("2026-10-31T00:00:00Z");
  const daysAgo = days => new Date(clock - days * 86400000).toISOString();
  const scene = (id, fields = {}) => ({ id, scene: { id, ...fields } });
  const leadCounts = (pool, ordering, trials = 400) => {
    const random = seeded(7),
      counts = {};
    for (let trial = 0; trial < trials; trial++) {
      const lead = a.orderMultiscreenItems(pool, ordering, random)[0].id;
      counts[lead] = (counts[lead] || 0) + 1;
    }
    return counts;
  };
  const weighted = order => ({ order, spread: false, now: clock });
  let counts = leadCounts([scene("new", { play_count: 0 }), scene("seen", { play_count: 3 })], weighted("unwatched"));
  assert(counts.new > counts.seen * 20, "unwatched scenes lead about 64x as often as scenes played three times");
  counts = leadCounts(
    [scene("loved", { rating100: 100, o_counter: 2 }), scene("unrated"), scene("low", { rating100: 20 })],
    weighted("favorites"),
  );
  assert(counts.loved > counts.unrated && counts.unrated > (counts.low || 0), "ratings and O counts raise the chance");
  counts = leadCounts(
    [scene("fresh", { created_at: daysAgo(1) }), scene("old", { created_at: daysAgo(120) })],
    weighted("newest"),
  );
  assert(counts.fresh > counts.old * 8, "recently added scenes lead far more often");
  const many = Array.from({ length: 5000 }, (_, index) => ({ id: String(index) }));
  assert.equal(
    new Set(a.weightedShuffle(many, () => -800, seeded(3))).size,
    5000,
    "extreme log weights keep a full permutation",
  );

  const recent = scene("recent", { last_played_at: daysAgo(0.5) });
  const unplayed = Array.from({ length: 9 }, (_, index) => scene("u" + index));
  let position = 0;
  const freshRandom = seeded(11);
  for (let trial = 0; trial < 200; trial++)
    position += a
      .orderMultiscreenItems([recent, ...unplayed], weighted("fresh"), freshRandom)
      .findIndex(item => item.id === "recent");
  assert(position / 200 > 7, "fewer repeats moves a just-played scene towards the end (uniform mean is 4.5)");
  assert(
    a.repeatPenalty([recent, ...unplayed], clock) > a.repeatPenalty([...unplayed, recent], clock),
    "recent plays cost more early",
  );
  assert.equal(a.repeatPenalty(unplayed, clock), 0);

  const performerPool = ["A", "A", "A", "A", "B", "B", "B", "B", "C", "D", "E", "F"].map((performer, index) =>
    scene(String(index), { performers: [{ id: performer }] }),
  );
  const adjacentRepeats = spread => {
    const random = seeded(5);
    let repeats = 0;
    for (let trial = 0; trial < 300; trial++) {
      const ordered = a.orderMultiscreenItems(performerPool, { order: "random", spread, now: clock }, random);
      for (let index = 1; index < ordered.length; index++)
        if (ordered[index].scene.performers[0].id === ordered[index - 1].scene.performers[0].id) repeats++;
    }
    return repeats;
  };
  assert(adjacentRepeats(true) * 3 < adjacentRepeats(false), "spreading rarely plays one performer back to back");
  assert.deepEqual(
    plain(
      a
        .spreadShuffle(performerPool, item => item.scene.performers[0].id, seeded(1))
        .map(item => item.id)
        .sort(),
    ),
    performerPool.map(item => item.id).sort(),
  );

  const groupItems = ["A1", "A2", "B1", "A3", "C1"].map(id => ({ id }));
  assert.deepEqual(
    a.separateGroups(groupItems, item => [item.id[0]], 1).map(item => item.id),
    ["A1", "B1", "A2", "C1", "A3"],
    "separation keeps priority while avoiding a shared group with the previous item",
  );
  assert.deepEqual(
    a.separateGroups([{ id: "A1" }, { id: "A2" }], item => [item.id[0]], 1).map(item => item.id),
    ["A1", "A2"],
    "an unavoidable repeat keeps the priority order",
  );
  assert.deepEqual(a.mixOrders([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1]), [1, 2, 6, 3, 4, 5]);
  const mixed = a.orderMultiscreenItems(
    [scene("top", { rating100: 100, play_count: 9 }), scene("mid", { rating100: 80, play_count: 9 }), scene("new")],
    { order: "mix", spread: true, now: clock },
    seeded(2),
  );
  assert.equal(new Set(mixed.map(item => item.id)).size, 3, "the mix plays each scene once");
  assert.strictEqual(
    a.orderMultiscreenItems(performerPool, { order: "list", spread: true, now: clock }),
    performerPool,
  );

  const settings = a.normalizeSettings({ totalScreens: 4 });
  assert.equal(a.getSceneLimit(settings), 48);
  assert.equal(a.getSceneLimit(Object.assign({}, settings, { splitScenes: true })), 32);
  assert.equal(a.getSceneLimit(Object.assign({}, settings, { totalScreens: 30 })), 240);
  assert.match(a.playbackSort("random", "title", 7).sort, /^random_7$/);
  assert.match(a.playbackSort("unwatched", "title", 7).sort, /^random_7$/, "weighted orders sample at random");
  assert.deepEqual(plain(a.playbackSort("newest", "title", 7)), { sort: "created_at", direction: "DESC" });
  assert.deepEqual(plain(a.playbackSort("list", "date", 7)), { sort: "date" });
  assert.deepEqual(plain(a.playbackSort("list", "random", 7)), { sort: "random_7" });
  assert.deepEqual(plain(a.getPlaybackSettings(settings)), {
    startMuted: true,
    randomStart: true,
    loop: true,
    pauseWhenHidden: true,
  });

  assert.equal(a.isMultiscreenLaunchContext(null), false);
  assert.equal(a.isMultiscreenLaunchContext({}), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "selection", selectedIds: ["1"] }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "selection", selectedIds: [] }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "selection", selectedIds: [1] }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "filter", filter: {}, sceneFilter: {} }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "filter", filter: {} }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "performer-detail", performerId: "5" }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "performer-detail" }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "marker-filter", filter: {}, markerFilter: {} }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "marker-filter", filter: {} }), false);

  const streamScene = { id: "1", title: "  ", paths: { stream: "/stream/1" } };
  const fallbackScene = { id: "2", title: "Fallback", sceneStreams: [{ url: "" }, { url: "/stream/2" }] };
  const noStreamScene = { id: "3", title: "Nope", sceneStreams: [] };
  assert.equal(a.getSceneStreamUrl(streamScene), "/stream/1");
  assert.equal(
    a.getSceneStreamUrl({ paths: { stream: "/direct" }, sceneStreams: [{ url: "/fallback" }] }),
    "/direct",
    "the direct stream path must win over scene streams",
  );
  assert.equal(a.getSceneStreamUrl(fallbackScene), "/stream/2");
  assert.equal(a.getSceneStreamUrl(noStreamScene), "");
  assert.deepEqual(plain(a.getSceneItem(streamScene)), { id: "1", title: "Scene 1", scene: streamScene });
  assert.equal(a.getSceneItem(noStreamScene), null);

  const marker = {
    id: "10",
    title: "",
    seconds: 10,
    end_seconds: null,
    primary_tag: { name: "Tag" },
    scene: streamScene,
  };
  assert.deepEqual(plain(a.getMarkerItem(marker, 30)), {
    id: "marker-10",
    title: "Tag",
    playbackRange: { start: 10, end: 40 },
    scene: streamScene,
  });
  assert.deepEqual(plain(a.getMarkerItem(Object.assign({}, marker, { end_seconds: 5 }), 30).playbackRange), {
    start: 10,
    end: 40,
  });
  assert.deepEqual(plain(a.getMarkerItem(Object.assign({}, marker, { end_seconds: 25 }), 30).playbackRange), {
    start: 10,
    end: 25,
  });
  assert.equal(a.getMarkerItem(Object.assign({}, marker, { title: " Named " }), 30).title, "Named");
  assert.equal(a.getMarkerItem(Object.assign({}, marker, { scene: noStreamScene }), 30), null);

  const nonRandom = a.normalizeSettings({ sceneOrder: "list" });
  assert.deepEqual(
    plain(a.getMarkerQueryVariables(defaults, { source: "marker-selection", selectedIds: ["1", "2"] })),
    {
      ids: ["1", "2"],
      filter: { page: 1, per_page: -1 },
    },
  );
  const markerVariables = a.getMarkerQueryVariables(nonRandom, {
    source: "marker-filter",
    filter: { sort: "created_at" },
    markerFilter: { tag: "x" },
  });
  assert.deepEqual(plain(markerVariables), {
    filter: { sort: "created_at", page: 1, per_page: a.getSceneLimit(nonRandom) },
    scene_marker_filter: { tag: "x" },
  });
  assert.match(
    a.getMarkerQueryVariables(defaults, { source: "marker-filter", filter: {}, markerFilter: {} }).filter.sort,
    /^random_\d+$/,
  );

  const selectionVariables = await a.getSceneQueryVariables(defaults, { source: "selection", selectedIds: ["3"] });
  assert.deepEqual(plain(selectionVariables), { ids: ["3"], filter: { page: 1, per_page: -1 } });

  const filterVariables = await a.getSceneQueryVariables(nonRandom, {
    source: "filter",
    filter: { sort: "created_at", page: 4, per_page: 20 },
    sceneFilter: { favorite: true },
  });
  assert.deepEqual(plain(filterVariables), {
    filter: { sort: "created_at", page: 1, per_page: a.getSceneLimit(nonRandom) },
    scene_filter: { favorite: true },
  });
  assert.match(
    (await a.getSceneQueryVariables(defaults, { source: "filter", filter: {}, sceneFilter: {} })).filter.sort,
    /^random_\d+$/,
  );
  assert.match(
    (await a.getSceneQueryVariables(nonRandom, { source: "filter", filter: { sort: "random" }, sceneFilter: {} }))
      .filter.sort,
    /^random_\d+$/,
    "native unseeded random order gets one seed for complete continuation",
  );

  const defaultVariables = await a.getSceneQueryVariables(defaults, null);
  assert.deepEqual(plain(defaultVariables), {
    filter: { page: 1, per_page: a.getSceneLimit(defaults), sort: defaultVariables.filter.sort },
  });
  assert.match(defaultVariables.filter.sort, /^random_\d+$/);
  const newestVariables = await a.getSceneQueryVariables(a.normalizeSettings({ sceneOrder: "newest" }), {
    source: "filter",
    filter: { sort: "title", direction: "ASC" },
    sceneFilter: {},
  });
  assert.equal(newestVariables.filter.sort, "created_at");
  assert.equal(newestVariables.filter.direction, "DESC", "newest overrides the list direction");

  const searchRequests = [];
  const sessionQueries = feature("queries").createQueries({
    graphql: async (query, variables, options) => {
      searchRequests.push({ query, variables, options });
      return {};
    },
  });
  const signal = new AbortController().signal;
  const sceneScope = {
    filter: { q: "original search", page: 4, per_page: 240, sort: "random_123" },
    scene_filter: { OR: { title: { value: "old title", modifier: "INCLUDES" } }, organized: true },
  };
  await sessionQueries.searchSession(sceneScope, false, "  new title  ", 2, signal);
  assert.deepEqual(plain(searchRequests[0].variables), {
    filter: { q: "original search", page: 2, per_page: 20, sort: "title", direction: "ASC" },
    scene_filter: { title: { value: "(?i)new title", modifier: "MATCHES_REGEX" }, AND: sceneScope.scene_filter },
  });
  assert.equal(sceneScope.filter.page, 4, "search never mutates playback variables");
  assert.strictEqual(searchRequests[0].options.signal, signal);
  const markerScope = {
    filter: { q: "range" },
    scene_marker_filter: { tags: { value: ["tag"], modifier: "INCLUDES" }, scene_filter: { organized: true } },
  };
  await sessionQueries.searchSession(markerScope, true, "scene", 1, signal);
  assert.match(searchRequests[1].query, /MultiscreenMarkerSearch/);
  assert.deepEqual(plain(searchRequests[1].variables), {
    filter: { q: "range", page: 1, per_page: 20, sort: "title", direction: "ASC" },
    scene_marker_filter: {
      tags: markerScope.scene_marker_filter.tags,
      scene_filter: { title: { value: "(?i)scene", modifier: "MATCHES_REGEX" }, AND: { organized: true } },
    },
  });
  assert.throws(
    () => sessionQueries.searchSession({ filter: {}, ids: ["3"] }, false, "other", 1, signal),
    /searched locally/,
  );
  assert.equal(searchRequests.length, 2, "selected-ID searches cannot bypass session filtering through Stash");
  await sessionQueries.searchSession({ filter: {} }, false, " title.*(part)[1]+?^$|\\ ", 1, signal);
  assert.equal(searchRequests[2].variables.scene_filter.title.modifier, "MATCHES_REGEX");
  const literalSearch = new RegExp(searchRequests[2].variables.scene_filter.title.value.slice(4), "i");
  assert(literalSearch.test("A TITLE.*(PART)[1]+?^$|\\ suffix"));
  assert(!literalSearch.test("A title something else"), "search punctuation cannot become regex operators");

  const performerVariables = await a.getSceneQueryVariables(nonRandom, {
    source: "performer-detail",
    performerId: "7",
  });
  assert.equal(performerVariables.filter.sort, "title");
  assert.equal(performerVariables.filter.per_page, a.getSceneLimit(nonRandom));
  assert.deepEqual(plain(performerVariables.scene_filter), {
    performers: { value: ["7"], modifier: "INCLUDES" },
  });
  const studioVariables = await a.getSceneQueryVariables(nonRandom, { source: "studio-detail", studioId: "9" });
  assert.deepEqual(plain(studioVariables.scene_filter), {
    studios: { value: ["9"], modifier: "INCLUDES", depth: 0 },
  });
  const performerFilterVariables = await a.getSceneQueryVariables(nonRandom, {
    source: "performer-filter",
    filter: { sort: "title" },
    performerFilter: {},
  });
  assert.deepEqual(plain(performerFilterVariables.scene_filter.performers.value), ["p1"]);

  const launchContext = { source: "selection", selectedIds: ["1", "2"] };
  contexts.storeLaunchContext(launchContext);
  assert.deepEqual(plain(contexts.readLaunchContext()), launchContext);
  contexts.storeLaunchContext(null);
  assert.equal(contexts.readLaunchContext(), null);
  storedValues.set("multiscreen.launchContext", "{not json");
  assert.equal(contexts.readLaunchContext(), null, "corrupt launch context JSON must be ignored");
  storedValues.set("multiscreen.launchContext", JSON.stringify({ source: "selection", selectedIds: [] }));
  assert.equal(contexts.readLaunchContext(), null, "invalid launch contexts must be ignored");

  for (const [key, path, source] of [
    ["scene-list", "/scenes", "selection"],
    ["marker-list", "/scenes/markers", "marker-selection"],
    ["performer-list", "/performers", "performer-selection"],
    ["studio-list", "/studios", "studio-selection"],
  ]) {
    contexts.captureList(key, {
      filter: {
        makeFindFilter: () => ({ page: 2, per_page: 24, sort: "title" }),
        makeFilter: () => ({ favorite: true }),
      },
      selectedIds: new Set(["off-page", "5"]),
    });
    assert.deepEqual(plain(contexts.getLaunchContextForPath(path)), { source, selectedIds: ["off-page", "5"] });
    contexts.captureList(key, {
      filter: {
        makeFindFilter: () => ({ page: 2, per_page: 24, sort: "title" }),
        makeFilter: () => ({ favorite: true }),
      },
      selectedIds: new Set(),
    });
    assert.equal(contexts.getLaunchContextForPath(path).filter.page, undefined);
  }
  assert.equal(contexts.getLaunchContextForPath("/performers/123"), null);
  contexts.captureDetail("performer-detail", "123");
  assert.deepEqual(plain(contexts.getLaunchContextForPath("/performers/123")), {
    source: "performer-detail",
    performerId: "123",
  });
  assert.equal(contexts.getLaunchContextForPath("/performers/456"), null);
  contexts.captureDetail("studio-detail", "456");
  assert.deepEqual(plain(contexts.getLaunchContextForPath("/studios/456")), {
    source: "studio-detail",
    studioId: "456",
  });
  const ordered = a.orderSelected([{ id: "b" }, { id: "a" }, { id: "c" }], ["c", "missing", "a"]);
  assert.deepEqual(
    ordered.map(item => item.id),
    ["c", "a"],
  );
  const emptyQueries = feature("queries").createQueries({
    graphql: async () => ({ findPerformers: { performers: [] }, findStudios: { studios: [] } }),
  });
  for (const source of ["performer-filter", "studio-filter"]) {
    const context = { source, filter: {}, [source === "performer-filter" ? "performerFilter" : "studioFilter"]: {} };
    assert.equal(await emptyQueries.getSceneQueryVariables(defaults, context), null);
    assert.equal(await emptyQueries.getLiveSceneCount(context), 0);
  }
  assert.equal(await queries.getLiveSceneCount({ source: "selection", selectedIds: ["x", "y"] }), 2);
  let now = 0;
  const cache = feature("counts").createCounts(() => now);
  cache.cacheSceneCount("empty", 0);
  assert.equal(cache.getCachedSceneCount("empty"), 0);
  now = 30001;
  assert.equal(cache.getCachedSceneCount("empty"), null);
  for (let i = 0; i < 101; i++) cache.cacheSceneCount(String(i), i);
  assert.equal(cache.getCachedSceneCount("0"), null);
  assert.equal(cache.getCachedSceneCount("100"), 100);
  cache.clear();
  assert.equal(cache.getCachedSceneCount("100"), null);
  delete global.window;
  console.log("DirtyMultiscreen settings, playlists, items, queries, contexts and cache modules passed");
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
