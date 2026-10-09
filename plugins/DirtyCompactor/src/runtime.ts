import type * as HostReact from "react";
import type { HubComponents, Operation, SettingsProps, SettingsValue } from "./types";
import type { CompletedJobHook, StashJobEvent } from "../../DirtyPlugins/src/jobs";
import type { SaveController, SaveControllerOptions } from "../../DirtyPlugins/src/save";
import type { useSettingsDraft } from "../../DirtyPlugins/src/settingsDraft";

export const ID = "dirtyCompactor";
export interface Host {
  React: typeof HostReact;
  patch?: { after(name: string, callback: (...args: unknown[]) => HostReact.ReactNode): void };
  GQL?: { useJobsSubscribeSubscription?: () => { data?: { jobsSubscribe?: StashJobEvent } } };
}
export interface Hub {
  react: HubComponents & { useSettingsDraft: typeof useSettingsDraft };
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  runPluginOperation<T>(id: string, args: Record<string, unknown>): Promise<T>;
  getPluginSettings(id: string): Promise<Partial<SettingsValue>>;
  configurePlugin(id: string, settings: SettingsValue): Promise<unknown>;
  createSaveController<T, R>(options: SaveControllerOptions<T, R>): SaveController<T, R>;
  createJobHook(hooks: Pick<typeof HostReact, "useRef" | "useEffect">): CompletedJobHook;
  registerSettingsPanel(id: string, component: HostReact.ComponentType<SettingsProps>): void;
  unregisterSettingsPanel?(id: string, component: HostReact.ComponentType<SettingsProps>): void;
  captureEnabled(search: string): boolean;
  ui: { notify(message: string): void };
}
export interface Runtime { api: Host; hub: Hub }

// Stash and the DirtyPlugins hub own these external objects. The cast is confined to
// this host boundary; domain/workflow/component code uses the contracts above.
export function readRuntime(): Runtime | null {
  const host = window as unknown as { PluginApi?: Host; DirtyPlugins?: Hub };
  const api = host.PluginApi, hub = host.DirtyPlugins;
  if (!api?.React || !hub?.react?.SceneFilterEditor) return null;
  if ([api.React.createElement, api.React.useState, api.React.useEffect, api.React.useRef,
  hub.registerSettingsPanel, hub.createJobHook, hub.createSaveController, hub.react.useSettingsDraft, hub.graphql,
  hub.getPluginSettings, hub.configurePlugin, hub.runPluginOperation, hub.captureEnabled]
    .some(value => typeof value !== "function")) return null;
  return { api, hub };
}

// Imports declare bindings only. The guarded entry binds them before mounting.
export let React: typeof HostReact;
export let hub: Hub;
export let ui: HubComponents;
export function bindRuntime(runtime: Runtime): void {
  React = runtime.api.React;
  hub = runtime.hub;
  ui = hub.react;
}
export const operation: Operation = (mode, args) => hub.runPluginOperation(ID, { ...{ mode }, ...args });
