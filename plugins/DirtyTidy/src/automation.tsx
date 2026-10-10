import { DirtyPlugins, PLUGIN_ID, PluginApi, React } from "./runtime";

const useCompletedJob = DirtyPlugins?.createJobHook(React);

/** Queues approved automation after a successful Scan or Generate job. */
export function AutomationMonitor() {
  const mounted = React.useRef(true);
  React.useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const event = PluginApi.GQL.useJobsSubscribeSubscription().data?.jobsSubscribe;
  useCompletedJob(
    event,
    async completion => {
      if (!mounted.current) return;
      // Backend atomically claims identity across origins/profiles/devices.
      const result = await DirtyPlugins.runPluginOperation<{ queuedJobId?: string }>(PLUGIN_ID, {
        mode: "queueAutomation",
        automationTrigger: completion.kind,
        sourceJobId: String(completion.jobId),
        sourceStartTime: completion.startTime,
      });
      if (result?.queuedJobId && mounted.current)
        DirtyPlugins.ui.notify(
          "DirtyTidy queued after " + completion.kind + " as Stash job " + result.queuedJobId + ".",
        );
    },
    error => {
      if (mounted.current) console.error("DirtyTidy could not queue automation", error);
    },
  );
  return null;
}
