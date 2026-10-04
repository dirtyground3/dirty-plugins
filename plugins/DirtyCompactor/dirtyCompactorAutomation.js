// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCompactorAutomation";
  if (window[INSTANCE_KEY]) return;

  /** @param {CompactorAutomationDependencies} dependencies */
  function createAutomationMonitor(dependencies) {
    var api = dependencies.api, hub = dependencies.hub;
    var useCompletedJob = hub.createJobHook(dependencies);
    var operation = dependencies.operation;
    return function AutomationMonitor() {
      var subscribe = api.GQL && api.GQL.useJobsSubscribeSubscription;
      if (!subscribe) return null;
      var subscription = subscribe(), event = subscription && subscription.data && subscription.data.jobsSubscribe;
      useCompletedJob(event, function (completion) {
        return operation("startAutomaticRun", { jobId: completion.jobId, startTime: completion.startTime });
      }, function (error) { hub.ui.notify("DirtyCompactor could not queue automation: " + error.message); }, "scan");
      return null;
    };
  }

  window[INSTANCE_KEY] = { createAutomationMonitor: createAutomationMonitor };
})();
