import type { ReactNode } from "react";
import { hub, PluginApi, React } from "../../DirtyPlugins/src/shared/host";
import { AutomationMonitor } from "./automation";
import { Settings } from "./Panel";

hub?.registerPlugin("dirtyTasks", () => {
  hub.registerSettingsPanel("dirtyTasks", Settings);
  PluginApi.patch.after("App", (...args) => (
    <React.Fragment>
      {args[args.length - 1] as ReactNode}
      <AutomationMonitor />
    </React.Fragment>
  ));
});
