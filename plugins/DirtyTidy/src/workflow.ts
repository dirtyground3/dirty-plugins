import { settingsFromConfiguration } from "./domain/settings";
import type { Preview, PreviewFilter, Settings } from "./types";
export const TRIGGER_LABELS = { manual: "", scan: "Scan", generate: "Generate" };
export const AUTOMATION_HELP =
  "Automation applies the approved folder and filename rules to the current library, including new scenes and updated metadata. The Stash UI must stay open until the Scan or Generate job finishes.";
export interface WorkflowDependencies {
  getSettings(): Promise<Record<string, unknown>>;
  runPreview(settings: Settings): Promise<Preview>;
  configurePlugin(settings: Settings): Promise<unknown>;
  queueExecution(strategyHash: string, planDigest: string): Promise<string>;
  notify(message: string): void;
}
export interface WorkflowState {
  draft: Settings;
  savedSettings: Settings;
  preview: Preview | null;
  busy: "" | "save" | "preview" | "apply";
  status: string;
  error: string;
  previewFilter: PreviewFilter;
  previewPage: number;
  openRow: string;
  showFiles: boolean;
  confirming: boolean;
  approve: boolean;
  destroyed: boolean;
}
/** Tidy deliberately retains manual saves and explicit reviewed-plan confirmation. */
export function createWorkflow(configuration: unknown, dependencies: WorkflowDependencies) {
  const initial = settingsFromConfiguration(configuration);
  const state: WorkflowState = {
    draft: initial,
    savedSettings: initial,
    preview: null,
    busy: "",
    status: "",
    error: "",
    previewFilter: "all",
    previewPage: 1,
    openRow: "",
    showFiles: false,
    confirming: false,
    approve: true,
    destroyed: false,
  };
  const listeners = new Set<() => void>();
  let version = 0,
    loadRequest = 0,
    interacted = false;
  const dirty = () => JSON.stringify(state.draft) !== JSON.stringify(state.savedSettings);
  function publish() {
    Array.from(listeners).forEach(listener => listener());
  }
  function view(
    update: Partial<
      Pick<WorkflowState, "previewFilter" | "previewPage" | "openRow" | "showFiles" | "confirming" | "approve">
    >,
  ) {
    if (!state.destroyed) {
      Object.assign(state, update);
      publish();
    }
  }
  function changed(update: Partial<Settings>, affectsStrategy = true) {
    if (state.destroyed) return;
    state.draft = { ...state.draft, ...update };
    if (affectsStrategy !== false) {
      state.draft.approvedStrategyHash = "";
      state.draft.approvedPlanDigest = "";
      state.preview = null;
      state.confirming = false;
      state.previewFilter = "all";
      state.previewPage = 1;
      state.showFiles = false;
    }
    version++;
    state.status = "";
    state.error = "";
    publish();
  }
  function updateLevel(index: number, value: string) {
    const levels = state.draft.hierarchyLevels.slice();
    levels[index] = value;
    changed({ hierarchyLevels: levels });
  }
  function moveLevel(index: number, direction: number) {
    const nextIndex = index + direction,
      levels = state.draft.hierarchyLevels.slice();
    if (nextIndex < 0 || nextIndex >= levels.length) return;
    [levels[index], levels[nextIndex]] = [levels[nextIndex], levels[index]];
    changed({ hierarchyLevels: levels });
  }
  function removeLevel(index: number) {
    changed({ hierarchyLevels: state.draft.hierarchyLevels.filter((_level, levelIndex) => levelIndex !== index) });
  }
  function addLevel() {
    changed({ hierarchyLevels: state.draft.hierarchyLevels.concat(["{title}"]) });
  }
  async function load() {
    const request = ++loadRequest,
      revision = version;
    try {
      const settings = await dependencies.getSettings();
      if (!state.destroyed && !interacted && request === loadRequest && revision === version) {
        state.draft = settingsFromConfiguration(settings);
        state.savedSettings = state.draft;
        publish();
      }
    } catch {
      /* The hub-provided configuration remains a usable fallback. */
    }
  }
  function begin(kind: WorkflowState["busy"]) {
    if (state.destroyed || state.busy) return false;
    interacted = true;
    state.busy = kind;
    state.error = "";
    publish();
    return true;
  }
  function failed(failure: unknown) {
    if (!state.destroyed) {
      state.error = failure instanceof Error ? failure.message : String(failure);
      state.status = "";
    }
  }
  function finished() {
    if (!state.destroyed) {
      state.busy = "";
      publish();
    }
  }
  async function saveStrategy() {
    if (!begin("save")) return;
    const draft = state.draft;
    try {
      await dependencies.configurePlugin(draft);
      if (!state.destroyed) {
        state.savedSettings = draft;
        state.status = "Strategy saved.";
      }
    } catch (failure) {
      failed(failure);
    } finally {
      finished();
    }
  }
  async function generatePreview() {
    if (!begin("preview")) return;
    state.confirming = false;
    const draft = state.draft,
      revision = version;
    state.status = "";
    try {
      const result = await dependencies.runPreview(draft);
      if (!state.destroyed && revision === version) {
        state.preview = result;
        // Server normalization is authoritative and does not persist the draft.
        if (result?.settings) state.draft = settingsFromConfiguration(result.settings);
        state.previewFilter = "all";
        state.previewPage = 1;
        state.showFiles = false;
        state.openRow = "";
      }
    } catch (failure) {
      if (revision === version) failed(failure);
    } finally {
      finished();
    }
  }
  function changePreviewFilter(value: PreviewFilter) {
    view({ previewFilter: value, previewPage: 1, showFiles: true });
  }
  function openConfirmation() {
    if (state.preview) view({ approve: true, confirming: true });
  }
  function discard() {
    state.preview = null;
    view({ showFiles: false, confirming: false });
  }
  async function applyPlan(runNow: boolean) {
    const preview = state.preview,
      draft = state.draft,
      revision = version;
    if (!preview || !begin("apply")) return;
    const automated = draft.automationMode !== "manual" && state.approve;
    const approvedSettings = automated
      ? { ...draft, approvedStrategyHash: preview.strategy_hash, approvedPlanDigest: preview.plan_digest }
      : draft;
    try {
      await dependencies.configurePlugin(approvedSettings);
      if (state.destroyed) return;
      state.savedSettings = approvedSettings;
      if (revision !== version) {
        state.status = "Strategy saved. Generate a new preview before running the changed strategy.";
        return;
      }
      state.draft = approvedSettings;
      const jobId = runNow ? await dependencies.queueExecution(preview.strategy_hash, preview.plan_digest) : null;
      if (state.destroyed) return;
      state.confirming = false;
      const automationText = automated
        ? " Automation is on after every " + TRIGGER_LABELS[draft.automationMode] + "."
        : "";
      state.status = jobId
        ? "Queued as Stash job " + jobId + "; progress is in Tasks." + automationText
        : "Strategy saved." + automationText;
      dependencies.notify(jobId ? "DirtyTidy execution queued." : "DirtyTidy strategy saved.");
      if (jobId) state.preview = null;
    } catch (failure) {
      failed(failure);
    } finally {
      finished();
    }
  }
  return {
    state,
    dirty,
    view,
    changed,
    updateLevel,
    moveLevel,
    removeLevel,
    addLevel,
    load,
    saveStrategy,
    generatePreview,
    changePreviewFilter,
    openConfirmation,
    discard,
    applyPlan,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      loadRequest++;
      publish();
      listeners.clear();
    },
  };
}
export type Workflow = ReturnType<typeof createWorkflow>;
