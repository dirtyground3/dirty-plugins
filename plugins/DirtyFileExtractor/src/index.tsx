import { bindRuntime, readRuntime, React, PluginApi, PLUGIN_ID } from "./runtime";
import { ExtractionAction } from "./components/ExtractionAction";
import { createExtractionController } from "./extraction";
import { createPicker } from "./picker";
import { selectionFor, taskRequest } from "./domain/selection";
import { hasRelevantMutations, MUTATION_DEBOUNCE_MS } from "./domain/mutations";
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
    const state: PickerState & { browseButton: HTMLButtonElement | null; frame: number | null; mutationTimer: number | null; observer: MutationObserver | null } = {
      destroyed: false, picker: null, pickerRequest: 0, browseButton: null, frame: null, mutationTimer: null, observer: null,
    };
    const ownedEffects: OwnedEffects = new Set();
    let patchAttempted = false;
    const instance: Instance = { destroy, status: "registering" };
    globals[INSTANCE_KEY] = instance; globals.__dirtyCurrentPluginId = PLUGIN_ID;
    const getSettings = () => hubApi.getPluginSettings(PLUGIN_ID);
    const notify = (message: string, isError: boolean) => hubApi.ui.notify(message, isError ? "error" : "success");
    const controller = createExtractionController({ getSettings, notify, scheduleRender, reportError: error => console.error("[DirtyFileExtractor]", error),
      queueCopy: async selection => {
        const { query, variables } = taskRequest(selection);
        const data = await hubApi.graphql<{ runPluginTask: string }>(query, variables); return data.runPluginTask;
      },
    });
    const picker = createPicker({ state, hubApi, getSettings, notify, pluginId: PLUGIN_ID });
    const { openFolderPicker, closeFolderPicker } = picker;
    // Construct after the imported picker: legacy code captured an undefined callback.
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
    function registerHubFieldAction() {
      if (typeof hubApi.registerFieldAction !== "function") return false;
      hubApi.registerFieldAction(PLUGIN_ID, "destinationFolder", hubFieldAction); return true;
    }
    function renderBrowseButton() {
      if (registerHubFieldAction()) { if (state.browseButton) state.browseButton.hidden = true; return; }
      if (!state.browseButton?.isConnected) {
        const button = document.createElement("button"); button.type = "button";
        button.className = "dirty-file-extractor-browse btn btn-secondary dirty-ui-button"; button.textContent = "Browse…";
        button.hidden = true; button.addEventListener("click", openFolderPicker); document.body.appendChild(button); state.browseButton = button;
      }
      const button = state.browseButton;
      const row = document.querySelector<HTMLElement>("#plugin-extractScenes-destinationFolder"), editButton = row?.querySelector("button");
      if (!row || !editButton) { button.hidden = true; return; }
      const rowRect = row.getBoundingClientRect(), editRect = editButton.getBoundingClientRect();
      if (!rowRect.width || !rowRect.height || rowRect.bottom <= 0 || rowRect.top >= window.innerHeight) { button.hidden = true; return; }
      button.hidden = false; const buttonRect = button.getBoundingClientRect(), gap = 8;
      let left = editRect.left - buttonRect.width - gap, top = editRect.top + (editRect.height - buttonRect.height) / 2;
      if (left < rowRect.left + 12) { left = Math.max(12, editRect.right - buttonRect.width); top = editRect.bottom + gap; }
      button.style.left = Math.round(left) + "px"; button.style.top = Math.round(top) + "px";
    }
    function scheduleRender() {
      if (state.destroyed || state.frame !== null) return;
      state.frame = window.requestAnimationFrame(() => { state.frame = null; if (!state.destroyed && !controller.state.busy) renderBrowseButton(); });
    }
    function onDocumentMutations(records: MutationRecord[]) {
      if (state.destroyed || controller.state.busy || !hasRelevantMutations(records) || state.mutationTimer !== null) return;
      state.mutationTimer = window.setTimeout(() => { state.mutationTimer = null; if (!state.destroyed && !controller.state.busy) scheduleRender(); }, MUTATION_DEBOUNCE_MS);
    }
    function destroy() {
      if (state.destroyed) return;
      state.destroyed = true; instance.status = "destroyed"; controller.destroy();
      Array.from(ownedEffects).forEach(release => release()); ownedEffects.clear();
      window.removeEventListener("popstate", scheduleRender); window.removeEventListener("hashchange", scheduleRender);
      window.removeEventListener("resize", scheduleRender); window.removeEventListener("scroll", scheduleRender, true);
      if (state.mutationTimer !== null) { window.clearTimeout(state.mutationTimer); state.mutationTimer = null; }
      state.observer?.disconnect(); if (state.frame !== null) { window.cancelAnimationFrame(state.frame); state.frame = null; }
      state.browseButton?.removeEventListener("click", openFolderPicker); state.browseButton?.remove();
      hubApi.unregisterFieldAction?.(PLUGIN_ID, "destinationFolder", hubFieldAction); closeFolderPicker();
    }
    try {
      window.addEventListener("popstate", scheduleRender); window.addEventListener("hashchange", scheduleRender);
      window.addEventListener("resize", scheduleRender); window.addEventListener("scroll", scheduleRender, { capture: true, passive: true });
      // Only older hubs need the DOM-observed settings Browse fallback.
      if (!registerHubFieldAction()) {
        state.observer = new MutationObserver(onDocumentMutations); state.observer.observe(document.body, { childList: true, subtree: true });
      }
      registerListAction("SceneList", "scene"); registerListAction("SceneMarkerList", "marker"); registerListAction("ImageList", "image");
      scheduleRender(); instance.status = "active"; hubApi.debugLog?.(PLUGIN_ID, "script finished registering", { path: window.location.pathname });
    } catch (error) {
      destroy(); instance.status = "failed";
      if (!patchAttempted) delete globals[INSTANCE_KEY];
      console.error("[DirtyFileExtractor] registration failed", error);
    } finally { globals.__dirtyCurrentPluginId = null; }
  }
}
