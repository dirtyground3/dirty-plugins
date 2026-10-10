"use strict";
const assert = require("node:assert/strict");
const { load } = require("./stats_modules");
async function main() {
  const pending = [],
    images = [];
  const context = {
    console,
    Intl,
    Image: class {
      constructor() {
        images.push(this);
      }
    },
    window: {
      PluginApi: { React: {} },
      DirtyPlugins: {
        theme: { defaultKey: "classic" },
        getPluginSettings: () => new Promise(resolve => pending.push(resolve)),
      },
    },
  };
  const { settings, analytics } = load(context);
  const first = settings.loadStatsSettings(),
    second = settings.loadStatsSettings();
  pending[1]({ growthGrouping: "year", unknownSetting: "latest" });
  await second;
  pending[0]({ growthGrouping: "day", unknownSetting: "stale" });
  await first;
  assert.equal(settings.statsSettings.growthGrouping, "year", "older configuration loads cannot overwrite newer ones");
  assert.equal(settings.getStatsSettingExtra("unknownSetting", ""), "latest");
  const logo = analytics.loadStudioImage("/studio/synthetic/image");
  assert.equal(analytics.loadStudioImage("/studio/synthetic/image"), logo, "in-flight studio images are deduplicated");
  assert.equal(images.length, 1);
  images[0].onload();
  assert.equal(await logo, images[0]);
  console.log("Stats settings load ordering and studio image deduplication passed");
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
