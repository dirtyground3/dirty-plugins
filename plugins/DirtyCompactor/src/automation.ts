import type * as HostReact from "react";
import type { Host, Hub } from "./runtime";
import type { Operation } from "./types";

export interface AutomationDependencies extends Pick<typeof HostReact, "useRef" | "useEffect"> {
  api: Host;
  hub: Pick<Hub, "createJobHook" | "ui">;
  operation: Operation;
}

export function createAutomationMonitor(dependencies: AutomationDependencies) {
  const { api, hub, operation } = dependencies;
  const useCompletedJob = hub.createJobHook(dependencies);
  return function AutomationMonitor() {
    const subscribe = api.GQL?.useJobsSubscribeSubscription;
    if (!subscribe) return null;
    const subscription = subscribe(), event = subscription?.data?.jobsSubscribe;
    useCompletedJob(event, completion => operation("startAutomaticRun", {
      jobId: completion.jobId, startTime: completion.startTime,
    }), error => hub.ui.notify("DirtyCompactor could not queue automation: " + error.message), "scan");
    return null;
  };
}
