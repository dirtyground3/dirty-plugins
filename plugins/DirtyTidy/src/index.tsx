import { readRuntime, bindRuntime, React, PLUGIN_ID } from "./runtime";
import { Settings } from "./components/Settings";
import { createAutomationMonitor } from "./automation";
import type { Lifetime, SettingsProps } from "./types";
import type { ReactNode } from "react";
const INSTANCE_KEY = "__dirtyTidyPlugin";
const globals = window as unknown as Record<string, unknown>;
if (!globals[INSTANCE_KEY]) {
  const runtime = readRuntime();
  if (runtime) {
    bindRuntime(runtime); const { api, hub: DirtyPlugins } = runtime;
    const lifetime: Lifetime = { active: true, effects: new Set() };
    let patchAttempted = false;
    const instance = { status: "registering", destroy };
    globals[INSTANCE_KEY] = instance; globals.__dirtyCurrentPluginId = PLUGIN_ID;
    let AutomationMonitor: ReturnType<typeof createAutomationMonitor>;
    function SettingsPanel(props: SettingsProps) { return <Settings {...props} lifetime={lifetime} />; }
    function destroy() {
      if (!lifetime.active) return;
      lifetime.active = false; instance.status = "destroyed";
      Array.from(lifetime.effects).forEach(release => release()); lifetime.effects.clear();
      DirtyPlugins.unregisterSettingsPanel?.(PLUGIN_ID, SettingsPanel);
    }
    try {
      AutomationMonitor = createAutomationMonitor(api, DirtyPlugins, lifetime);
      if (api.patch?.after) {
        patchAttempted = true;
        api.patch.after("App", (...args) => {
          const result = args.pop() as ReactNode;
          return lifetime.active ? <React.Fragment>{result}<AutomationMonitor key="dirty-tidy-automation-monitor" /></React.Fragment> : result;
        });
      }
      DirtyPlugins.registerSettingsPanel(PLUGIN_ID, SettingsPanel); instance.status = "active";
      DirtyPlugins.debugLog?.(PLUGIN_ID, "script finished registering");
    } catch (error) {
      destroy(); instance.status = "failed";
      if (!patchAttempted) delete globals[INSTANCE_KEY];
      console.error("[DirtyTidy] registration failed", error);
    } finally { globals.__dirtyCurrentPluginId = null; }
  }
}
