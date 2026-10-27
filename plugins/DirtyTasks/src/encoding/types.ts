import type { ReactNode } from "react";
export type NumericDraft = number | string;
export type Option = [string, string];
export type Quality = "high" | "balanced" | "small" | "visual" | "source" | "custom";
export interface Condition {
  scene?: Record<string, unknown>;
  find?: { q?: string; [key: string]: unknown };
  query?: string;
  all?: boolean;
}
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger?: import("../execution").RunMode;
  condition: Condition;
  action: "resize" | "reencode";
  // Keep raw field text until validation/save, including empty and invalid input.
  width: NumericDraft;
  height: NumericDraft;
  mbps: NumericDraft;
  quality?: Quality;
  vmaf?: number;
  codec: "h264" | "hevc";
  encoder: string;
  format: "keep" | "allow";
}
export interface SettingsValue extends Record<string, unknown> {
  schemaVersion: number;
  rules: Rule[];
  automationPaused: boolean;
}
export interface MediaFile {
  size: number;
  duration: number;
  width: number;
  height: number;
  bit_rate?: number;
  frame_rate?: number;
}
export interface Sample {
  count: number;
  filesize: number;
  scenes: { files: MediaFile[] }[];
}
export interface MediaInfo {
  width: number;
  height: number;
  codec: string;
  bitrate: number;
}
export interface FileOperation {
  id: string;
  sceneId: string;
  title: string;
  source: string;
  destination?: string;
  rule: Rule;
  status: string;
  savings: number;
  actualSavings?: number;
  addedBytes?: number;
  dimensions?: [number, number];
  crf?: number;
  vmaf?: number;
  mbps?: number;
  convert?: boolean;
  media?: MediaInfo;
  identity?: { size: number };
  reason?: string;
}
export interface WorkflowRecord {
  id: string;
  status: string;
  total: number;
  page: number;
  pages: number;
  counts?: Partial<Record<"ready" | "blocked" | "unchanged" | "manual" | "completed" | "failed", number>>;
  operations?: FileOperation[];
  estimatedSavings?: number;
  actualSavings?: number;
  addedBytes?: number;
  outputSize?: number;
  created?: number;
  automatic?: boolean;
  error?: string;
  progress?: { stage: string; progress: number; eta?: number | null };
  skipReasons?: [string, number][];
  cancelRequested?: boolean;
  readyActions?: { resize: number; reencode: number };
}
export interface Capabilities {
  encoders: Record<string, string[]>;
}
export interface OperationResults {
  listRuns: WorkflowRecord[];
  latestPreview: WorkflowRecord | null;
  getPreview: WorkflowRecord;
  getRun: WorkflowRecord;
  preview: WorkflowRecord;
  startRun: WorkflowRecord;
  capabilities: Capabilities;
  cancelPreview: unknown;
  discardPreview: unknown;
  cancelRun: unknown;
  retryRecovery: unknown;
  startAutomaticRun: unknown;
}
export type OperationMode = keyof OperationResults;
export type Operation = <M extends OperationMode>(
  mode: M,
  args?: Record<string, unknown>,
) => Promise<OperationResults[M]>;
export type Act = (mode: OperationMode, args?: Record<string, unknown>) => Promise<unknown>;
export interface SettingsProps {
  configuration?: Partial<SettingsValue>;
  renderTrigger?(rule: Rule): ReactNode;
  onDirtyChange?(id: string, dirty: boolean): void;
}
