import { React, ID, bindRuntime, readRuntime, operation } from "./runtime";
import { Settings } from "./components/Settings";
import { createAutomationMonitor } from "./automation";
import type { ReactNode } from "react";

const INSTANCE_KEY = "__dirtyCompactorPlugin";
type Instance = { state: "registering" | "registered" | "failed" };
const owner = window as unknown as { [INSTANCE_KEY]?: Instance };
const runtime = !owner[INSTANCE_KEY] ? readRuntime() : null;
if (runtime) {
  // Claim before any registration: reentrant/repeated bundle loads are inert.
  const instance: Instance = { state: "registering" };
  owner[INSTANCE_KEY] = instance;
  bindRuntime(runtime);
  let patchAttempted = false;
  try {
    const AutomationMonitor = createAutomationMonitor({
      api: runtime.api, hub: runtime.hub, useRef: React.useRef, useEffect: React.useEffect, operation,
    });
    const hub = runtime.hub;
    hub.registerSettingsPanel(ID, Settings);
    if (runtime.api.patch?.after) {
      patchAttempted = true;
      runtime.api.patch.after("App", (...args) => <React.Fragment>
        {args[args.length - 1] as ReactNode}<AutomationMonitor />
      </React.Fragment>);
    }
    instance.state = "registered";
  } catch (error) {
    instance.state = "failed";
    // Settings can be unregistered. Stash's App patches cannot; a patch that
    // throws after installation must retain its guard to avoid duplicate hooks.
    if (!patchAttempted) {
      runtime.hub.unregisterSettingsPanel(ID, Settings);
      delete owner[INSTANCE_KEY];
    }
    throw error;
  }
}
