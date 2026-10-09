import type { Selection } from "./types";
export interface ExtractionDependencies {
  getSettings(): Promise<Record<string, unknown>>;
  queueCopy(selection: Selection): Promise<string>;
  notify(message: string, isError: boolean): void;
  scheduleRender(): void;
  reportError(error: unknown): void;
}
/** Queue ownership is local; Stash retains ownership of already queued jobs. */
export function createExtractionController(dependencies: ExtractionDependencies) {
  const state = { busy: false, destroyed: false }, listeners = new Set<() => void>();
  function publish() { Array.from(listeners).forEach(listener => listener()); }
  async function startCopy(selection: Selection): Promise<void> {
    if (state.destroyed || state.busy) return;
    if (!selection.kind || !selection.ids.length) {
      dependencies.notify("No selected scenes, markers, or images were found on this page.", true);
      dependencies.scheduleRender(); return;
    }
    state.busy = true; publish();
    try {
      const settings = await dependencies.getSettings();
      if (state.destroyed) return;
      if (!String(settings.destinationFolder || "").trim()) throw new Error(
        "No destination folder selected. Set Destination folder under the Dirty Plugins settings page first.");
      const jobId = await dependencies.queueCopy(selection);
      if (!state.destroyed) dependencies.notify("File copy queued as job " + jobId + ". Progress is available in Tasks.", false);
    } catch (error) {
      if (!state.destroyed) {
        dependencies.reportError(error);
        dependencies.notify(error instanceof Error ? error.message : String(error), true);
      }
    } finally { state.busy = false; if (!state.destroyed) publish(); }
  }
  return { state, startCopy,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    destroy() { if (state.destroyed) return; state.destroyed = true; state.busy = false; publish(); listeners.clear(); },
  };
}
export type ExtractionController = ReturnType<typeof createExtractionController>;
