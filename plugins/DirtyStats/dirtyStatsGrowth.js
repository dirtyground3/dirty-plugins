// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyStatsGrowth";
  if (window[INSTANCE_KEY]) return;

  /** @param {number} bytes @returns {string} */
  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    var units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"], unit = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
    return (bytes / Math.pow(1024, unit)).toLocaleString("en", { maximumFractionDigits: 2 }) + " " + units[unit];
  }
  function growthBucket(timestamp, grouping) {
    var date = new Date(timestamp);
    if (grouping === "year") return Date.UTC(date.getUTCFullYear(), 0, 1);
    if (grouping === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return Math.floor(timestamp / 86400000) * 86400000;
  }
  function growthBucketEnd(timestamp, grouping) {
    var date = new Date(timestamp);
    if (grouping === "year") return Date.UTC(date.getUTCFullYear() + 1, 0, 1) - 86400000;
    if (grouping === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 86400000;
    return growthBucket(timestamp, grouping);
  }
  /** @param {Array<*>} scenes @param {number} now @param {string} dateBasis @param {string} grouping @returns {{points: number[][], bytes: number, included: number, excluded: number, invalidFiles: number, invalidDates: number, total: number}} */
  function aggregateGrowth(scenes, now, dateBasis, grouping) {
    dateBasis = dateBasis || "created_at";
    var days = new Map(), seen = new Set(), excluded = 0, invalidFiles = 0, invalidDates = 0, included = 0;
    scenes.forEach(function (scene) {
      if (seen.has(scene.id)) return;
      seen.add(scene.id);
      var sceneDate = dateBasis === "scene_date" ? scene.date : scene.created_at;
      var timestamp = sceneDate ? Date.parse(sceneDate) : NaN;
      if (dateBasis !== "mod_time" && !Number.isFinite(timestamp)) { excluded++; return; }
      var valid = 0, files = new Set();
      (scene.files || []).forEach(function (file) {
        if (file.id != null && files.has(file.id)) return;
        if (file.id != null) files.add(file.id);
        var bytes = file.size == null || file.size === "" ? NaN : Number(file.size);
        if (!Number.isFinite(bytes) || bytes < 0) { invalidFiles++; return; }
        var fileTimestamp = dateBasis === "mod_time" ? (file.mod_time ? Date.parse(file.mod_time) : NaN) : timestamp;
        if (!Number.isFinite(fileTimestamp)) { invalidDates++; return; }
        var day = growthBucket(fileTimestamp, grouping);
        days.set(day, (days.get(day) || 0) + bytes); valid++;
      });
      if (!valid) { excluded++; return; }
      included++;
    });
    var total = 0, points = [];
    Array.from(days.keys()).sort(function (a, b) { return a - b; }).forEach(function (day) { total += days.get(day); points.push([day, total]); });
    if (points.length) {
      points.unshift([growthBucket(points[0][0] - 86400000, grouping), 0]);
      var today = growthBucket(now == null ? Date.now() : now, grouping);
      if (today > points[points.length - 1][0]) points.push([today, total]);
    }
    return { points: points, bytes: total, included: included, excluded: excluded, invalidFiles: invalidFiles, invalidDates: invalidDates, total: seen.size };
  }
  /** @param {Array<*>} scenes @param {string} dateBasis @param {number[] | null} period @returns {Array<*>} */
  function scenesInPeriod(scenes, dateBasis, period) {
    if (!period) return scenes;
    return scenes.filter(function (scene) {
      return (scene.files || []).some(function (file) {
        var value = dateBasis === "mod_time" ? file.mod_time : dateBasis === "scene_date" ? scene.date : scene.created_at;
        var time = value ? Date.parse(value) : NaN;
        var bytes = file.size == null || file.size === "" ? NaN : Number(file.size);
        return Number.isFinite(time) && Number.isFinite(bytes) && bytes >= 0 && time >= period[0] && time < period[1] + 86400000;
      });
    });
  }
  /** @param {number[][]} points @param {number[]} period @returns {number} */
  function periodGrowth(points, period) {
    var before = 0, after = 0;
    points.forEach(function (point) { if (point[0] < period[0]) before = point[1]; if (point[0] <= period[1]) after = point[1]; });
    return after - before;
  }
  /** @param {*} option @returns {number[] | null} */
  function growthDataZoomRange(option) {
    var zoom = option && option.dataZoom && option.dataZoom[0];
    if (!zoom) return null;
    var minimum = Infinity, maximum = -Infinity;
    (option.series || []).forEach(function (series) {
      (series.data || []).forEach(function (point) {
        var coordinates = Array.isArray(point) ? point : point && Array.isArray(point.value) ? point.value : null;
        var value = coordinates ? Number(coordinates[0]) : NaN;
        if (!Number.isFinite(value)) return;
        minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
      });
    });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
    var startValue = zoom.startValue == null || zoom.startValue === "" ? NaN : Number(zoom.startValue);
    var endValue = zoom.endValue == null || zoom.endValue === "" ? NaN : Number(zoom.endValue);
    var start = Math.max(0, Math.min(100, Number.isFinite(Number(zoom.start)) ? Number(zoom.start) : 0));
    var end = Math.max(0, Math.min(100, Number.isFinite(Number(zoom.end)) ? Number(zoom.end) : 100));
    if (!Number.isFinite(startValue)) startValue = minimum + (maximum - minimum) * start / 100;
    if (!Number.isFinite(endValue)) endValue = minimum + (maximum - minimum) * end / 100;
    return [Math.min(startValue, endValue), Math.max(startValue, endValue)];
  }
  /** @param {{included: number, points: number[][], bytes: number}} stats @param {number} capacity @param {number} now @param {number[] | null} period */
  function forecastGrowth(stats, capacity, now, period) {
    var today = growthBucket(now == null ? Date.now() : now, "day");
    if (!(capacity > 0)) return { reason: "Source capacity is unavailable." };
    if (!stats.included || !stats.points.length) return { reason: "No matching content to forecast." };
    if (stats.bytes >= capacity) return { reason: "Matching content already reaches the source capacity." };
    var end = period ? Math.min(period[1], today) : today;
    var start = Math.max(period ? period[0] : today - 365 * 86400000, stats.points[0][0]);
    if (end < start) return { reason: "Select a period before today to calculate a growth rate." };
    var bytes = periodGrowth(stats.points, [start, end]);
    var days = (end - start) / 86400000 + 1;
    var rate = bytes / days;
    if (!(rate > 0)) return { reason: "No growth in the reference period; capacity date cannot be estimated." };
    var reachedAt = today + Math.ceil((capacity - stats.bytes) / rate) * 86400000;
    if (!Number.isFinite(reachedAt) || reachedAt > 8640000000000000) return { reason: "Growth is too slow to estimate a capacity date." };
    return { rate: rate, reachedAt: reachedAt, points: [[today, stats.bytes], [reachedAt, capacity]], start: start, end: end };
  }
  window[INSTANCE_KEY] = {
    formatBytes: formatBytes, growthBucket: growthBucket, growthBucketEnd: growthBucketEnd,
    aggregateGrowth: aggregateGrowth, scenesInPeriod: scenesInPeriod, periodGrowth: periodGrowth,
    growthDataZoomRange: growthDataZoomRange, forecastGrowth: forecastGrowth
  };
})();
