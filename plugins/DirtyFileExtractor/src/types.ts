import type * as R from "react";
import type { HubApi } from "../../DirtyPlugins/src/types";
export type Kind = "scene" | "marker" | "image";
export interface Selection {
  kind: Kind;
  ids: string[];
  singular: Kind;
  plural: string;
}
export interface Directory {
  path: string;
  parent?: string | null;
  directories?: string[];
}
export type Hub = Pick<
  HubApi,
  | "graphql"
  | "getPluginSettings"
  | "configurePlugin"
  | "ui"
  | "registerFieldAction"
  | "captureEnabled"
  | "notifyConfigurationChanged"
  | "debugLog"
>;
// Stash owns patch arguments; narrow only the native selection prop we consume.
export interface Host {
  React: typeof R;
  ReactDOM?: { createPortal(children: R.ReactNode, container: Element): R.ReactPortal };
  patch: { after(name: string, callback: (...args: unknown[]) => R.ReactNode): void };
}
