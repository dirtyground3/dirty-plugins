import { bindRuntime, readRuntime, React, PluginApi, PLUGIN_ID } from "./runtime";
import { ExtractionAction } from "./components/ExtractionAction";
import { createExtractionController } from "./extraction";
import { createPicker } from "./picker";
import { selectionFor, taskRequest } from "./domain/selection";
import type { BrowseAction, Kind, OwnedEffects, PickerState } from "./types";
import type { ReactNode } from "react";

const INSTANCE_KEY = "__extractScenesFloatingAction";
interface Instance { destroy(): void; status: "registering" | "active" | "destroyed" | "failed"; }
const globals = window as unknown as Record<string, unknown>;

// Stash cannot remove patches. Keep one guard, even after partial registration.
if (!globals[INSTANCE_KEY]) {
  const runtime = readRuntime();
  if (runtime) {
    bindRuntime(runtime); const { hubApi } = runtime;
    const state: PickerState = { destroyed: false, picker: null, pickerRequest: 0 };
    const ownedEffects: OwnedEffects = new Set();
    let patchAttempted = false;
    const instance: Instance = { destroy, status: "registering" };
    globals[INSTANCE_KEY] = instance; globals.__dirtyCurrentPluginId = PLUGIN_ID;
    const getSettings = () => hubApi.getPluginSettings(PLUGIN_ID);
    const notify = (message: string, isError: boolean) => hubApi.ui.notify(message, isError ? "error" : "success");
    const controller = createExtractionController({ getSettings, notify, reportError: error => console.error("[DirtyFileExtractor]", error),
      queueCopy: async selection => {
        const { query, variables } = taskRequest(selection);
        const data = await hubApi.graphql<{ runPluginTask: string }>(query, variables); return data.runPluginTask;
      },
    });
    const picker = createPicker({ state, hubApi, getSettings, notify, pluginId: PLUGIN_ID });
    const { openFolderPicker, closeFolderPicker } = picker;
    // Construct after the picker so Browse captures its initialized callback.
    const hubFieldAction: BrowseAction = { label: "Browse…", onClick: openFolderPicker };

    function registerListAction(component: string, kind: Kind) {
      patchAttempted = true;
      PluginApi.patch.after(component, (...args) => {
        const result = args.pop() as ReactNode;
        const props = args[0] as { selectedIds?: Iterable<unknown> } | null;
        if (state.destroyed || !result || !props?.selectedIds) return result;
        const selection = selectionFor(kind, props.selectedIds);
        return <React.Fragment><ExtractionAction selection={selection} controller={controller} ownedEffects={ownedEffects} />{result}</React.Fragment>;
      });
    }
    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true; instance.status = "destroyed"; controller.destroy();
      Array.from(ownedEffects).forEach(release => release()); ownedEffects.clear();
      hubApi.unregisterFieldAction(PLUGIN_ID, "destinationFolder", hubFieldAction); closeFolderPicker();
    }
    try {
      hubApi.registerFieldAction(PLUGIN_ID, "destinationFolder", hubFieldAction);
      registerListAction("SceneList", "scene"); registerListAction("SceneMarkerList", "marker"); registerListAction("ImageList", "image");
      instance.status = "active"; hubApi.debugLog(PLUGIN_ID, "script finished registering", { path: window.location.pathname });
    } catch (error) {
      destroy(); instance.status = "failed";
      if (!patchAttempted) delete globals[INSTANCE_KEY];
      console.error("[DirtyFileExtractor] registration failed", error);
    } finally { globals.__dirtyCurrentPluginId = null; }
  }
}
