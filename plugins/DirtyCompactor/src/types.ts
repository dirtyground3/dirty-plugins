import type { ComponentType, ReactNode } from "react";

export type NumericDraft = number | string;
export type Option = [string, string];
export type Quality = "high" | "balanced" | "small" | "visual" | "source" | "custom";
export interface Condition {
  scene?: Record<string, unknown>;
  find?: { q?: string;[key: string]: unknown };
  query?: string;
  all?: boolean;
}
export interface Rule {
  id: string; name: string; enabled: boolean; mode: "manual" | "automatic";
  condition: Condition; action: "resize" | "reencode" | "delete";
  // Keep raw field text until validation/save, including empty and invalid input.
  width: NumericDraft; height: NumericDraft; mbps: NumericDraft;
  quality?: Quality; vmaf?: number; codec: "h264" | "hevc";
  encoder: string; format: "keep" | "allow";
}
export interface SettingsValue { schemaVersion: number; rules: Rule[]; automationPaused: boolean }
export interface MediaFile { size: number; duration: number; width: number; height: number; bit_rate?: number; frame_rate?: number }
export interface Sample { count: number; filesize: number; scenes: { files: MediaFile[] }[] }
export interface MediaInfo { width: number; height: number; codec: string; bitrate: number }
export interface Review {
  operationId: string; title: string; url: string; originalSize: number; outputSize: number;
  original: MediaInfo; output: MediaInfo; encoder: string; destination: string;
  fallback?: boolean; crf?: number; vmaf?: number; reason?: string;
}
export interface FileOperation {
  id: string; sceneId: string; title: string; source: string; destination?: string;
  rule: Rule; status: string; savings: number; actualSavings?: number;
  dimensions?: [number, number]; crf?: number; vmaf?: number; mbps?: number;
  convert?: boolean; media?: MediaInfo; identity?: { size: number }; reason?: string;
}
export interface WorkflowRecord {
  id: string; status: string; total: number; page: number; pages: number;
  counts?: Partial<Record<"ready" | "blocked" | "unchanged" | "manual" | "completed" | "failed", number>>;
  operations?: FileOperation[]; estimatedSavings?: number; actualSavings?: number;
  libraryBytesRemoved?: number; created?: number; automatic?: boolean; error?: string;
  progress?: { stage: string; progress: number; eta?: number | null };
  skipReasons?: [string, number][]; cancelRequested?: boolean;
  readyActions?: { resize: number; reencode: number; delete: number }; review?: Review;
}
export interface Capabilities { encoders: Record<string, string[]> }
export interface OperationResults {
  listRuns: WorkflowRecord[]; latestPreview: WorkflowRecord | null;
  getPreview: WorkflowRecord; getRun: WorkflowRecord; preview: WorkflowRecord;
  startRun: WorkflowRecord; capabilities: Capabilities;
  cancelPreview: unknown; discardPreview: unknown; cancelRun: unknown;
  retryRecovery: unknown; restoreOriginal: unknown; acceptOutput: unknown;
  discardOutput: unknown; startAutomaticRun: unknown;
}
export type OperationMode = keyof OperationResults;
export type Operation = <M extends OperationMode>(mode: M, args?: Record<string, unknown>) => Promise<OperationResults[M]>;
export type Act = (mode: OperationMode, args?: Record<string, unknown>) => Promise<unknown>;
export interface SettingsProps { configuration?: Partial<SettingsValue>; onDirtyChange?(id: string, dirty: boolean): void }

export interface MenuItem { label: ReactNode; onSelect?(): void; disabled?: boolean; tone?: string; href?: string; download?: boolean }
type Children = { children?: ReactNode; className?: string };
export interface HubComponents {
  Button: ComponentType<Children & { onClick?(): void; disabled?: boolean; busy?: boolean; tone?: string; compact?: boolean; pressed?: boolean }>;
  SettingsToggle: ComponentType<{ checked?: boolean; label: ReactNode; onChange(value: boolean): void }>;
  Field: ComponentType<Children & { id: string; label: string; help?: string; action?: ReactNode }>;
  Badge: ComponentType<Children & { title?: string }>;
  ActionMenu: ComponentType<{ ariaLabel: string; items: (MenuItem | false)[] }>;
  SceneFilterEditor: ComponentType<{ open: boolean; value: Condition; onClose(): void; onChange(value: Condition): void }>;
  SettingsCard: ComponentType<Children & { plugin: { name: string; description: string } }>;
  SettingsSection: ComponentType<Children & { title: string; description?: string }>;
  StateView: ComponentType<{ title: string; detail?: string; actions?: ReactNode }>;
  Metric: ComponentType<{ label: string; value: string; detail?: string }>;
  Pagination: ComponentType<{ page: number; totalPages: number; onPageChange(page: number): void; ariaLabel: string; summary: string }>;
  Dialog: ComponentType<Children & { open: boolean; ariaLabel: string; onClose(): void }>;
  SaveStatus: ComponentType<{ state: "invalid" | "error" | "pending" | "saved"; message: string }>;
  usePageTitle(name: string, title: string): void;
}
