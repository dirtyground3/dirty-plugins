// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCompactorAutomation";
  if (window[INSTANCE_KEY]) return;

  /** @param {CompactorAutomationDependencies} dependencies */
  function createAutomationMonitor(dependencies) {
    var api = dependencies.api, hub = dependencies.hub;
    var useRef = dependencies.useRef, useEffect = dependencies.useEffect;
    var operation = dependencies.operation;
    return function AutomationMonitor() {
      var subscribe = api.GQL && api.GQL.useJobsSubscribeSubscription;
      if (!subscribe) return null;
      var subscription = subscribe(), event = subscription && subscription.data && subscription.data.jobsSubscribe;
      var job = event && event.job, seen = useRef(null);
      if (!seen.current) seen.current = hub.createReplayTracker();
      useEffect(function () {
        var completion = hub.completedJob(event);
        if (!completion || completion.kind !== "scan" || !seen.current.claim(completion.key)) return;
        operation("startAutomaticRun", { jobId: completion.jobId, startTime: completion.startTime }).catch(function (error) {
          seen.current.release(completion.key);
          hub.ui.notify("DirtyCompactor could not queue automation: " + error.message);
        });
      }, [event && event.type, job && job.id, job && job.status, job && job.description, job && job.startTime]);
      return null;
    };
  }

  window[INSTANCE_KEY] = { createAutomationMonitor: createAutomationMonitor };
})();
