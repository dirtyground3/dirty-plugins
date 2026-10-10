import type { ReactNode } from "react";
import { AutomationMonitor } from "./automation";
import { Settings } from "./components/Settings";
import { DirtyPlugins, PLUGIN_ID, PluginApi, React } from "./runtime";

DirtyPlugins?.registerPlugin(PLUGIN_ID, () => {
  PluginApi.patch.after("App", (...args) => {
    const result = args.pop() as ReactNode;
    return (
      <React.Fragment>
        {result}
        <AutomationMonitor key="dirty-tidy-automation-monitor" />
      </React.Fragment>
    );
  });
  DirtyPlugins.registerSettingsPanel(PLUGIN_ID, Settings);
});
