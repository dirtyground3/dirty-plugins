import type { WorkflowRecord } from "../types";
export const FINISHED = ["completed", "failed", "cancelled"];
export const PLANNING = ["queued", "planning"];
export const RECOVERABLE = ["recovery", "running", "finalizing", "reconciling", "queued"];
export function runDescription(run: Pick<WorkflowRecord, "status" | "pauseRequested">): string {
  if (run.status === "paused")
    return "Paused. Resume continues with the remaining files; an interrupted file starts over.";
  if (run.pauseRequested) return "Pausing… the current encode stops and its unfinished output is discarded.";
  return "Status: " + run.status;
}
export function previewDescription(preview: Pick<WorkflowRecord, "status" | "cancelRequested">): string {
  if (preview.status === "queued") return "Waiting for Stash to start the preview task…";
  if (preview.cancelRequested) return "Stopping the preview…";
  if (preview.status === "planning") return "Checking files. Nothing will change until you run it.";
  if (preview.status === "cancelled") return "Preview cancelled.";
  if (preview.status === "failed") return "Preview failed.";
  return "Nothing has changed yet.";
}
