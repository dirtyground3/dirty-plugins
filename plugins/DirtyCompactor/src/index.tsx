import type { ReactNode } from "react";
import { AutomationMonitor } from "./automation";
import { Settings } from "./components/Settings";
import { hub, ID, PluginApi, React } from "./runtime";

hub?.registerPlugin(ID, () => {
  hub.registerSettingsPanel(ID, Settings);
  PluginApi.patch.after("App", (...args) => (
    <React.Fragment>
      {args[args.length - 1] as ReactNode}
      <AutomationMonitor />
    </React.Fragment>
  ));
});
