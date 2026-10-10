"use strict";
// Manual synthetic benchmark; timings are evidence, never test assertions.
const { execFileSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { requireSource } = require("./plugin_paths");
const { requireRankDomain } = require("./rank_modules");
const baseline = process.argv[2];
global.window = { PluginApi: { React: {} }, DirtyPlugins: { react: {} } };
const current = requireRankDomain();
const domains = [["current", current]];
if (baseline) {
  const source = execFileSync("git", ["show", baseline + ":plugins/DirtyRank/src/domain/rank.ts"], { encoding: "utf8" })
    .replaceAll('"../', '"./src/')
    .replace(/from "\.\/(navigation|numbers|settings)"/g, 'from "./src/domain/$1"');
  const old = requireSource("DirtyRank", "benchmark-baseline.ts", { contents: source });
  domains.unshift([baseline, old]);
}
const settings = current.settingsFromConfiguration({ confidenceGoal: "all" });
const rows = [];
for (const count of [250, 1000, 3000, 5000]) {
  const people = Array.from({ length: count }, (_, index) => ({
    id: String(index),
    name: "Person " + index,
    gender: "FEMALE",
    image_path: "/synthetic.svg",
    scene_count: 1,
  }));
  const states = Object.fromEntries(
    people.map((person, index) => [
      person.id,
      {
        revision: 1,
        pools: {
          "appearance|FEMALE": { rating: 500 + (index / count) * 1500, deviation: 300, volatility: 0.06, matches: 1 },
        },
      },
    ]),
  );
  for (const [name, domain] of domains) {
    domain.setOverallReferencePerformers(people);
    const timings = [];
    for (let sample = 0; sample < 7; sample++) {
      domain.applyRatingIndex({ revision: 10000 + count + sample, states });
      const start = performance.now();
      domain.overallCategoryScoreFor(people[0], "appearance", "FEMALE", settings);
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const start = performance.now();
    for (let index = 0; index < 10000; index++)
      domain.overallCategoryScoreFor(people[index % count], "appearance", "FEMALE", settings);
    rows.push({
      domain: name,
      performers: count,
      rebuildMedianMs: +timings[3].toFixed(3),
      warm10000Ms: +(performance.now() - start).toFixed(3),
    });
  }
}
console.table(rows);
