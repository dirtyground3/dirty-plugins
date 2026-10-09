"use strict";
const assert = require("node:assert/strict");
const {testModulePath} = require("./plugin_paths");
const a = require(testModulePath("DirtyCompactor", "rules.cjs"));
const rule = a.newRule();
assert.equal(rule.enabled, false);
assert.equal(rule.mode, "manual");
assert.equal(rule.format, "keep");
assert.equal(rule.quality, "balanced", "new rules use a quality preset instead of a raw bitrate");
assert.equal(a.validation({ rules: [rule] }), "");
rule.enabled = true;
assert.match(a.validation({ rules: [rule] }), /filter/);
rule.condition.all = true;
assert.equal(a.validation({ rules: [rule] }), "");
rule.mbps = "bad";
assert.equal(a.validation({ rules: [rule] }), "", "presets ignore the hidden custom bitrate");
rule.quality = "custom";
assert.match(a.validation({ rules: [rule] }), /bitrate/);
rule.mbps = 4;
delete rule.quality;
assert.equal(a.validation({ rules: [rule] }), "", "rules saved before presets keep their custom bitrate");
assert.equal(a.targetMbps({ quality: "balanced", codec: "h264" }, 1920, 1080), 5);
assert.equal(a.targetMbps({ quality: "balanced", codec: "hevc" }, 3840, 2160), 8.49);
assert.equal(a.targetMbps({ quality: "small", codec: "hevc" }, 854, 480), 0.53);
assert.equal(a.targetMbps({ quality: "custom", mbps: "2.5", codec: "h264" }, 3840, 2160), 2.5);
assert.equal(a.targetMbps({ quality: "balanced", codec: "h264" }, 1920, 1080, 60), 7.07, "matches the backend's frame-rate factor");
assert.equal(a.targetMbps({ quality: "source", codec: "hevc" }, 1920, 1080, 30, 7500000), 7.5);
assert.equal(a.actionSummary({ action: "reencode", codec: "hevc", quality: "source" }), "Reencode · H.265 · same bitrate");
const rulesApi = a;
assert.equal(rulesApi.timeLeft(45), "less than a minute left");
assert.equal(rulesApi.timeLeft(25 * 60 + 10), "about 25 min left");
assert.equal(rulesApi.timeLeft(3 * 3600 + 5 * 60), "about 3 h 5 min left");
assert.equal(rulesApi.timeLeft(2 * 3600), "about 2 h left");
const hd = { size: 100e6, duration: 100, width: 1920, height: 1080, bit_rate: 50e6, frame_rate: 30 };
const balanced = { action: "reencode", codec: "h264", quality: "balanced" };
assert.equal(Math.round(rulesApi.fileSaving(balanced, hd)), 34618000, "5 Mbps video + typical audio, with the planner's 2% margin");
assert.equal(rulesApi.fileSaving(balanced, Object.assign({}, hd, { bit_rate: 4e6 })), 0, "already below target");
assert.equal(rulesApi.fileSaving({ action: "resize", width: 1920, height: 1080, codec: "h264", quality: "balanced" }, hd), 0, "already within the resolution");
assert(rulesApi.fileSaving({ action: "resize", width: 1280, height: 720, codec: "h264", quality: "balanced" }, hd) > 34618000);
assert.equal(rulesApi.fileSaving({ action: "reencode", codec: "hevc", quality: "source" }, hd), 0, "conversions are not counted as savings");
assert.equal(rulesApi.fileSaving({ action: "delete" }, hd), 100e6);
assert.equal(JSON.stringify(rulesApi.outputSize(1080, 1920, { action: "resize", width: 1280, height: 720 })), "[720,1280]", "portrait keeps orientation");
const sampled = rulesApi.estimate(balanced, { count: 10, filesize: 1e9, scenes: [{ files: [hd, Object.assign({}, hd, { bit_rate: 3e6 })] }] });
assert.equal(Math.round(sampled.saved), 173090000, "sample savings scale to the filter's total size");
assert.equal(sampled.targetMbps, 5, "averages only files that would shrink");
assert.equal(Math.round(sampled.sourceMbps * 1000), 49872, "video bitrate excludes the typical audio track");
assert.equal(rulesApi.fileBitrates({ action: "resize", width: 1280, height: 720, codec: "h264", quality: "custom", mbps: 20 }, hd).target, 20);
assert.equal(rulesApi.fileBitrates({ action: "resize", width: 1280, height: 720, codec: "h264", quality: "custom", mbps: 60 }, hd), null, "never above the original");
assert.equal(sampled.exact, false);
assert.equal(JSON.stringify(rulesApi.qualities("resize").map(item => item[0])), JSON.stringify(["high", "balanced", "small", "visual", "custom"]), "Resize cannot keep the source bitrate");
const visual = Object.assign(a.newRule(), { action: "reencode", quality: "visual", vmaf: 95, condition: { all: true } });
assert.equal(a.validation({ rules: [visual] }), "");
assert.match(a.validation({ rules: [Object.assign({}, visual, { vmaf: 80 })] }), /visual quality target/);
assert.equal(a.actionSummary(visual), "Reencode · H.264 · visual match VMAF 95");
assert.equal(a.targetMbps(Object.assign({}, visual, { vmaf: 97 }), 1920, 1080), 8, "visual estimates follow the nearest preset");
assert.match(rulesApi.qualityHint({ action: "reencode", codec: "hevc", quality: "balanced" }), /^Constant quality \(CRF 24\)/);
assert.match(rulesApi.qualityHint(visual), /When the run reaches each video/, "quality is measured during the run");
assert(rulesApi.qualities("reencode").some(item => item[0] === "source"));
assert.equal(rulesApi.normalize({ rules: [{ id: "r", action: "resize", quality: "source" }] }).rules[0].quality, "balanced", "saved Resize rules move to a preset");
assert.equal(rulesApi.normalize({ rules: [{ id: "r", action: "reencode", quality: "source" }] }).rules[0].quality, "source");
assert.equal(rulesApi.estimate({ action: "delete" }, { count: 10, filesize: 5e9, scenes: [] }).saved, 5e9, "delete frees the whole filter exactly");
assert.equal(a.actionSummary({ action: "resize", width: 1280, height: 720, codec: "hevc", quality: "small" }), "Resize · max 720p · H.265 · smallest files");
assert.equal(a.actionSummary({ action: "reencode", codec: "h264", quality: "custom", mbps: 3 }), "Reencode · H.264 · 3 Mbps");
rule.width = "";
assert.match(a.validation({ rules: [rule] }), /Dimensions/);
rule.action = "reencode";
assert.equal(a.validation({ rules: [rule] }), "", "reencode does not use hidden resize dimensions");
assert.equal(a.filterSummary({ all: true }), "All scenes");
// Mirrors Stash's ListFilterModel.getEncodedParams: braces become parentheses
// outside strings, then the criterion is URI-encoded as one c= parameter.
function stashQuery(criteria) {
  return criteria.map(criterion => {
    let quoted = false, escaped = false;
    const json = [...JSON.stringify(criterion)].map(c => {
      if (escaped) { escaped = false; return c; }
      if (c === "\\" && quoted) escaped = true;
      else if (c === "\"") quoted = !quoted;
      else if (!quoted && c === "{") return "(";
      else if (!quoted && c === "}") return ")";
      return c;
    }).join("");
    let encoded = encodeURI(json);
    for (const c of "?#&;=+") encoded = encoded.replaceAll(c, encodeURIComponent(c));
    return "c=" + encoded;
  }).join("&") + "&sortby=date";
}
const labelled = { query: stashQuery([
  { type: "tags", modifier: "INCLUDES_ALL", value: { items: [{ id: "1", label: "Outdoor (sunny)" }, { id: "2", label: "B&W" }], excluded: [{ id: "3", label: "Amateur" }], depth: 0 } },
  { type: "resolution", modifier: "GREATER_THAN", value: "1080p" },
  { type: "rating100", modifier: "LESS_THAN", value: { value: 50 } },
  { type: "duration", modifier: "BETWEEN", value: { value: 90, value2: 3725 } },
  { type: "organized", value: "false" },
  { type: "path", modifier: "MATCHES_REGEX", value: "\\.wmv$" },
  { type: "performers", modifier: "IS_NULL" },
]), scene: { tags: {} }, find: { q: "beach" } };
assert.equal(a.filterSummary(labelled), "Search “beach” · Tags: all of Outdoor (sunny), B&W, not Amateur · Resolution > 1080p · " +
  "Rating < 2.5 stars · Duration between 1:30 and 1:02:05 · Organized: no · Path matches “\\.wmv$” · Performers is empty");
assert.equal(a.filterSummary(labelled, true).split(" · ")[1], "Tags: all of 2 tags, not 1 tag", "documentation capture hides names");
assert.equal(a.filterSummary({ scene: { resolution: { value: "FOUR_K", modifier: "EQUALS" }, rating100: { value: 20, modifier: "LESS_THAN" },
  studios: { value: ["4", "5"], modifier: "INCLUDES", depth: 0 }, organized: true } }),
"Resolution = 4K · Rating < 1 star · Studio: 2 studios · Organized: yes", "scene filters without a saved query still read naturally");
assert.equal(a.bytes(1024), "1.00 KiB");

const {createAutomationMonitor} = require(testModulePath("DirtyCompactor", "automation.cjs"));
let subscription = {data: {jobsSubscribe: {type: "REMOVE"}}}, watched, queued, notification;
const monitor = createAutomationMonitor({
  api: {GQL: {useJobsSubscribeSubscription: () => subscription}}, useRef() {}, useEffect() {},
  hub: {createJobHook: () => (event, complete, fail, kind) => {watched = {event, complete, fail, kind};},
    ui: {notify: value => {notification = value;}}},
  operation: async (mode, args) => {queued = {mode, args};},
});
assert.equal(monitor(), null);
assert.equal(watched.event, subscription.data.jobsSubscribe);
assert.equal(watched.kind, "scan");
watched.fail(Error("fixture failure"));
assert.match(notification, /could not queue automation: fixture failure/);
const absent = createAutomationMonitor({api: {}, hub: {createJobHook: () => () => {throw Error("unexpected job hook");}}});
assert.equal(absent(), null, "hosts without a jobs subscription keep automation inert");
watched.complete({jobId: "10", startTime: "2026-10-04T09:00:00Z"}).then(() => {
  assert.deepEqual(queued, {mode: "startAutomaticRun", args: {jobId: "10", startTime: "2026-10-04T09:00:00Z"}});
  console.log("DirtyCompactor typed rules, injectable automation modules and domain parity passed");
}).catch(error => {console.error(error); process.exitCode = 1;});
