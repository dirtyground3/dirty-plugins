import type { PanelProps } from "../../DirtyPlugins/src/types";
export type AutomationMode = "manual" | "scan" | "generate";
export interface Settings extends Record<string, unknown> {
  moveEnabled: boolean;
  moveRequireStashId: boolean;
  hierarchyLevels: string[];
  renameEnabled: boolean;
  renameRequireStashId: boolean;
  renamePattern: string;
  maxFilenameLength: number;
  multiValueSeparator: string;
  automationMode: AutomationMode;
  approvedStrategyHash: string;
  approvedPlanDigest: string;
}
export interface Operation {
  scene_id: string;
  scene_title: string;
  file_id: string;
  source_path: string;
  destination_path: string;
  status: "ready" | "warning" | "blocked" | "unchanged";
  actions: string[];
  warnings: string[];
  blocked_scenes?: { id: string; title?: string }[];
}
export interface Summary {
  ready?: number;
  moves?: number;
  renames?: number;
  warnings?: number;
  unchanged?: number;
  blocked?: number;
}
export interface Preview {
  settings?: Record<string, unknown>;
  strategy_hash: string;
  plan_digest: string;
  summary: Summary;
  operations: Operation[];
  total: number;
}
export type PreviewFilter = "all" | "ready" | "move" | "rename" | "warning" | "unchanged" | "blocked";
export type Variable = readonly [token: string, label: string, group: string];
export type SettingsProps = PanelProps;
