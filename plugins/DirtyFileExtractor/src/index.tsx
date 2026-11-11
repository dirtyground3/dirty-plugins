import type { ReactNode } from "react";
import { ExtractionAction } from "./components/ExtractionAction";
import { selectionFor, taskRequest } from "./domain/selection";
import { createExtractionController } from "./extraction";
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
  hubApi.registerFieldAction(PLUGIN_ID, "destinationFolder", {
    label: "Browse…",
    onClick: event => {
      event.preventDefault();
      hubApi.ui.pickFolder({
        title: "Choose destination folder",
        opener: event.currentTarget,
        initialPath: async () => String((await getSettings()).destinationFolder || ""),
        onSelect: async destinationFolder => {
          await hubApi.configurePlugin(PLUGIN_ID, { ...(await getSettings()), destinationFolder });
          hubApi.notifyConfigurationChanged(PLUGIN_ID);
          notify("Destination folder saved.", false);
        },
      });
    },
  });
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
