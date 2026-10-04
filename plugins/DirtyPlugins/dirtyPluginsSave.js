// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsSave";
  if (window[INSTANCE_KEY]) return;

  /**
   * Debounce edits and serialize writes. Persistence and conflict policy belong
   * to the caller. Every successful write advances the saved snapshot, even
   * when a newer edit makes its UI feedback obsolete.
   * @template T, R
   * @param {SaveControllerOptions<T, R>} options
   * @returns {SaveController<T, R>}
   */
  function createSaveController(options) {
    var timer = null;
    var generation = 0;
    var disposed = false;
    var chain = Promise.resolve();
    var saved = null;
    var scheduleTimer = options.setTimeout || function (callback, delay) { return window.setTimeout(callback, delay); };
    var clearTimer = options.clearTimeout || function (handle) { window.clearTimeout(handle); };

    function publish(state, message) {
      if (!disposed && options.onStatus) options.onStatus({ state: state, message: message || "" });
    }

    function cancelPending() {
      generation += 1;
      if (timer !== null) clearTimer(timer);
      timer = null;
    }

    /** @param {T} value @param {number} edit */
    function enqueue(value, edit) {
      var write = chain.catch(function () {}).then(function () {
        if (disposed) return null;
        if (edit === generation) publish("saving");
        return Promise.resolve().then(function () { return options.save(value); }).then(function (result) {
          saved = { value: value, result: result };
          if (!disposed && options.onSaved) options.onSaved(value, result, edit === generation);
          if (edit === generation) publish("saved");
          return result;
        }).catch(function (error) {
          if (!disposed && options.onError) options.onError(error, value, edit === generation);
          if (edit === generation) publish("error", error.message || String(error));
          // The next queued edit is allowed to recover from a failed write.
          return null;
        });
      });
      chain = write;
      return write;
    }

    /** @param {T} value */
    function schedule(value) {
      if (disposed) return;
      cancelPending();
      var edit = generation;
      var invalid = options.validate && options.validate(value);
      if (invalid) { publish("invalid", invalid); return; }
      publish("pending");
      timer = scheduleTimer(function () {
        timer = null;
        enqueue(value, edit);
      }, options.delay === undefined ? 350 : options.delay);
    }

    return {
      schedule: schedule,
      cancelPending: cancelPending,
      flush: function () { return chain; },
      saved: function () { return saved; },
      dispose: function () { cancelPending(); disposed = true; },
    };
  }

  window[INSTANCE_KEY] = { createSaveController: createSaveController };
})();
