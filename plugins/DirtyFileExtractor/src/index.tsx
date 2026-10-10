import type { ReactNode } from "react";
import { ExtractionAction } from "./components/ExtractionAction";
import { selectionFor, taskRequest } from "./domain/selection";
import { createExtractionController } from "./extraction";
import { createPicker } from "./picker";
import { hubApi, PLUGIN_ID, PluginApi, React } from "./runtime";
import type { Kind } from "./types";

const LIST_ACTIONS: [string, Kind][] = [
  ["SceneList", "scene"],
  ["SceneMarkerList", "marker"],
  ["ImageList", "image"],
];

hubApi?.registerPlugin(PLUGIN_ID, () => {
  const getSettings = () => hubApi.getPluginSettings(PLUGIN_ID);
  const notify = (message: string, isError: boolean) => hubApi.ui.notify(message, isError ? "error" : "success");
  const controller = createExtractionController({
    getSettings,
    notify,
    reportError: error => console.error("[DirtyFileExtractor]", error),
    queueCopy: async selection => {
      const { query, variables } = taskRequest(selection);
      const data = await hubApi.graphql<{ runPluginTask: string }>(query, variables);
      return data.runPluginTask;
    },
  });
  const picker = createPicker({ hubApi, getSettings, notify, pluginId: PLUGIN_ID });
  hubApi.registerFieldAction(PLUGIN_ID, "destinationFolder", { label: "Browse…", onClick: picker.openFolderPicker });
  for (const [component, kind] of LIST_ACTIONS) {
    PluginApi.patch.after(component, (...args) => {
      const result = args.pop() as ReactNode;
      const props = args[0] as { selectedIds?: Iterable<unknown> } | null;
      if (!result || !props?.selectedIds) return result;
      return (
        <React.Fragment>
          <ExtractionAction selection={selectionFor(kind, props.selectedIds)} controller={controller} />
          {result}
        </React.Fragment>
      );
    });
  }
});
