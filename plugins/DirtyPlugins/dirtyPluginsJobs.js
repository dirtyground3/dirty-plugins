// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsJobs";
  if (window[INSTANCE_KEY]) return;

  /** @param {StashJobEvent | null | undefined} event @returns {CompletedJob | null} */
  function completedJob(event) {
    var job = event && event.job;
    if (!job || event.type !== "REMOVE" || job.status !== "FINISHED" || !job.id || !job.startTime) return null;
    /** @type {CompletedJob['kind'] | null} */
    var kind = job.description === "Scanning..." ? "scan" : job.description === "Generating..." ? "generate" : null;
    if (!kind) return null;
    var jobId = String(job.id), startTime = job.startTime;
    return { kind: kind, jobId: jobId, startTime: startTime, key: JSON.stringify([kind, jobId, startTime]) };
  }

  /** @param {number=} capacity */
  function createReplayTracker(capacity) {
    var limit = Math.max(1, Math.floor(capacity || 50)), keys = [];
    return {
      /** @param {string} key @returns {boolean} */
      claim: function (key) {
        if (keys.indexOf(key) >= 0) return false;
        keys.push(key);
        if (keys.length > limit) keys.splice(0, keys.length - limit);
        return true;
      },
      /** Failed queueing releases the local claim so the completion can retry. @param {string} key */
      release: function (key) { keys = keys.filter(function (item) { return item !== key; }); }
    };
  }
  /** @param {Pick<NativeReactHooks, 'useRef' | 'useEffect'>} React */
  function createJobHook(React) {
    /** @param {StashJobEvent | null | undefined} event @param {JobCompletionHandler} handle @param {(error: Error) => void} onError @param {CompletedJob['kind']=} kind */
    return function useCompletedJob(event, handle, onError, kind) {
      var seen = React.useRef(null), job = event && event.job;
      if (!seen.current) seen.current = createReplayTracker();
      React.useEffect(function () {
        var completion = completedJob(event);
        if (!completion || (kind && completion.kind !== kind) || !seen.current.claim(completion.key)) return;
        handle(completion).catch(function (error) {
          seen.current.release(completion.key);
          onError(error);
        });
      }, [event && event.type, job && job.id, job && job.status, job && job.description, job && job.startTime]);
    };
  }
  window[INSTANCE_KEY] = { completedJob: completedJob, createReplayTracker: createReplayTracker, createJobHook: createJobHook };
})();
