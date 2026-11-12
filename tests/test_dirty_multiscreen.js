"use strict";
const assert = require("node:assert/strict"),
  { requireSource } = require("./plugin_paths");
const SOURCES = {
  context: "src/domain/context.ts",
  contexts: "src/contexts.ts",
  counts: "src/counts.ts",
  items: "src/domain/items.ts",
  layout: "src/domain/layout.ts",
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
function customRows() {
  const custom = requireSource("DirtyMultiscreen", "src/domain/custom.ts");
  const { layoutFromLanes, normalizeLayout, resizeScreen, readingOrder, customRectangles, draggableEdges, dragUnit } =
    custom;
  // R(...) is a row, C(...) a column, a number a screen's pane; "*n" is a size other than 1.
  const shape = node => {
    const size = node.size === 1 ? "" : `*${node.size}`;
    return node.children
      ? `${node.axis === "row" ? "R" : "C"}${size}(${node.children.map(shape).join(" ")})`
      : `${node.pane}${size}`;
  };
  const grid = layoutFromLanes(
    [
      [0, 1],
      [2, 3],
    ],
    [0, 1, 2, 3],
  );
  assert.equal(shape(grid), "C(R(0 1) R(2 3))");
  // A closed screen keeps its place beside the open screen before it.
  assert.equal(
    shape(
      layoutFromLanes(
        [
          [0, 2],
          [3, 4],
        ],
        [1, 0, 2, 5, 3, 4],
      ),
    ),
    "C(R(1 0 2 5) R(3 4))",
  );
  assert.equal(shape(layoutFromLanes([[0], [1, 2]], [0, 1, 2], "row")), "R(0 C(1 2))", "fitted columns");

  // 2 x 2: screen 1 grows over screen 2, which goes down, so three screens share the second row.
  let layout = resizeScreen(grid, [], 0, "right", 1);
  assert.equal(shape(layout), "C(0 R(1 2 3))");
  // Screen 2 then takes its whole row, and the other two go down to a third row.
  layout = resizeScreen(layout, [], 1, "right", 2);
  assert.equal(shape(layout), "C(0 1 R(2 3))");
  // Screen 2 dragged down reaches across the second row; screens 3 and 4 keep their row beside screen 1.
  assert.equal(shape(resizeScreen(grid, [], 1, "bottom", 1)), "R(C(0 R(2 3)) 1)");
  assert.equal(shape(resizeScreen(grid, [], 3, "top", 1)), "R(C(R(0 1) 2) 3)");
  assert.equal(shape(resizeScreen(grid, [], 0, "bottom", 1)), "R(0 C(1 R(2 3)))");
  // Screen 1 of that layout reaches across screen 2's column; screen 2 joins the row of 3 and 4 below it.
  assert.equal(shape(resizeScreen(resizeScreen(grid, [], 1, "bottom", 1), [], 0, "right", 1)), "C(0 R(2 3 1*2))");
  // Further rows join the reach, and dragging back gives them back.
  const three = layoutFromLanes(
    [
      [0, 1],
      [2, 3],
      [4, 5],
    ],
    [0, 1, 2, 3, 4, 5],
  );
  layout = resizeScreen(three, [], 1, "bottom", 1);
  assert.equal(shape(layout), "C(R*2(C(0 R(2 3)) 1) R(4 5))");
  assert.equal(shape(resizeScreen(layout, [], 1, "bottom", 1)), "R(C(0 R(2 3) R(4 5)) 1)");
  assert.equal(shape(resizeScreen(layout, [], 1, "bottom", -1)), shape(three));
  // A screen in the middle of its row makes the row taller, or the next one taller once its own is smallest.
  const wideRows = layoutFromLanes(
    [
      [0, 1, 2],
      [3, 4, 5],
    ],
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(shape(resizeScreen(wideRows, [], 1, "bottom", 1)), "C(R*2(0 1 2) R(3 4 5))");
  assert.equal(shape(resizeScreen(wideRows, [], 1, "bottom", -1)), "C(R(0 1 2) R*2(3 4 5))");
  // A screen with its row to itself makes that row taller.
  assert.equal(shape(resizeScreen(resizeScreen(grid, [], 0, "right", 1), [], 0, "bottom", 1)), "C(0*2 R(1 2 3))");

  // A left edge pushes the screens before it, in reading order; a screen covered in part gets narrower.
  const wide = {
    size: 1,
    axis: "row",
    children: [
      { size: 1, pane: 0 },
      { size: 2, pane: 1 },
      { size: 1, pane: 2 },
    ],
  };
  assert.equal(shape(resizeScreen(wide, [], 2, "left", 1)), "R(0 1 2*2)");
  assert.equal(shape(resizeScreen(wide, [], 2, "left", 3)), "C(2 R(0 1*2))");
  assert.equal(shape(resizeScreen(wide, [], 1, "left", -1)), "R(0 1 2)", "the last row narrows");
  // Shrinking brings screens up from the start of the next row.
  const pulled = {
    size: 1,
    axis: "column",
    children: [
      {
        size: 1,
        axis: "row",
        children: [
          { size: 2, pane: 0 },
          { size: 1, pane: 1 },
        ],
      },
      {
        size: 1,
        axis: "row",
        children: [
          { size: 1, pane: 2 },
          { size: 1, pane: 3 },
        ],
      },
    ],
  };
  assert.equal(shape(resizeScreen(pulled, [], 0, "right", -1)), "C(R(0 2 1) 3)");
  assert.equal(resizeScreen(grid, [], 0, "right", -1), grid, "a screen keeps one unit");
  // Closed screens take no part and return beside the screen before them.
  assert.equal(resizeScreen(grid, [1], 0, "right", 1), grid);
  assert.equal(shape(resizeScreen(grid, [1], 2, "right", 1)), "C(R(0 1) 2 3)");

  assert.deepEqual(readingOrder(layoutFromLanes([[2], [0, 1]], [2, 0, 1, 3]), [3]), [2, 0, 1]);
  const tall = {
    size: 1,
    axis: "column",
    children: [
      { size: 2, pane: 1 },
      {
        size: 1,
        axis: "row",
        children: [
          { size: 1, pane: 0 },
          { size: 2, pane: 2 },
        ],
      },
    ],
  };
  assert.deepEqual(plain(customRectangles(tall, [], 1200, 900)), [
    { left: 0, top: 600, width: 400, height: 300 },
    { left: 0, top: 0, width: 1200, height: 600 },
    { left: 400, top: 600, width: 800, height: 300 },
  ]);
  assert.equal(customRectangles(tall, [1], 1200, 900)[1], undefined, "a closed screen takes no room");
  assert.deepEqual(plain(customRectangles(tall, [1], 1200, 900))[0], { left: 0, top: 0, width: 400, height: 900 });
  assert.deepEqual(plain(customRectangles(resizeScreen(grid, [], 1, "bottom", 1), [], 1200, 900)), [
    { left: 0, top: 0, width: 600, height: 450 },
    { left: 600, top: 0, width: 600, height: 900 },
    { left: 0, top: 450, width: 300, height: 450 },
    { left: 300, top: 450, width: 300, height: 450 },
  ]);
  assert.deepEqual(draggableEdges(tall, [], 1), ["bottom"]);
  assert.deepEqual(draggableEdges(tall, [], 0), ["top", "right"]);
  assert.deepEqual(draggableEdges(tall, [1], 2), ["left"]);
  assert.deepEqual(draggableEdges(resizeScreen(grid, [], 1, "bottom", 1), [], 1), ["left"], "outer edges stay still");
  assert.deepEqual(plain(dragUnit(grid, [], 1, "bottom")), { panes: [0, 1], units: 1 });
  // Unknown and repeated panes go, missing ones join the last row.
  assert.equal(
    shape(
      normalizeLayout(
        {
          size: 1,
          axis: "row",
          children: [
            { size: 1, pane: 5 },
            { size: 2, pane: 1 },
            { size: 1, pane: 1 },
          ],
        },
        3,
      ),
    ),
    "R(1 0 2)",
  );
  assert.equal(shape(normalizeLayout(grid, 5)), "C(R(0 1) R(2 3 4))");
  assert.equal(custom.isCustomLayout(grid), true);
  assert.equal(custom.isCustomLayout([{ height: 1, cells: [] }]), false);

  // Fitted videos keep the layout and their shapes.
  const sixteen = () => 16 / 9;
  assert.deepEqual(plain(customRectangles(layoutFromLanes([[0], [1, 2]], [0, 1, 2]), [], 1600, 1350, 1, sixteen)), [
    { left: 0, top: 0, width: 1600, height: 900 },
    { left: 0, top: 900, width: 800, height: 450 },
    { left: 800, top: 900, width: 800, height: 450 },
  ]);
  // A larger part makes its videos larger; the smaller part is centred.
  const larger = { ...layoutFromLanes([[0], [1, 2]], [0, 1, 2]) };
  larger.children = [larger.children[0], { ...larger.children[1], size: 2 }];
  assert.deepEqual(plain(customRectangles(larger, [], 1600, 900, 1, sixteen)), [
    { left: 400, top: 0, width: 800, height: 450 },
    { left: 0, top: 450, width: 800, height: 450 },
    { left: 800, top: 450, width: 800, height: 450 },
  ]);
  const reached = customRectangles(resizeScreen(grid, [], 1, "bottom", 1), [], 1600, 900, 1, sixteen);
  for (const box of reached) assert.ok(Math.abs(box.width / box.height - 16 / 9) < 0.01, "every video keeps its shape");
}
async function main() {
  const { fitLayout, videoAspect, DEFAULT_ASPECT, FIT_COVERAGE_THRESHOLD } = feature("layout");
  assert.equal(FIT_COVERAGE_THRESHOLD, 0.9);
  assert.deepEqual(fitLayout(Array(4).fill(16 / 9), 1600, 900), [
    { left: 0, top: 0, width: 800, height: 450 },
    { left: 800, top: 0, width: 800, height: 450 },
    { left: 0, top: 450, width: 800, height: 450 },
    { left: 800, top: 450, width: 800, height: 450 },
  ]);
  const portraits = fitLayout(Array(4).fill(1 / 2), 1600, 900);
  assert.equal(new Set(portraits.map(rect => rect.top)).size, 1, "four portraits use one row");
  assert.deepEqual(
    portraits.map(rect => rect.width),
    [400, 400, 400, 400],
  );
  assert.deepEqual(fitLayout([1], 1000, 900), [{ left: 0, top: 0, width: 1000, height: 900 }], "90% stretches");
  assert.deepEqual(fitLayout([1], 1000, 899), [{ left: 51, top: 0, width: 899, height: 899 }], "below 90% centres");
  assert.deepEqual(fitLayout([16 / 9], 1600, 900), [{ left: 0, top: 0, width: 1600, height: 900 }]);
  assert.deepEqual(fitLayout([], 1600, 900), []);
  for (const size of [
    [undefined, undefined],
    [0, 108],
    [-1, 108],
    [192, NaN],
    [Infinity, 108],
  ])
    assert.equal(videoAspect(...size), DEFAULT_ASPECT);
  assert.equal(videoAspect(108, 192), 9 / 16);
  assert.deepEqual(fitLayout([0, NaN, -2, Infinity], 1600, 900), fitLayout(Array(4).fill(DEFAULT_ASPECT), 1600, 900));
  const verifyTiling = (aspects, width, height) => {
    const rectangles = fitLayout(aspects, width, height);
    assert.equal(rectangles.length, aspects.length);
    const right = Math.max(...rectangles.map(rect => rect.left + rect.width));
    const bottom = Math.max(...rectangles.map(rect => rect.top + rect.height));
    const left = Math.min(...rectangles.map(rect => rect.left));
    const top = Math.min(...rectangles.map(rect => rect.top));
    let area = 0;
    rectangles.forEach((rect, index) => {
      for (const value of Object.values(rect)) assert.ok(Number.isInteger(value) && value >= 0);
      assert.ok(rect.left + rect.width <= width && rect.top + rect.height <= height);
      area += rect.width * rect.height;
      for (const other of rectangles.slice(index + 1))
        assert.ok(
          rect.left + rect.width <= other.left ||
            other.left + other.width <= rect.left ||
            rect.top + rect.height <= other.top ||
            other.top + other.height <= rect.top,
          "no overlapping interiors",
        );
    });
    assert.equal(area, (right - left) * (bottom - top), "rounded cells tile the block without gaps");
    assert.ok(Math.abs(left - (width - right)) <= 1 && Math.abs(top - (height - bottom)) <= 1, "centred block");
    return rectangles;
  };
  // Under display scaling every edge falls on a whole device pixel, and neighbours share it exactly.
  for (const ratio of [1.25, 1.5, 1.75]) {
    const scaled = fitLayout([16 / 9, 9 / 16, 4 / 3, 16 / 9, 9 / 16, 1], 1229, 691, ratio);
    const edges = scaled.flatMap(rect => [rect.left, rect.top, rect.left + rect.width, rect.top + rect.height]);
    for (const edge of edges)
      assert.ok(Math.abs(edge * ratio - Math.round(edge * ratio)) < 1e-9, `${edge} at ${ratio}`);
    const rights = new Set(scaled.map(rect => Math.round((rect.left + rect.width) * ratio)));
    const outer = Math.min(...scaled.map(rect => Math.round(rect.left * ratio)));
    for (const rect of scaled)
      assert.ok(
        Math.round(rect.left * ratio) === outer || rights.has(Math.round(rect.left * ratio)),
        "each left edge is another screen's right edge",
      );
  }
  assert.deepEqual(fitLayout([16 / 9], 1600, 900, 0), fitLayout([16 / 9], 1600, 900), "a missing ratio counts as 1");
  customRows();
  const mixedLayout = verifyTiling([16 / 9, 9 / 16, 4 / 3, 16 / 9], 1601, 901);
  assert.ok(new Set(mixedLayout.map(rect => rect.width)).size > 1, "mixed videos have different widths");
  const columnLayout = verifyTiling([0.5, 1, 2, 0.5], 900, 1600);
  assert.equal(columnLayout[0].left, columnLayout[1].left);
  assert.equal(columnLayout[2].left, columnLayout[3].left);
  assert.notEqual(columnLayout[0].width, columnLayout[2].width, "unequal justified columns beat rows");
  for (let count = 1; count <= 36; count++)
    for (const [width, height] of [
      [1601, 901],
      [701, 1203],
      [993, 993],
    ])
      verifyTiling(
        Array.from({ length: count }, (_, index) => [16 / 9, 9 / 16, 4 / 3][index % 3]),
        width,
        height,
      );
  assert.deepEqual(
    a.normalizeSettings({ fitVideos: true }),
    a.normalizeSettings({ fitVideos: false }),
    "fit is absent from query settings",
  );
  assert.equal(a.normalizeFitVideos({}), true, "screens fit their videos by default");
  assert.equal(a.normalizeFitVideos({ fitVideos: "true" }), true);
  assert.equal(a.normalizeFitVideos({ fitVideos: "false" }), false);
  const defaults = a.normalizeSettings({});
  assert.deepEqual(plain(defaults), {
    totalScreens: 4,
    rows: 2,
    columns: 2,
    sceneOrder: "random",
    spreadScenes: true,
    avoidDuplicates: true,
    splitScenes: false,
    startMuted: true,
    randomStart: true,
    loopScenes: true,
    markerDuration: 30,
    pauseWhenHidden: true,
    showPerformerNavigation: true,
  });
  assert.equal(a.normalizeSettings({ showPerformerNavigation: false }).showPerformerNavigation, false);
  // Every cell of the grid plays.
  assert.equal(a.normalizeSettings({ rows: 3, columns: 4 }).totalScreens, 12);
  assert.equal(a.normalizeSettings({ rows: 0, columns: 0 }).totalScreens, 1);
  assert.deepEqual(a.GRID_LIMITS, { rows: 6, columns: 6 });
  const largest = a.normalizeSettings({ rows: 12, columns: 40 });
  assert.deepEqual([largest.rows, largest.columns, largest.totalScreens], [6, 6, 36], "the picker's largest grid");
  assert.equal(
    a.normalizeSettings({ totalScreens: 4, rows: 3, columns: 3 }).totalScreens,
    9,
    "the former stored count no longer limits a larger grid",
  );
  assert.equal(a.normalizeSettings({ rows: 40 }).rows, 6);
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

  const distinct = a.createMultiscreenPlaylists(items, 3, { ...listOrder, distinct: true }, false);
  assert.deepEqual(plain(distinct.map(playlist => playlist.map(item => item.id))), [
    ["a", "b", "c", "d", "e"],
    ["b", "a", "c", "d", "e"],
    ["c", "a", "b", "d", "e"],
  ]);
  assert.deepEqual(
    plain(a.distinctStarts([[{ id: "a" }], [{ id: "a" }]]).map(playlist => playlist[0].id)),
    ["a", "a"],
    "lists without another item keep their first one",
  );
  assert.equal(a.nextFreeIndex(items, 1, new Set(["b", "c"])), 3);
  assert.equal(a.nextFreeIndex(items, 4, new Set(["e"])), -1);
  const featured = [
    ["m1", "s1"],
    ["m2", "s1"],
    ["m3", "s2"],
    ["m4", "s3"],
  ].map(([id, scene]) => ({ id, scene: { id: scene } }));
  assert.equal(a.nextItemAfter(featured, featured[0]).id, "m3", "the playing scene's other markers are skipped");
  assert.equal(a.nextItemAfter(featured, featured[3]).id, "m1", "the list wraps");
  assert.equal(
    a.nextItemAfter(featured, { id: "other", scene: { id: "s9" } }).id,
    "m1",
    "an absent item starts the list",
  );
  assert.equal(a.nextItemAfter(featured.slice(0, 2), featured[0]), null, "only the playing scene matches");
  assert.equal(a.nextItemAfter([], featured[0]), null);
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

  const settings = a.normalizeSettings({});
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
  // Stash's native controls choose a search term, a sort and criteria.
  const rated = { rating100: { value: 60, modifier: "GREATER_THAN" } };
  await sessionQueries.searchSession(
    sceneScope,
    false,
    { find: { q: "  new title  ", sort: "date", direction: "DESC" }, scene: rated },
    2,
    signal,
  );
  assert.deepEqual(plain(searchRequests[0].variables), {
    filter: { q: "original search", page: 2, per_page: 20, sort: "date", direction: "DESC" },
    scene_filter: {
      ...rated,
      title: { value: "(?i)new title", modifier: "MATCHES_REGEX" },
      AND: sceneScope.scene_filter,
    },
  });
  assert.equal(sceneScope.filter.page, 4, "search never mutates playback variables");
  assert.strictEqual(searchRequests[0].options.signal, signal);
  const markerScope = {
    filter: { q: "range" },
    scene_marker_filter: { tags: { value: ["tag"], modifier: "INCLUDES" }, scene_filter: { organized: true } },
  };
  await sessionQueries.searchSession(
    markerScope,
    true,
    { find: { q: "scene", sort: "date" }, scene: { organized: false } },
    1,
    signal,
  );
  assert.match(searchRequests[1].query, /MultiscreenMarkerSearch/);
  assert.deepEqual(plain(searchRequests[1].variables), {
    filter: { q: "range", page: 1, per_page: 20, sort: "title", direction: "ASC" },
    scene_marker_filter: {
      tags: markerScope.scene_marker_filter.tags,
      scene_filter: {
        organized: false,
        title: { value: "(?i)scene", modifier: "MATCHES_REGEX" },
        AND: { organized: true },
      },
    },
  });
  await sessionQueries.searchSession(
    { filter: { page: 3, per_page: 48, sort: "random_1" } },
    false,
    { find: { q: " new " }, scene: {} },
    1,
    signal,
  );
  assert.deepEqual(
    plain(searchRequests[2].variables),
    { filter: { q: "new", page: 1, per_page: 20, sort: "title", direction: "ASC" } },
    "without a session search term, Stash's own search applies",
  );
  await sessionQueries.searchSession(
    { filter: { q: "x" } },
    false,
    { find: { q: " title.*(part)[1]+?^$|\\ " } },
    1,
    signal,
  );
  assert.equal(searchRequests[3].variables.scene_filter.title.modifier, "MATCHES_REGEX");
  const literalSearch = new RegExp(searchRequests[3].variables.scene_filter.title.value.slice(4), "i");
  assert(literalSearch.test("A TITLE.*(PART)[1]+?^$|\\ suffix"));
  assert(!literalSearch.test("A title something else"), "search punctuation cannot become regex operators");

  const performerRequests = searchRequests.length;
  await sessionQueries.findPerformerItems(sceneScope, false, "p1", signal);
  assert.match(searchRequests[performerRequests].query, /MultiscreenPerformerScenes/);
  assert.deepEqual(plain(searchRequests[performerRequests].variables), {
    filter: { q: "original search", page: 1, per_page: -1, sort: "random_123" },
    scene_filter: { performers: { value: ["p1"], modifier: "INCLUDES" }, AND: sceneScope.scene_filter },
  });
  assert.strictEqual(searchRequests[performerRequests].options.signal, signal);
  await sessionQueries.findPerformerItems(markerScope, true, "p1", signal);
  assert.match(searchRequests[performerRequests + 1].query, /MultiscreenPerformerMarkers/);
  assert.deepEqual(plain(searchRequests[performerRequests + 1].variables.scene_marker_filter), {
    tags: markerScope.scene_marker_filter.tags,
    scene_filter: { performers: { value: ["p1"], modifier: "INCLUDES" }, AND: { organized: true } },
  });
  await sessionQueries.findPerformerItems({ filter: {} }, false, "p1", signal);
  assert.deepEqual(plain(searchRequests[performerRequests + 2].variables.scene_filter), {
    performers: { value: ["p1"], modifier: "INCLUDES" },
  });
  assert.throws(
    () => sessionQueries.findPerformerItems({ filter: {}, ids: ["3"] }, false, "p1", signal),
    /searched locally/,
  );

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
  const tagVariables = await a.getSceneQueryVariables(nonRandom, { source: "tag-detail", tagId: "11" });
  assert.equal(tagVariables.filter.sort, "title");
  assert.deepEqual(plain(tagVariables.scene_filter), {
    tags: { value: ["11"], modifier: "INCLUDES", depth: 0 },
  });
  const tagSelectionVariables = await a.getSceneQueryVariables(nonRandom, {
    source: "tag-selection",
    selectedIds: ["11", "12"],
  });
  assert.deepEqual(plain(tagSelectionVariables.scene_filter.tags.value), ["11", "12"]);
  const performerFilterVariables = await a.getSceneQueryVariables(nonRandom, {
    source: "performer-filter",
    filter: { sort: "title" },
    performerFilter: {},
  });
  assert.deepEqual(plain(performerFilterVariables.scene_filter.performers.value), ["p1"]);
  const tagRequests = [];
  const tagQueries = feature("queries").createQueries({
    graphql: async (query, variables) => {
      tagRequests.push({ query, variables });
      return { findTags: { tags: [{ id: "t1" }, { id: "t2" }] } };
    },
  });
  const tagFilterVariables = await tagQueries.getSceneQueryVariables(nonRandom, {
    source: "tag-filter",
    filter: { q: "outdoor", sort: "name" },
    tagFilter: { favorite: true },
  });
  assert.match(tagRequests[0].query, /MultiscreenTags/);
  assert.deepEqual(plain(tagRequests[0].variables), {
    filter: { q: "outdoor", sort: "name", page: 1, per_page: -1 },
    tag_filter: { favorite: true },
  });
  assert.deepEqual(plain(tagFilterVariables.scene_filter), {
    tags: { value: ["t1", "t2"], modifier: "INCLUDES", depth: 0 },
  });

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
    ["tag-list", "/tags", "tag-selection"],
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
  assert.equal(contexts.getLaunchContextForPath("/tags/789"), null);
  contexts.captureDetail("tag-detail", "789");
  assert.deepEqual(plain(contexts.getLaunchContextForPath("/tags/789/markers")), {
    source: "tag-detail",
    tagId: "789",
  });
  assert.equal(contexts.getLaunchContextForPath("/tags/new"), null);

  // Lists announced by other plugins.
  assert.deepEqual(plain(a.normalizeListSettings({})), { allow: "known", limit: 10000 });
  assert.deepEqual(plain(a.normalizeListSettings({ otherPluginLists: "any", listSizeLimit: 5 })), {
    allow: "any",
    limit: 1000,
  });
  assert.deepEqual(plain(a.normalizeListSettings({ otherPluginLists: "all", listSizeLimit: 1e9 })), {
    allow: "known",
    limit: 100000,
  });
  const announcement = {
    version: 1,
    source: "CherryPick",
    path: "/plugins/cherrypick",
    kind: "scenes",
    ids: ["3", "1", "3", "2"],
    keepOrder: true,
    label: "  For you  ",
    unknownField: { ignored: true },
  };
  const parsed = {
    source: "CherryPick",
    path: "/plugins/cherrypick",
    kind: "scenes",
    ids: ["3", "1", "2"],
    keepOrder: true,
    label: "For you",
  };
  assert.deepEqual(plain(a.parseAnnouncement(announcement)), parsed, "a duplicate ID keeps its first position");
  assert.deepEqual(plain(a.parseAnnouncement({ ...announcement, ids: null, keepOrder: undefined, label: undefined })), {
    ...parsed,
    ids: null,
    keepOrder: false,
    label: "",
  });
  for (const malformed of [
    null,
    [],
    { ...announcement, version: 2 },
    { ...announcement, version: "1" },
    { ...announcement, source: " " },
    { ...announcement, path: "plugins/cherrypick" },
    { ...announcement, kind: "images" },
    { ...announcement, ids: undefined },
    { ...announcement, ids: "3" },
    { ...announcement, ids: [3] },
    { ...announcement, ids: ["3", "x"] },
    { ...announcement, keepOrder: "yes" },
    { ...announcement, label: 5 },
  ])
    assert.equal(a.parseAnnouncement(malformed), null, JSON.stringify(malformed));
  const longList = Array.from({ length: 100001 }, (_, index) => String(index));
  assert.equal(a.parseAnnouncement({ ...announcement, ids: longList }).ids.length, 100000);
  assert.equal(a.parseAnnouncement({ ...announcement, label: "x".repeat(90) }).label.length, 80);
  const pluginList = { source: "plugin-list", kind: "markers", ids: [], keepOrder: false, label: "" };
  assert.equal(a.isMultiscreenLaunchContext(pluginList), true, "an empty list is a launch");
  assert.equal(a.isMultiscreenLaunchContext({ ...pluginList, kind: "images" }), false);
  assert.equal(a.isMultiscreenLaunchContext({ ...pluginList, ids: [1] }), false);
  assert.equal(a.isMultiscreenLaunchContext({ ...pluginList, keepOrder: undefined }), false);
  assert.equal(a.isMarkerLaunchContext(pluginList), true);
  assert.equal(a.isMarkerLaunchContext({ ...pluginList, kind: "scenes" }), false);

  const runTimers = () => {
    for (const [id, timer] of [...h.timers]) {
      h.timers.delete(id);
      timer.fn();
    }
  };
  runTimers();
  let notified = 0;
  const unsubscribe = contexts.subscribeToContextChanges(() => notified++);
  const announce = detail => {
    contexts.announce(detail);
    runTimers();
  };
  const listPath = "/plugins/cherrypick",
    known = { allow: "known", limit: 10000 },
    any = { allow: "any", limit: 10000 };
  const ids = (path, settings) => contexts.getLaunchContextForPath(path, settings)?.ids;
  announce(announcement);
  assert.equal(notified, 1);
  assert.deepEqual(plain(contexts.getLaunchContextForPath(listPath, known)), {
    source: "plugin-list",
    kind: "scenes",
    ids: ["3", "1", "2"],
    keepOrder: true,
    label: "For you",
  });
  assert.equal(contexts.getLaunchContextForPath(listPath), null, "lists wait until the settings are known");
  assert.equal(ids("/plugins/other", known), undefined, "a list applies only to its own path");
  assert.equal(ids(listPath, { allow: "off", limit: 10000 }), undefined);
  assert.deepEqual(plain(ids(listPath, { allow: "known", limit: 2 })), ["3", "1"]);
  announce({ ...announcement, label: "For you" });
  assert.equal(notified, 1, "an identical announcement changes nothing");
  announce({ ...announcement, source: "Other", ids: ["9"] });
  assert.equal(notified, 2);
  assert.deepEqual(plain(ids(listPath, known)), ["3", "1", "2"], "an unknown plugin's list is kept but not shown");
  assert.deepEqual(plain(ids(listPath, any)), ["9"], "the most recent list wins");
  announce({ ...announcement, source: "Other", ids: null });
  assert.deepEqual(plain(ids(listPath, any)), ["3", "1", "2"], "a withdrawal restores the previous list");
  announce({ ...announcement, source: "Other", ids: null });
  assert.equal(notified, 3, "withdrawing again changes nothing");
  announce({ ...announcement, ids: [] });
  assert.deepEqual(plain(ids(listPath, known)), [], "an empty list is still a list");
  announce({ ...announcement, ids: null });
  assert.equal(contexts.getLaunchContextForPath(listPath, any), null, "the last withdrawal leaves the page as before");
  for (const path of ["/scenes", "/scenes/markers", "/performers", "/studios/4", "/tags/5/markers"])
    announce({ ...announcement, path });
  assert.equal(notified, 5, "pages Multiscreen reads itself ignore announcements");
  announce({ ...announcement, version: 2 });
  assert.equal(notified, 5, "malformed announcements are dropped");
  unsubscribe();

  const listContext = { source: "plugin-list", kind: "scenes", ids: ["5", "4"], keepOrder: true, label: "" };
  assert.deepEqual(plain(await a.getSceneQueryVariables(defaults, listContext)), {
    filter: { page: 1, per_page: a.getSceneLimit(defaults) },
    list: ["5", "4"],
  });
  assert.equal(await a.getSceneQueryVariables(defaults, { ...listContext, ids: [] }), null);
  assert.deepEqual(plain(a.getMarkerQueryVariables(defaults, { ...listContext, kind: "markers" }).list), ["5", "4"]);
  const callsBeforeCount = h.calls.length;
  assert.equal(await queries.getLiveSceneCount(listContext), 2);
  assert.equal(h.calls.length, callsBeforeCount, "a list is counted without a query");

  // Deleted items are dropped; search and performer buttons scan the library's matching IDs.
  const library = Array.from({ length: 2500 }, (_, index) => ({
    id: String(index + 1),
    title: (index % 2 ? "Odd " : "Even ") + index,
    performers: index % 500 === 0 ? [{ id: "p" }] : [],
  }));
  const byId = new Map(library.map(scene => [scene.id, scene]));
  const listRequests = [];
  const listQueries = feature("queries").createQueries({
    graphql: async (query, variables, options) => {
      listRequests.push({ query, variables, options });
      if (options?.signal?.aborted) throw new Error("aborted");
      if (variables.ids) {
        const missing = variables.ids.find(id => !byId.has(id));
        if (missing) throw new Error(`scene with id ${missing} not found`);
        return { findScenes: { count: variables.ids.length, scenes: variables.ids.map(id => byId.get(id)) } };
      }
      const { q } = variables.filter,
        { performers } = variables.scene_filter;
      const matching = library.filter(scene =>
        q ? scene.title.toLowerCase().includes(q) : scene.performers.some(({ id }) => id === performers.value[0]),
      );
      const { page, per_page: size } = variables.filter;
      return { findScenes: { scenes: matching.slice((page - 1) * size, page * size).map(({ id }) => ({ id })) } };
    },
  });
  const found = await listQueries.findListed(false, ["3", "9999", "1", "8888"]);
  assert.deepEqual(
    found.findScenes.scenes.map(scene => scene.id),
    ["3", "1"],
  );
  assert.equal(listRequests.length, 3, "each deleted item costs one retry");
  assert.deepEqual(plain((await listQueries.findListed(false, ["9999"])).findScenes), { count: 0, scenes: [] });
  const failing = feature("queries").createQueries({
    graphql: async () => {
      throw new Error("scene with id 1 not found; database is locked");
    },
  });
  await assert.rejects(failing.findListed(false, ["2"]), /database is locked/, "other errors are not retried");

  const scope = await listQueries.getSceneQueryVariables(defaults, {
    ...listContext,
    ids: library.map(scene => scene.id).reverse(),
  });
  listRequests.length = 0;
  const searchFor = q => ({ find: { q }, scene: {} });
  const searched = await listQueries.searchSession(scope, false, searchFor("odd"), 2, signal);
  assert.equal(searched.findScenes.count, 1250);
  assert.deepEqual(
    searched.findScenes.scenes.map(scene => scene.id),
    Array.from({ length: 20 }, (_, index) => String(2460 - 2 * index)),
    "results follow the list's order",
  );
  assert.deepEqual(plain(listRequests[0].variables), {
    filter: { page: 1, per_page: feature("queries").ID_PAGE_SIZE, sort: "id", direction: "ASC", q: "odd" },
    scene_filter: {},
  });
  assert.strictEqual(listRequests[0].options.signal, signal);
  assert.equal(listRequests.length, 3, "two pages of matching IDs, then one page of details");
  await listQueries.searchSession(scope, false, searchFor("odd"), 3, signal);
  assert.equal(listRequests.length, 4, "another page of the same search reuses the scan");
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(listQueries.searchSession(scope, false, searchFor("even"), 1, cancelled.signal), /aborted/);
  const beforeEven = listRequests.length;
  await listQueries.searchSession(scope, false, searchFor("even"), 1, signal);
  assert.equal(listRequests.length, beforeEven + 3, "a cancelled scan is not reused");
  const late = await listQueries.searchSession({ ...scope, list: ["2500", "1"] }, false, searchFor("odd"), 1, signal);
  assert.deepEqual(
    late.findScenes.scenes.map(scene => scene.id),
    ["2500"],
  );
  assert.equal(late.findScenes.count, 1, "matches outside the list never count or hide one inside it");
  listRequests.length = 0;
  const sorted = await listQueries.searchSession(
    scope,
    false,
    { find: { q: "odd", sort: "title", direction: "ASC" } },
    1,
    signal,
  );
  assert.deepEqual(plain(listRequests[0].variables.filter), {
    page: 1,
    per_page: feature("queries").ID_PAGE_SIZE,
    sort: "title",
    direction: "ASC",
    q: "odd",
  });
  assert.deepEqual(
    sorted.findScenes.scenes.slice(0, 2).map(scene => scene.id),
    ["2", "4"],
    "a chosen sort orders the list's matches the way Stash returns them",
  );

  listRequests.length = 0;
  const playingScene = id => ({ id, scene: { id } });
  const nextFeaturing = async id =>
    (await listQueries.findPerformerItems(scope, false, "p", signal, playingScene(id))).findScenes.scenes.map(
      scene => scene.id,
    );
  assert.deepEqual(await nextFeaturing("1001"), ["501"], "the performer's next scene in list order");
  assert.deepEqual(await nextFeaturing("1"), ["2001"], "and it wraps");
  assert.deepEqual(
    listRequests.map(request => request.variables.ids?.join() ?? "scan"),
    ["scan", "501", "2001"],
    "one scan, then only the next match loads",
  );
  const markerRequests = [];
  const markerQueries = feature("queries").createQueries({
    graphql: async (query, variables) => {
      markerRequests.push({ query, variables });
      const rows = (variables.ids ?? ["7", "8", "9"]).map(id => ({ id, scene: { id: id === "9" ? "s2" : "s1" } }));
      return { findSceneMarkers: { count: rows.length, scene_markers: rows } };
    },
  });
  const markerList = { filter: { page: 1, per_page: 48 }, list: ["9", "8", "7"] };
  const markerSearch = await markerQueries.searchSession(
    markerList,
    true,
    { find: { q: "scene" }, scene: { organized: true } },
    1,
    signal,
  );
  assert.match(markerRequests[0].query, /MultiscreenMarkerIds/);
  assert.equal(markerRequests[0].variables.filter.q, "scene");
  assert.deepEqual(plain(markerRequests[0].variables.scene_marker_filter), { scene_filter: { organized: true } });
  assert.deepEqual(
    markerSearch.findSceneMarkers.scene_markers.map(marker => marker.id),
    ["9", "8", "7"],
  );
  const beforeUnfiltered = markerRequests.length;
  await markerQueries.searchSession(markerList, true, { find: {}, scene: {} }, 1, signal);
  assert.deepEqual(
    markerRequests.slice(beforeUnfiltered).map(request => request.variables.ids?.join() ?? "scan"),
    ["9,8,7"],
    "with nothing searched or filtered, the list is paged without a scan",
  );
  const nextMarker = await markerQueries.findPerformerItems(markerList, true, "p", signal, {
    id: "marker-8",
    scene: { id: "s1" },
  });
  assert.deepEqual(
    nextMarker.findSceneMarkers.scene_markers.map(marker => marker.id),
    ["9"],
    "other markers of the playing scene are skipped",
  );
  assert.deepEqual(plain(markerRequests.at(-2).variables.scene_marker_filter), {
    scene_filter: { performers: { value: ["p"], modifier: "INCLUDES" } },
  });

  const ordered = a.orderSelected([{ id: "b" }, { id: "a" }, { id: "c" }], ["c", "missing", "a"]);
  assert.deepEqual(
    ordered.map(item => item.id),
    ["c", "a"],
  );
  const emptyQueries = feature("queries").createQueries({
    graphql: async () => ({ findPerformers: { performers: [] }, findStudios: { studios: [] }, findTags: { tags: [] } }),
  });
  for (const [source, key] of [
    ["performer-filter", "performerFilter"],
    ["studio-filter", "studioFilter"],
    ["tag-filter", "tagFilter"],
  ]) {
    const context = { source, filter: {}, [key]: {} };
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
