import type { Dependencies } from "../types";
export function createIndexMonitor({ api, hub, lifetime }: Dependencies) {
  const React = api.React, useCompletedJob = hub.createJobHook(React);
  return function IndexMonitor() {
    const alive = React.useRef(true);
    const useJobsSubscription = api.GQL?.useJobsSubscribeSubscription;
    const event = typeof useJobsSubscription === "function" ? useJobsSubscription()?.data?.jobsSubscribe : undefined;
    React.useEffect(() => {
      let pending = false;
      function bootstrap() {
        if (pending || !alive.current || !lifetime.active) return;
        pending = true;
        hub.runPluginOperation("dirtyCaptions", { mode: "indexBootstrap" }).catch(error => {
          if (alive.current && lifetime.active) hub.debugLog?.("dirtyCaptions", "Caption index maintenance failed", { error: error.message });
        }).then(() => { pending = false; });
      }
      const release = () => { alive.current = false; window.removeEventListener("dirty-plugins:configuration-changed", bootstrap); lifetime.effects.delete(release); };
      lifetime.effects.add(release); bootstrap();
      window.addEventListener("dirty-plugins:configuration-changed", bootstrap);
      return release;
    }, []);
    useCompletedJob(event, async completion => {
      if (!alive.current || !lifetime.active) return;
      // The backend checks opt-in/internal ownership and claims ID + startTime.
      await hub.runPluginOperation("dirtyCaptions", { mode: "indexAfterScan", jobId: completion.jobId, startTime: completion.startTime });
    }, error => {
      if (alive.current && lifetime.active) hub.debugLog?.("dirtyCaptions", "Caption index refresh after Scan failed", { error: error.message });
    }, "scan");
    return null;
  };
}
