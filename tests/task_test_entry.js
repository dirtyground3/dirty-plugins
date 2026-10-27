"use strict";
const { compileSource } = require("./plugin_paths");

// Focused domain panels use the same host/registration/automation contracts.
// Combined-panel tests execute the actual staged entry instead.
function featureEntry(section) {
  const register = 'hub.registerSettingsPanel("dirtyTasks", Settings);';
  const patch =
    'PluginApi.patch.after("App", (...args) => React.createElement(React.Fragment, null, args[args.length - 1], React.createElement(AutomationMonitor)));';
  return compileSource("DirtyTasks", "test-entry.ts", {
    contents: `import { hub, PluginApi, React } from "../DirtyPlugins/src/shared/host";
      import { Settings } from "./src/${section}/components/Settings";
      import { AutomationMonitor } from "./src/automation";
      hub?.registerPlugin("dirtyTasks", () => { ${section === "organization" ? patch + register : register + patch} });`,
  });
}
module.exports = { featureEntry };
