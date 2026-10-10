import type { Selection } from "./types";
export interface ExtractionDependencies {
  getSettings(): Promise<Record<string, unknown>>;
  queueCopy(selection: Selection): Promise<string>;
  notify(message: string, isError: boolean): void;
  reportError(error: unknown): void;
}
/** Queue ownership is local; Stash retains ownership of already queued jobs. */
export function createExtractionController(dependencies: ExtractionDependencies) {
  const state = { busy: false },
    listeners = new Set<() => void>();
  function publish() {
    Array.from(listeners).forEach(listener => listener());
  }
  async function startCopy(selection: Selection): Promise<void> {
    if (state.busy) return;
    if (!selection.kind || !selection.ids.length) {
      dependencies.notify("No selected scenes, markers, or images were found on this page.", true);
      return;
    }
    state.busy = true;
    publish();
    try {
      const settings = await dependencies.getSettings();
      if (!String(settings.destinationFolder || "").trim())
        throw new Error(
          "No destination folder selected. Set Destination folder under the Dirty Plugins settings page first.",
        );
      const jobId = await dependencies.queueCopy(selection);
      dependencies.notify("File copy queued as job " + jobId + ". Progress is available in Tasks.", false);
    } catch (error) {
      dependencies.reportError(error);
      dependencies.notify(error instanceof Error ? error.message : String(error), true);
    } finally {
      state.busy = false;
      publish();
    }
  }
  return {
    state,
    startCopy,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type ExtractionController = ReturnType<typeof createExtractionController>;
