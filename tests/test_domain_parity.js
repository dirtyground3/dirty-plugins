"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { domainAlgorithms } = require("./domain_fixtures");
const fixture = JSON.parse(fs.readFileSync("tests/fixtures/domain-parity.json", "utf8"));
const { rank, compactor } = domainAlgorithms();
const plain = value => JSON.parse(JSON.stringify(value));
for (const example of fixture.rank) {
  const normalized = plain(rank.settingsFromConfiguration(example.input));
  const actual = Object.fromEntries(Object.keys(example.expected).map(key => [key, normalized[key]]));
  assert.deepEqual(actual, example.expected, example.name);
}
for (const example of fixture.compactor) {
  const size = compactor.outputSize(example.width, example.height, example.rule);
  assert.deepEqual(plain(size), example.expected.size, example.name);
  const bitrate = compactor.targetMbps(example.rule, ...size, example.fps, example.sourceBitrate);
  assert(Math.abs(bitrate - example.expected.mbps) < 0.000001, example.name + " bitrate");
}
for (const example of fixture.presets) {
  assert.equal(compactor.visualPreset(example.vmaf), example.preset);
  assert.equal(compactor.CRF[example.codec][example.preset], example.crf);
}
console.log("Shared Rank defaults/legacy/boundaries and Compactor resize/bitrate/preset fixtures passed in JavaScript");
