"use strict";
// Manual exact-scoring comparison. Timings are never regression assertions.
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const { requireSource } = require("./plugin_paths");
const current = requireSource("DirtyRank", "src/domain/scores.ts");
const source = fs.readFileSync("plugins/DirtyRank/src/domain/scores.ts", "utf8");
// Force the stable direct-pair policy for the same populations and evaluator.
const pairSource = source.replace("const MAX_WEIGHT_SPAN = 512", "const MAX_WEIGHT_SPAN = 0");
if (pairSource === source) throw new Error("Could not select direct-pair scoring");
const paired = requireSource("DirtyRank", "cold-paired.ts", {
  contents: pairSource.replace('"../constants"', '"./src/constants"'),
});
const NativeChannel = global.MessageChannel;
let started = 0;
const slices = [];
class MeasuredChannel {
  constructor() {
    const channel = new NativeChannel();
    this.port1 = {
      set onmessage(callback) {
        channel.port1.onmessage = () => {
          started = performance.now();
          callback();
        };
      },
      close: () => channel.port1.close(),
    };
    this.port2 = {
      postMessage: value => {
        slices.push(performance.now() - started);
        channel.port2.postMessage(value);
      },
      close: () => channel.port2.close(),
    };
  }
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function main() {
  const rows = [];
  global.MessageChannel = MeasuredChannel;
  try {
    for (const performers of [250, 1000, 3000, 5000]) {
      const entries = Array.from({ length: performers }, (_, i) => ({
        id: String(i),
        rating: 500 + (i / performers) * 1500,
      }));
      for (const categories of [1, 3]) {
        const pair = [],
          weights = [],
          async = [],
          longest = [];
        for (let sample = 0; sample < 9; sample++) {
          for (const [policy, timings] of [
            [paired, pair],
            [current, weights],
          ]) {
            const start = performance.now();
            for (let category = 0; category < categories; category++) policy.buildCategoryScoreIndex(entries);
            if (sample > 1) timings.push(performance.now() - start);
          }
          slices.length = 0;
          const start = performance.now();
          for (let category = 0; category < categories; category++) {
            started = performance.now();
            await current.buildCategoryScoreIndexAsync(entries);
            slices.push(performance.now() - started);
          }
          if (sample > 1) {
            async.push(performance.now() - start);
            longest.push(Math.max(...slices));
          }
        }
        rows.push({
          performers,
          categories,
          pairedMs: +median(pair).toFixed(3),
          weightsMs: +median(weights).toFixed(3),
          asyncMs: +median(async).toFixed(3),
          longestTaskMs: +median(longest).toFixed(3),
        });
      }
    }
  } finally {
    global.MessageChannel = NativeChannel;
  }
  console.table(rows);
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
