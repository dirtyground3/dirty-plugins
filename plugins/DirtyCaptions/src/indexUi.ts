import { createIndexMonitor } from "./components/IndexMonitor";
import { createIndexSettings } from "./components/IndexSettings";
import { createListDecorator } from "./filterView";
import type { Dependencies } from "./types";
export function createIndexUi(dependencies: Dependencies) {
  return { Monitor: createIndexMonitor(dependencies), SettingsAddon: createIndexSettings(dependencies), decorateList: createListDecorator(dependencies.api.React) };
}
