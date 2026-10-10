import { hub, PLUGIN_ID, PluginApi, React } from "../runtime";

const useCompletedJob = hub?.createJobHook(React);

/** Bootstraps index maintenance and refreshes the index after successful Scans. */
export function IndexMonitor() {
  const alive = React.useRef(true);
  const event = PluginApi.GQL.useJobsSubscribeSubscription().data?.jobsSubscribe;
  React.useEffect(() => {
    let pending = false;
    function bootstrap() {
      if (pending || !alive.current) return;
      pending = true;
      hub
        .runPluginOperation(PLUGIN_ID, { mode: "indexBootstrap" })
        .catch(error => {
          if (alive.current) hub.debugLog(PLUGIN_ID, "Caption index maintenance failed", { error: error.message });
        })
        .then(() => {
          pending = false;
        });
    }
    bootstrap();
    window.addEventListener("dirty-plugins:configuration-changed", bootstrap);
    return () => {
      alive.current = false;
      window.removeEventListener("dirty-plugins:configuration-changed", bootstrap);
    };
  }, []);
  useCompletedJob(
    event,
    async completion => {
      if (!alive.current) return;
      // The backend checks opt-in/internal ownership and claims ID + startTime.
      await hub.runPluginOperation(PLUGIN_ID, {
        mode: "indexAfterScan",
        jobId: completion.jobId,
        startTime: completion.startTime,
      });
    },
    error => {
      if (alive.current) hub.debugLog(PLUGIN_ID, "Caption index refresh after Scan failed", { error: error.message });
    },
    "scan",
  );
  return null;
}
