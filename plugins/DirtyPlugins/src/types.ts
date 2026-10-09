import type * as R from "react";
import type { completedJob, createJobHook, createReplayTracker } from "./jobs";
import type { metadata } from "./metadata";
import type { createSaveController } from "./save";
import type * as Values from "./values";

// Stash owns patch argument shapes and loadable component props. Keep their
// permissive compatibility types confined to this host boundary.
/** The deprecated public HTM tag (`react.html`), kept for feature plugins that predate the TSX ports. */
export type HtmlRenderer = (strings: TemplateStringsArray, ...values: any[]) => any;
export type NativeProps = Record<string, any>;
export type NativeComponent = R.ComponentType<NativeProps>;
export type NativePatchArguments = any[];
export type NativePatchHandler = ((this: unknown, ...args: NativePatchArguments) => any) & { __dirtyDebugWrapped?: boolean; };
export interface Host {
  React: typeof R;
  ReactDOM?: { createPortal(children: R.ReactNode, container: Element): R.ReactPortal; };
  patch: { instead(name: string, handler: NativePatchHandler): void; before?: (name: string, handler: NativePatchHandler) => void; after?: (name: string, handler: NativePatchHandler) => void; };
  register: { route(path: string, component: NativeComponent): void; };
  libraries: {
    ReactRouterDOM: { Link: NativeComponent; MemoryRouter: NativeComponent; };
    Bootstrap: Record<string, any>;
    ReactFontAwesome?: { FontAwesomeIcon: R.ComponentType<{ icon: unknown; }>; };
    FontAwesomeSolid?: Record<string, unknown>;
  };
  components: Record<string, NativeComponent>;
  loadableComponents?: Record<string, unknown>;
  utils?: { loadComponents(components: unknown[]): Promise<unknown>; };
  __dirtyDebugInstrumented?: boolean;
}
export type FieldValue = unknown;
export interface Setting { name: string; display_name?: string; description?: string; type: string; }
export interface Plugin { id: string; name: string; description?: string; version?: string; enabled?: boolean; settings?: Setting[]; }
export interface Snapshot { configuration: Record<string, Record<string, unknown>>; pluginRevisions: Record<string, number>; plugins: Plugin[]; }
export type Drafts = Record<string, Record<string, FieldValue>>;
export type Statuses = Record<string, { error: boolean; message: string; }>;
export interface FieldAction { label: R.ReactNode; onClick(event: R.MouseEvent<HTMLButtonElement>): void; }
export type FieldActions = Record<string, Record<string, FieldAction>>;
export interface PanelProps { plugin: Plugin; configuration: Record<string, unknown>; onDirtyChange?(id: string, dirty: boolean): void; onConfigurationChanged?(): void; }
export type Panels = Record<string, R.ComponentType<PanelProps>>;
export interface SettingInputProps { pluginId: string; setting: Setting; value: FieldValue; actionRevision: number; onChange(value: FieldValue): void; }
export interface PluginCardProps { plugin: Plugin; draft?: Record<string, FieldValue>; status?: { error: boolean; message: string; }; actionRevision: number; onFieldChange(id: string, name: string, value: FieldValue): void; }

/** Shared controls accept documented presentation props, independent of Stash. */
export interface SharedProps {
  children?: R.ReactNode; className?: string; bodyClassName?: string; plugin?: Partial<Plugin>;
  footer?: R.ReactNode; title?: string; description?: string; label?: R.ReactNode;
  detail?: R.ReactNode; actions?: R.ReactNode; value?: R.ReactNode; fallback?: R.ReactNode;
  icon?: unknown; compact?: boolean; tone?: string; disabled?: boolean; busy?: boolean;
  pressed?: boolean; buttonRef?: R.Ref<HTMLButtonElement>; onClick?: R.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit" | "reset"; role?: R.AriaRole; ariaLive?: "off" | "polite" | "assertive";
  ariaLabel?: string; id?: string; containerId?: string; help?: R.ReactNode; error?: string;
  action?: R.ReactNode; message?: string; state?: string;
}
export interface ToggleProps extends SharedProps { checked?: boolean; onChange(value: boolean): void; }
export interface PaginationProps extends SharedProps { page: number; totalPages: number; summary?: R.ReactNode; onPageChange(value: number): void; }
export interface DialogProps extends SharedProps {
  open?: boolean; onClose?(): void; initialFocusRef?: R.RefObject<HTMLElement>;
  openerRef?: R.RefObject<HTMLElement>; labelledBy?: string; backdropClassName?: string;
  allowNativePopup?: boolean; backdrop?: R.ReactNode;
}
export interface DialogOptions {
  dialog: HTMLElement | null; opener?: Element | null; initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  onClose?(): void; allowNativePopup?: boolean;
}
export interface NotifyOptions { tone?: string; duration?: number; }
export interface ActionItem { header?: R.ReactNode; label?: R.ReactNode; key?: string; onSelect?(): void; disabled?: boolean; tone?: string; href?: string; download?: boolean; }
export interface MenuProps extends SharedProps { items?: (ActionItem | false | null | undefined)[]; }
export interface SelectorProps extends SharedProps { value: string; options?: { value: string; label: R.ReactNode; }[]; onSelect?(value: string): void; }
export interface NavProps extends SharedProps { as?: NativeComponent; to: string; exact?: boolean; }
export interface SceneCondition { find?: Record<string, unknown>; scene?: Record<string, unknown>; query?: string; all?: boolean; }
export interface NativeFilter {
  makeFindFilter(): Record<string, unknown>;
  makeQueryParameters(): string | Record<string, string>;
  makeFilter(): Record<string, unknown>;
}
export interface FilterProps { open: boolean; value?: SceneCondition; onChange(value: SceneCondition): void; onClose(): void; }
export interface ThemeApi {
  defaultKey: string; currentKey: string; normalizeKey(value: unknown): string;
  subscribe(listener: (key: string) => void): () => void; load(): Promise<string>;
  ready: Promise<string>; readRole(root: Element | null, propertyName: string): string;
}
export interface DebugEntry { elapsedMs: number; scope: string; message: string; path: string; data: unknown; }
export interface DebugMethods {
  debugGraphqlOperationName(query: unknown): string; debugNow(): number;
  debugLogThrottled(scope: string, message: string, data?: unknown, intervalMs?: number): DebugEntry | null;
  debugDescribe(value: unknown): string; debugLog(scope: string, message: string, data?: unknown): DebugEntry;
  debugElapsed(): number;
}
export interface HubApi {
  settingsMetadata: typeof metadata; fieldActions: FieldActions; settingsPanels: Panels;
  graphql<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>, options?: { signal?: AbortSignal; }): Promise<T>;
  runPluginOperation<T = Record<string, unknown>>(id: string, args: Record<string, unknown>): Promise<T>;
  runSharedOperation<T = Record<string, unknown>>(args: Record<string, unknown>): Promise<T>;
  getPluginSettings(id: string): Promise<Record<string, unknown>>;
  configurePlugin(id: string, settings: Record<string, unknown>, expectedRevision?: number): Promise<{ revision: number; settings?: Record<string, unknown>; }>;
  createSaveController: typeof createSaveController; completedJob: typeof completedJob;
  fieldDefinition: typeof import("./settings").fieldDefinition;
  createReplayTracker: typeof createReplayTracker; createJobHook: typeof createJobHook;
  isInternalScan(id: string, startTime: string): Promise<boolean>; values: Pick<typeof Values, "asObject" | "parseMaybeJson" | "clampInteger" | "coerceBoolean">;
  ui: Pick<typeof import("./dialogs"), "notify" | "trapDialogTab" | "lockBodyScroll" | "manageDialog">;
  react: typeof import("./components/Controls") & typeof import("./components/Settings") & typeof import("./components/Navigation") & typeof import("./components/Dialog") & {
    html: HtmlRenderer; usePageTitle: typeof import("./title").usePageTitle;
    useSettingsDraft: typeof import("./settingsDraft").useSettingsDraft;
    SettingsField: typeof import("./components/SettingsField").SettingsField;
    SceneFilterEditor: R.ComponentType<FilterProps>;
  };
  native: { loadComponent(name: string): Promise<NativeComponent>; ensureComponents(name: string, required?: string[]): Promise<NativeComponent[]>; };
  serializeSceneFilter(filter: NativeFilter): SceneCondition;
  captureEnabled(search?: string): boolean; captureUrl(to: string, search?: string): string;
  theme: ThemeApi;
  registerFieldAction(id: string, name: string, action: FieldAction): void;
  unregisterFieldAction(id: string, name: string, action: FieldAction): void;
  notifyConfigurationChanged(id: string, options?: { preserveSettingsPage?: boolean; }): void;
  registerSettingsPanel(id: string, component: R.ComponentType<PanelProps>): void;
  unregisterSettingsPanel(id: string, component: R.ComponentType<PanelProps>): void;
  registerSettingsAddon(id: string, component: R.ComponentType<PanelProps>): void;
  unregisterSettingsAddon(id: string, component: R.ComponentType<PanelProps>): void;
  debugLog: DebugMethods["debugLog"]; debugLogThrottled: DebugMethods["debugLogThrottled"];
  debugElapsed: DebugMethods["debugElapsed"]; debugDescribe: DebugMethods["debugDescribe"];
  debugEnabled(): boolean; dumpDebugLogs(): DebugEntry[];
}
export interface HubDebugDependencies { PluginApi: Host; hubApi: HubApi; }
export interface HubTransportDependencies extends DebugMethods {
  pluginRevisionCache: Record<string, number>; hubApi: HubApi; fieldActions: FieldActions; settingsPanels: Panels;
  FIELD_ACTIONS_CHANGED_EVENT: string; CONFIGURATION_CHANGED_EVENT: string; SETTINGS_PANELS_CHANGED_EVENT: string;
  pluginResult: typeof Values.pluginResult; asObject: typeof Values.asObject; applyVisualTheme(value: unknown): string;
}
export interface HubThemeDependencies {
  hubApi: HubApi; DEFAULT_VISUAL_THEME: string; VISUAL_THEME_KEYS: string[]; getPluginSettings: HubApi["getPluginSettings"]; asObject: typeof Values.asObject;
}
export interface HubNativeDependencies {
  hubApi: HubApi; PluginApi: Host; Dialog: R.ComponentType<DialogProps>; StateView: R.ComponentType<SharedProps>; Button: R.ComponentType<SharedProps>;
}
