import type { WorkflowRecord } from "../types";
export const FINISHED = ["completed", "failed", "cancelled"];
export const PLANNING = ["queued", "planning"];
export const RECOVERABLE = ["recovery", "running", "finalizing", "reconciling", "queued", "acceptQueued", "discarding"];
export function previewDescription(preview: Pick<WorkflowRecord, "status" | "cancelRequested">): string {
  if (preview.status === "queued") return "Waiting for Stash to start the preview task…";
  if (preview.cancelRequested) return "Stopping the preview…";
  if (preview.status === "planning") return "Checking files. Nothing will change until you run it.";
  if (preview.status === "cancelled") return "Preview cancelled.";
  if (preview.status === "failed") return "Preview failed.";
  return "Nothing has changed yet.";
}
