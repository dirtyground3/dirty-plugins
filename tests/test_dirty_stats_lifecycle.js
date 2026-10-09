"use strict";
const assert = require("node:assert/strict");
const {moduleIn} = require("./stats_modules");
async function main() {
  const pending = [], images = [];
  const context = {console, Intl, Image: class {constructor() {images.push(this);}}};
  const settings = moduleIn(context, "settings").createSettings({React: {}, hub: {
    theme: {defaultKey: "classic"}, getPluginSettings: () => new Promise(resolve => pending.push(resolve))
  }});
  const first = settings.loadStatsSettings(), second = settings.loadStatsSettings();
  pending[1]({growthGrouping: "year", unknownSetting: "latest"});
  await second;
  pending[0]({growthGrouping: "day", unknownSetting: "stale"});
  await first;
  assert.equal(settings.statsSettings.growthGrouping, "year", "older configuration loads cannot overwrite newer ones");
  assert.equal(settings.getStatsSettingExtra("unknownSetting", ""), "latest");
  const late = settings.loadStatsSettings();
  settings.dispose();
  pending[2]({growthGrouping: "day", unknownSetting: "destroyed"});
  await late;
  assert.equal(settings.statsSettings.growthGrouping, "year");
  assert.equal(settings.getStatsSettingExtra("unknownSetting", ""), "latest", "destroyed instances ignore late loads");
  const analytics = moduleIn(context, "analytics").createAnalytics({world: {features: []}, themeColor: () => "#fff", statsTheme: () => ({})});
  const logo = analytics.loadStudioImage("/studio/synthetic/image");
  assert.equal(analytics.loadStudioImage("/studio/synthetic/image"), logo, "in-flight studio images are deduplicated");
  assert.equal(images.length, 1);
  assert.equal(typeof images[0].onload, "function");
  analytics.dispose();
  assert.equal(await logo, null);
  assert.equal(images[0].onload, null);
  assert.equal(images[0].onerror, null);
  assert.equal(images[0].src, "", "owned image loads stop during cleanup");
  assert.equal(await analytics.loadStudioImage("/studio/late/image"), null);
  assert.equal(images.length, 1);
  console.log("Stats settings load ordering, destroyed responses and owned studio image cleanup passed");
}
main().catch(error => {console.error(error); process.exitCode = 1;});
