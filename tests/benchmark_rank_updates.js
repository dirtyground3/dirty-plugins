"use strict";
// Compare the same two-person vote with forced rebuilds and retained contribution updates.
// Run in Node's normal realm: timing never appears in regression assertions.
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const { requireSource } = require("./plugin_paths");
const { requireRankDomain } = require("./rank_modules");
global.window = { PluginApi: { React: {} }, DirtyPlugins: { react: {} } };
const domain = requireRankDomain();
// Compare the previous affected-cache invalidation policy against the same evaluator.
// Other categories stay warm in both runs; a full snapshot reset would exaggerate the cost.
const source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyRank/src/domain/rank.ts"), "utf8");
const rebuildSource = source.replace(
  /cache.index = updateCategoryScoreIndex\([\s\S]*?\n\s*\);/,
  "overallCategoryScoreCache.delete(cacheKey);",
);
if (rebuildSource === source) throw new Error("Could not select the affected-cache rebuild policy.");
const rebuild = requireSource("DirtyRank", "benchmark-rebuild.ts", {
  contents: rebuildSource
    .replaceAll('"../', '"./src/')
    .replace(/from "\.\/(scores|navigation|numbers|settings|media)"/g, 'from "./src/domain/$1"'),
});
const settings = domain.settingsFromConfiguration({});
const rows = [];
let revision = 1;
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const count of [250, 1000, 3000, 5000]) {
  const people = Array.from({ length: count }, (_, i) => ({ id: String(i), gender: "FEMALE" }));
  for (const a of [domain, rebuild]) a.setOverallReferencePerformers(people);
  for (const categories of [["appearance"], ["appearance", "performance", "charisma"]]) {
    const states = Object.fromEntries(
      people.map((person, i) => [
        person.id,
        {
          revision,
          pools: Object.fromEntries(
            categories.map((category, offset) => [
              category + "|FEMALE",
              {
                rating: 500 + (i / count) * 1500 + offset * 40,
                deviation: 300,
                volatility: 0.06,
                matches: 1,
              },
            ]),
          ),
        },
      ]),
    );
    const evaluate = a => {
      for (const category of categories) a.overallCategoryScoreFor(people[0], category, "FEMALE", settings);
    };
    const rebuilds = [],
      updates = [];
    const cold = [];
    for (let sample = 0; sample < 9; sample++) {
      revision++;
      for (const a of [domain, rebuild]) {
        a.applyRatingIndex({ revision, states });
        const start = performance.now();
        evaluate(a);
        if (a === domain && sample > 1) cold.push(performance.now() - start);
      }
      // Warm every category, then change only Appearance as a normal category vote does.
      const changes = [people[0], people[Math.floor(count / 2)]].map((person, i) => ({
        id: person.id,
        state: {
          ...states[person.id],
          revision: revision + 1,
          pools: {
            ...states[person.id].pools,
            "appearance|FEMALE": {
              ...states[person.id].pools["appearance|FEMALE"],
              rating: states[person.id].pools["appearance|FEMALE"].rating + (i ? -25 : 25),
            },
          },
        },
      }));
      for (const a of [domain, rebuild]) {
        const start = performance.now();
        a.updatePerformerStates(changes);
        evaluate(a);
        if (sample > 1) (a === domain ? updates : rebuilds).push(performance.now() - start);
      }
      revision++;
    }
    rows.push({
      performers: count,
      categories: categories.length,
      coldMedianMs: +median(cold).toFixed(3),
      rebuildVoteMedianMs: +median(rebuilds).toFixed(3),
      voteMedianMs: +median(updates).toFixed(3),
    });
  }
}
console.table(rows);
