"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runSource } = require("./plugin_paths");
const { createRenderer, element, findAll, text } = require("./ui_harness");

const person = (id, gender = "FEMALE", image_path = "/synthetic.svg") => ({ id, gender, image_path });
const pool = (rating, matches = 1) => ({ rating, matches, deviation: 100, volatility: 0.06 });
const state = (revision, pools) => ({ revision, pools });

function profile() {
  const renderer = createRenderer();
  const people = [
    person("first"),
    person("target"),
    person("tie"),
    person("hidden", "FEMALE", ""),
    person("male", "MALE"),
  ];
  const target = people[1];
  const configuration = {
    includePerformersWithoutImages: false,
    genderBoxes: [
      { id: "FEMALE", name: "Female", genders: ["FEMALE"], enabled: true },
      { id: "BOX-MIXED", name: "Mixed", genders: ["FEMALE", "MALE"], enabled: true },
      { id: "BOX-OFF", name: "Disabled", genders: ["FEMALE"], enabled: false },
    ],
    categories: [
      { name: "Appearance", enabled: true, weight: 1 },
      { name: "Performance", enabled: true, weight: 1 },
      { name: "Unrated", enabled: true, weight: 1 },
      { name: "Disabled", enabled: false, weight: 1 },
    ],
  };
  const pools = {
    "appearance|FEMALE": pool(1000),
    "performance|FEMALE": pool(1300),
    "unrated|FEMALE": pool(1800, 0),
    "disabled|FEMALE": pool(1400),
    "appearance|BOX-MIXED": pool(1100),
    "appearance|BOX-OFF": pool(1400),
  };
  const payload = {
    revision: 1,
    states: {
      target: state(1, pools),
      first: state(1, { "appearance|FEMALE": pool(1500), "performance|FEMALE": pool(900) }),
      tie: state(1, { "appearance|FEMALE": pool(1000) }),
      hidden: state(1, { "appearance|FEMALE": pool(1900) }),
      male: state(1, { "appearance|FEMALE": pool(2000), "appearance|BOX-MIXED": pool(1500) }),
    },
  };
  let queries = 0;
  const errors = [];
  const window = {
    PluginApi: {
      React: { ...renderer.hooks, createElement: element },
      libraries: { ReactRouterDOM: { NavLink: "a" } },
    },
    DirtyPlugins: {
      react: {},
      captureUrl: url => url + "&docsCapture=1",
      getPluginSettings: async () => configuration,
      runPluginOperation: async () => payload,
      graphql: async () => {
        queries++;
        return { findPerformers: { count: people.length, performers: people } };
      },
    },
  };
  const api = runSource(
    "DirtyRank",
    "profile-test.ts",
    { window, console: { error: (...args) => errors.push(args) } },
    {
      contents: ["components/Native", "domain/rank", "domain/settings"]
        .map(name => `export * from "./src/${name}";`)
        .join("\n"),
    },
  );
  let performer = target;
  const render = () => renderer.render(element(api.DirtyRankGauntletLaunch, { performer }));
  const buttons = () => findAll(renderer.tree, node => node.props?.className?.includes("profile-rank-button"));
  return {
    api,
    renderer,
    target,
    configuration,
    pools,
    errors,
    render,
    buttons,
    queries: () => queries,
    flush: () => renderer.flush(render),
    setPerformer: value => {
      performer = value;
      render();
    },
  };
}

test("profile buttons match category leaderboard positions, boxes and capture links", async () => {
  const h = profile();
  h.render();
  assert.equal(h.buttons().length, 0, "no placeholder ranks before loading");
  await h.flush();
  const buttons = h.buttons();
  assert.deepEqual(
    buttons.map(button => text(button)),
    ["Female · Appearance #2", "Female · Performance #1", "Mixed · Appearance #2"],
  );
  assert.deepEqual(
    buttons.map(button => button.props.to),
    [
      "/plugins/dirty-rank-leaderboards/appearance?box=FEMALE&docsCapture=1",
      "/plugins/dirty-rank-leaderboards/performance?box=FEMALE&docsCapture=1",
      "/plugins/dirty-rank-leaderboards/appearance?box=BOX-MIXED&docsCapture=1",
    ],
  );
  const settings = h.api.getOverallSortSettings();
  const standings = h.api.leaderboardData(
    [person("first"), h.target, person("tie"), person("hidden", "FEMALE", ""), person("male", "MALE")],
    "appearance",
    "FEMALE",
    settings,
  ).ranked;
  assert.equal(standings.findIndex(entry => entry.id === h.target.id) + 1, 2);
  assert.match(text(h.renderer.tree), /Start Gauntlet/);
  assert.equal(h.queries(), 1);
  assert.deepEqual(h.errors, []);
  h.renderer.unmount();
});

test("profile ranks react to votes, resets, settings and native performer navigation", async () => {
  const h = profile();
  h.render();
  await h.flush();
  h.api.updatePerformerStates([{ id: "target", state: state(2, { ...h.pools, "appearance|FEMALE": pool(1700) }) }]);
  await h.flush();
  assert.equal(text(h.buttons()[0]), "Female · Appearance #1");
  h.configuration.includePerformersWithoutImages = true;
  h.configuration.genderBoxes[1].enabled = false;
  await h.api.refreshOverallSortSettings();
  await h.flush();
  assert.deepEqual(
    h.buttons().map(button => text(button)),
    ["Appearance #2", "Performance #1"],
  );
  assert.equal(h.queries(), 1, "rank/settings publications reuse the reference population");
  h.setPerformer(person("tie"));
  await h.flush();
  assert.deepEqual(
    h.buttons().map(button => text(button)),
    ["Appearance #4"],
  );
  h.setPerformer(person("unrated"));
  await h.flush();
  assert.equal(h.buttons().length, 0);
  h.setPerformer(h.target);
  h.api.applyRatingIndex({ revision: 3, states: {} });
  await h.flush();
  assert.equal(h.buttons().length, 0, "reset removes the profile ranks");
  assert.match(text(h.renderer.tree), /Start Gauntlet/);
  h.renderer.unmount();
  assert.doesNotThrow(() => h.api.applyRatingIndex({ revision: 4, states: {} }));
});
