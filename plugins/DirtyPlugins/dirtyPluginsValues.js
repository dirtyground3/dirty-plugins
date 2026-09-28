// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsValues";
  if (window[INSTANCE_KEY]) return;

  /** @param {*} value @returns {*} */
  function parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return value;
    }
  }

  /** @param {*} value @returns {Record<string, *>} */
  function asObject(value) {
    var parsed = parseMaybeJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  }

  /** @param {*} value @returns {*} */
  function pluginResult(value) {
    var result = parseMaybeJson(value);
    if (result && typeof result === "object" && result.error) throw new Error(String(result.error));
    if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "output")) {
      return parseMaybeJson(result.output);
    }
    return result;
  }

  /** @param {*} value @param {number} fallback @param {number} min @param {number} max @returns {number} */
  function clampInteger(value, fallback, min, max) {
    var next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(next)));
  }

  /** @param {*} value @param {boolean} fallback @returns {boolean} */
  function coerceBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return fallback;
  }

  window[INSTANCE_KEY] = { parseMaybeJson: parseMaybeJson, asObject: asObject, pluginResult: pluginResult, clampInteger: clampInteger, coerceBoolean: coerceBoolean };
})();
