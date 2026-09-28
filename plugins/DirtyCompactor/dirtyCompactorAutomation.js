// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCompactorAutomation";
  if (window[INSTANCE_KEY]) return;

  /** @param {{api: *, hub: *, useRef: Function, useEffect: Function, operation: Function}} dependencies */
  function createAutomationMonitor(dependencies) {
    var api = dependencies.api, hub = dependencies.hub;
    var useRef = dependencies.useRef, useEffect = dependencies.useEffect;
    var operation = dependencies.operation;
    return function AutomationMonitor() {
      var subscribe = api.GQL && api.GQL.useJobsSubscribeSubscription;
      if (!subscribe) return null;
      var subscription = subscribe(), event = subscription && subscription.data && subscription.data.jobsSubscribe;
      var job = event && event.job, seen = useRef({});
      useEffect(function () {
        if (!job || event.type !== "REMOVE" || job.status !== "FINISHED" || job.description !== "Scanning..." || !job.startTime) return;
        var key = job.id + "@" + job.startTime;
        if (seen.current[key]) return;
        seen.current[key] = true;
        operation("startAutomaticRun", { jobId: String(job.id), startTime: job.startTime }).catch(function (error) {
          delete seen.current[key]; hub.ui.notify("DirtyCompactor could not queue automation: " + error.message);
        });
      }, [event && event.type, job && job.id, job && job.status, job && job.startTime]);
      return null;
    };
  }

  window[INSTANCE_KEY] = { createAutomationMonitor: createAutomationMonitor };
})();
