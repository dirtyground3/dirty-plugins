import type { Host, Hub, Lifetime } from "./types";
export function createAutomationMonitor(api: Host, DirtyPlugins: Hub, lifetime: Lifetime) {
  const React = api.React, useCompletedJob = DirtyPlugins.createJobHook(React);
  return function DirtyTidyAutomationMonitor() {
    const mounted = React.useRef(true);
    React.useEffect(() => {
      const release = () => { mounted.current = false; lifetime.effects.delete(release); };
      lifetime.effects.add(release); return release;
    }, []);
    const useJobsSubscription = api.GQL?.useJobsSubscribeSubscription;
    const subscription = typeof useJobsSubscription === "function" ? useJobsSubscription() : undefined;
    const event = subscription?.data?.jobsSubscribe;
    useCompletedJob(event, async completion => {
      if (!mounted.current || !lifetime.active) return;
      // Backend atomically claims identity across origins/profiles/devices.
      const result = await DirtyPlugins.runPluginOperation<{ queuedJobId?: string }>("dirtyTidy", {
        mode: "queueAutomation", automationTrigger: completion.kind, sourceJobId: String(completion.jobId), sourceStartTime: completion.startTime,
      });
      if (result?.queuedJobId && mounted.current && lifetime.active) DirtyPlugins.ui.notify(
        "DirtyTidy queued after " + completion.kind + " as Stash job " + result.queuedJobId + ".");
    }, error => { if (mounted.current && lifetime.active) console.error("DirtyTidy could not queue automation", error); });
    return null;
  };
}
