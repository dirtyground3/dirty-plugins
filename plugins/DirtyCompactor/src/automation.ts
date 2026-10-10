import { hub, operation, PluginApi, React } from "./runtime";

const useCompletedJob = hub?.createJobHook(React);

/** Starts approved automatic runs after a successful Scan. */
export function AutomationMonitor() {
  const event = PluginApi.GQL.useJobsSubscribeSubscription().data?.jobsSubscribe;
  useCompletedJob(
    event,
    completion => operation("startAutomaticRun", { jobId: completion.jobId, startTime: completion.startTime }),
    error => hub.ui.notify("DirtyCompactor could not queue automation: " + error.message),
    "scan",
  );
  return null;
}
