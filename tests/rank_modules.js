"use strict";
const { requireSource, runSource } = require("./plugin_paths");

// Rank's domain modules as one namespace, as the old domain factory returned them.
const DOMAIN = ["navigation", "settings", "matchmaking", "rating", "rank"]
  .map(name => 'export * from "./src/domain/' + name + '";')
  .join("\n");

/** Evaluated in this realm against global.window. */
function requireRankDomain() {
  return requireSource("DirtyRank", "rank-test-domain.ts", { contents: DOMAIN });
}

/** Evaluated in a fresh context with the given globals (such as window). */
function runRankDomain(globals) {
  return runSource("DirtyRank", "rank-test-domain.ts", globals, { contents: DOMAIN });
}

module.exports = { requireRankDomain, runRankDomain };
