import type * as R from "react";
import type { HubApi, FieldAction } from "../../DirtyPlugins/src/types";
export type Kind = "scene" | "marker" | "image";
export interface Selection { kind: Kind; ids: string[]; singular: Kind; plural: string; }
export interface Directory { path: string; parent?: string | null; directories?: string[]; }
export type Hub = Pick<HubApi, "graphql" | "getPluginSettings" | "configurePlugin" | "ui"> &
  Partial<Pick<HubApi, "registerFieldAction" | "unregisterFieldAction" | "captureEnabled" | "notifyConfigurationChanged" | "debugLog" | "debugElapsed">>;
// Stash owns patch arguments; narrow only the native selection prop we consume.
export interface Host {
  React: typeof R;
  ReactDOM?: { createPortal(children: R.ReactNode, container: Element): R.ReactPortal };
  patch: { after(name: string, callback: (...args: unknown[]) => R.ReactNode): void };
}
export interface OpenEvent { preventDefault(): void; currentTarget?: EventTarget | null; }
export interface Picker {
  backdrop: HTMLDivElement; dialog: HTMLDivElement; closeButton: HTMLButtonElement;
  currentPath: string | null; parentPath: string | null; list: HTMLDivElement;
  pathInput: HTMLInputElement; status: HTMLDivElement; upButton: HTMLButtonElement;
  useButton: HTMLButtonElement; releaseDialog?: () => void;
}
export interface PickerState { picker: Picker | null; pickerRequest: number; destroyed: boolean; }
export interface PickerActions {
  closeFolderPicker(): void;
  loadDirectory(picker: Picker, path: string | null, fallbackToHome: boolean): Promise<void>;
  saveDestinationFolder(picker: Picker): Promise<void>;
}
export interface PickerDependencies {
  state: PickerState; hubApi: Hub; pluginId: string;
  getSettings(): Promise<Record<string, unknown>>;
  notify(message: string, isError: boolean): void;
}
export type OwnedEffects = Set<() => void>;
export type BrowseAction = FieldAction;
