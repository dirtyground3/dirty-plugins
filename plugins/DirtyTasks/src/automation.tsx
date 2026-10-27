import { hub, PluginApi, React } from "../../DirtyPlugins/src/shared/host";

const useCompletedJob = hub?.createJobHook(React);

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
      await hub.runPluginOperation("dirtyTasks", {
        mode: "queueAutomation",
        automationTrigger: completion.kind,
        sourceJobId: String(completion.jobId),
        sourceStartTime: completion.startTime,
      });
    },
    error => {
      if (mounted.current) hub.ui.notify("DirtyTasks could not queue automation: " + error.message);
    },
  );
  return null;
}
