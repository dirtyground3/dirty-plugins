import type * as R from "react";
import type { HubApi } from "../../DirtyPlugins/src/types";
import type { StashJobEvent } from "../../DirtyPlugins/src/jobs";
export interface SceneFile { id?: string | number; size?: number; mod_time?: string; }
export interface Scene { id: string | number; files?: SceneFile[]; }
export interface CaptionTrack { index: number; codec: string; language: string; title: string; default: boolean; forced: boolean; vtt: string; }
export interface CaptionResult { tracks: CaptionTrack[]; warnings: string[]; retryable?: boolean; sceneId: string; fileId: string; }
export interface CaptionSettings { enabled: boolean; showByDefault: boolean; preferredLanguage: string; }
export interface PlayerTrack { mode: string; kind: string; }
export interface TrackElement {
  track: PlayerTrack; addEventListener(name: string, handler: () => void): void; removeEventListener(name: string, handler: () => void): void;
}
export interface TrackList extends ArrayLike<PlayerTrack> {
  addEventListener(name: string, handler: () => void): void; removeEventListener(name: string, handler: () => void): void;
}
export interface TrackOptions { kind: string; src: string; srclang: string; label: string; default: boolean; }
export interface SourceSelector { addTextTrack?(options: TrackOptions, manual: boolean): TrackElement; removeTextTrack?(element: TrackElement): void; }
export interface Player {
  isDisposed(): boolean; textTracks(): TrackList; remoteTextTracks(): ArrayLike<PlayerTrack>;
  sourceSelector?(): SourceSelector; addRemoteTextTrack(options: TrackOptions, manual: boolean): TrackElement;
  removeRemoteTextTrack(element: TrackElement): void; on(name: string, handler: () => void): void; off(name: string, handler: () => void): void;
  ready(handler: () => void): void;
}
export interface CustomField { field: string; modifier: string; value: string[]; }
export interface Definition { label: string; fields: CustomField[]; }
/** Native criteria have host-owned prototypes and unknown value shapes. */
export interface Criterion {
  criterionOption: CriterionOption; value: unknown; modifier?: string; clone(): Criterion; isValid(): boolean;
  toCriterionInput?(): CustomField[]; applyToCriterionInput?(input: CriterionInput): void; applyToSavedCriterion?(input: CriterionInput): void;
}
export interface CriterionInput { custom_fields?: CustomField[]; [key: string]: unknown; }
export interface CriterionOption {
  type: string; messageID?: string; sfwMessageID?: string; hidden?: boolean;
  options?: string[]; modifierOptions?: string[]; defaultModifier?: string; makeCriterion(): Criterion; makeCriterionFn?(): Criterion;
}
export interface NativeFilter {
  mode: string; options: { criterionOptions: CriterionOption[] }; criteria: Criterion[];
  makeCriterion(type: string): Criterion; clone(): NativeFilter; getSortBy(): unknown;
}
export interface IntlContext { messages?: Record<string, string>; }
/** Permissive React props are confined to Stash's undocumented patch boundary. */
export interface NativeProps { [key: string]: any; children?: R.ReactNode; className?: string; scene?: Scene; }
export interface Host {
  React: typeof R; patch: { after(name: string, handler: (...args: unknown[]) => R.ReactNode): void };
  GQL?: { useJobsSubscribeSubscription?: () => { data?: { jobsSubscribe?: StashJobEvent } } };
  libraries?: { Intl?: { useIntl?(): IntlContext } };
}
export type Hub = Pick<HubApi, "values" | "react" | "getPluginSettings" | "runPluginOperation" | "createJobHook" | "registerSettingsAddon" | "unregisterSettingsAddon" | "captureEnabled" | "debugLog">;
export interface Lifetime { active: boolean; effects: Set<() => void>; }
export interface Dependencies { api: Host; hub: Hub; lifetime: Lifetime; }
export interface IndexStatus { status?: string; checked?: number; probed?: number; forceRun?: boolean; skipped?: number; errors?: number; lastFullScan?: number; }
