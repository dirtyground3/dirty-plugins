import type * as R from "react";
import type { createJobHook, StashJobEvent } from "./jobs";
import type { createSaveController } from "./save";
import type { usePageTitle } from "./title";
import type { useSettingsDraft } from "./settingsDraft";

// Stash's PluginApi, the one description every plugin shares (window.PluginApi). Stash owns
// patch argument shapes and loadable component props, so they stay permissive here.
export type NativeProps = Record<string, any>;
export type NativeComponent = R.ComponentType<NativeProps>;
export type NativePatchArguments = any[];
export type NativePatchHandler = (this: unknown, ...args: NativePatchArguments) => any;
export interface QueryOptions {
  variables: Record<string, unknown>;
  skip?: boolean;
}
export interface QueryResult<T> {
  data?: T;
  loading: boolean;
  error?: Error;
}
export interface Host {
  React: typeof R;
  ReactDOM: { createPortal(children: R.ReactNode, container: Element): R.ReactPortal };
  patch: {
    before(name: string, handler: NativePatchHandler): void;
    after(name: string, handler: NativePatchHandler): void;
    instead(name: string, handler: NativePatchHandler): void;
  };
  register: { route(path: string, component: NativeComponent): void };
  libraries: {
    ReactRouterDOM: {
      Link: NativeComponent;
      NavLink: NativeComponent;
      MemoryRouter: NativeComponent;
      Prompt: NativeComponent;
      useHistory(): {
        push(path: string): void;
        replace(location: string | { pathname: string; search: string }): void;
      };
      useLocation(): { pathname: string; search: string };
    };
    Bootstrap: Record<string, any>;
    Intl: { useIntl(): { messages?: Record<string, string> } };
    ReactFontAwesome?: { FontAwesomeIcon: R.ComponentType<{ icon: unknown }> };
    FontAwesomeSolid?: Record<string, unknown>;
  };
  components: Record<string, NativeComponent>;
  loadableComponents?: Record<string, unknown>;
  utils: {
    loadComponents(components: unknown[]): Promise<unknown>;
    StashService: { useFindScene<T = unknown>(id: string): QueryResult<T> };
  };
  GQL: {
    useJobsSubscribeSubscription(): { data?: { jobsSubscribe?: StashJobEvent } };
    useFindPerformersQuery<T = unknown>(options: QueryOptions): QueryResult<T>;
    useFindScenesQuery<T = unknown>(options: QueryOptions): QueryResult<T>;
  };
}
export type FieldValue = unknown;
export interface Setting {
  name: string;
  display_name?: string;
  description?: string;
  type: string;
}
export interface Plugin {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  settings?: Setting[];
}
export interface Snapshot {
  configuration: Record<string, Record<string, unknown>>;
  pluginRevisions: Record<string, number>;
  plugins: Plugin[];
}
export type Drafts = Record<string, Record<string, FieldValue>>;
export type Statuses = Record<string, { error: boolean; message: string }>;
export interface FieldAction {
  label: R.ReactNode;
  onClick(event: R.MouseEvent<HTMLButtonElement>): void;
}
export interface PanelProps {
  plugin: Plugin;
  configuration: Record<string, unknown>;
  onDirtyChange?(id: string, dirty: boolean): void;
  onConfigurationChanged?(): void;
}
export interface SettingInputProps {
  pluginId: string;
  setting: Setting;
  value: FieldValue;
  actionRevision: number;
  onChange(value: FieldValue): void;
}
export interface PluginCardProps {
  plugin: Plugin;
  draft?: Record<string, FieldValue>;
  status?: { error: boolean; message: string };
  actionRevision: number;
  onFieldChange(id: string, name: string, value: FieldValue): void;
}

/** Shared controls accept documented presentation props, independent of Stash. */
export interface SharedProps {
  children?: R.ReactNode;
  className?: string;
  bodyClassName?: string;
  plugin?: Partial<Plugin>;
  footer?: R.ReactNode;
  title?: string;
  description?: string;
  label?: R.ReactNode;
  detail?: R.ReactNode;
  actions?: R.ReactNode;
  value?: R.ReactNode;
  fallback?: R.ReactNode;
  icon?: unknown;
  compact?: boolean;
  tone?: string;
  disabled?: boolean;
  busy?: boolean;
  pressed?: boolean;
  buttonRef?: R.Ref<HTMLButtonElement>;
  onClick?: R.MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit" | "reset";
  role?: R.AriaRole;
  ariaLive?: "off" | "polite" | "assertive";
  ariaLabel?: string;
  id?: string;
  containerId?: string;
  help?: R.ReactNode;
  error?: string;
  action?: R.ReactNode;
  message?: string;
  state?: string;
}
export interface ToggleProps extends SharedProps {
  checked?: boolean;
  onChange(value: boolean): void;
}
export interface PaginationProps extends SharedProps {
  page: number;
  totalPages: number;
  summary?: R.ReactNode;
  onPageChange(value: number): void;
}
export interface DialogProps extends SharedProps {
  open?: boolean;
  onClose?(): void;
  initialFocusRef?: R.RefObject<HTMLElement>;
  openerRef?: R.RefObject<HTMLElement>;
  labelledBy?: string;
  backdropClassName?: string;
  allowNativePopup?: boolean;
  backdrop?: R.ReactNode;
}
export interface DialogOptions {
  dialog: HTMLElement | null;
  opener?: Element | null;
  initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  onClose?(): void;
  allowNativePopup?: boolean;
}
export interface NotifyOptions {
  tone?: string;
  duration?: number;
}
export interface ActionItem {
  header?: R.ReactNode;
  label?: R.ReactNode;
  key?: string;
  onSelect?(): void;
  disabled?: boolean;
  tone?: string;
  href?: string;
  download?: boolean;
}
export interface MenuProps extends SharedProps {
  items?: (ActionItem | false | null | undefined)[];
}
export interface SelectorProps extends SharedProps {
  value: string;
  options?: { value: string; label: R.ReactNode }[];
  onSelect?(value: string): void;
}
export interface NavProps extends SharedProps {
  as?: NativeComponent;
  to: string;
  exact?: boolean;
}
export interface SceneCondition {
  find?: Record<string, unknown>;
  scene?: Record<string, unknown>;
  query?: string;
  all?: boolean;
}
export interface NativeFilter {
  makeFindFilter(): Record<string, unknown>;
  makeQueryParameters(): string | Record<string, string>;
  makeFilter(): Record<string, unknown>;
}
export interface FilterProps {
  open: boolean;
  value?: SceneCondition;
  onChange(value: SceneCondition): void;
  onClose(): void;
}
export interface ThemeApi {
  defaultKey: string;
  currentKey: string;
  normalizeKey(value: unknown): string;
  subscribe(listener: (key: string) => void): () => void;
  ready: Promise<string>;
  readRole(root: Element | null, propertyName: string): string;
}
export interface DebugEntry {
  elapsedMs: number;
  scope: string;
  message: string;
  path: string;
  data: unknown;
}
export interface HubApi {
  /** Run a plugin's registration once per page; failures are logged. */
  registerPlugin(pluginId: string, setup: () => void): void;
  graphql<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  runPluginOperation<T = Record<string, unknown>>(id: string, args: Record<string, unknown>): Promise<T>;
  getPluginSettings(id: string): Promise<Record<string, unknown>>;
  configurePlugin(
    id: string,
    settings: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<{ revision: number; settings?: Record<string, unknown> }>;
  createSaveController: typeof createSaveController;
  createJobHook: typeof createJobHook;
  ui: Pick<typeof import("./dialogs"), "notify" | "manageDialog">;
  react: typeof import("./components/Controls") &
    typeof import("./components/Settings") &
    typeof import("./components/Navigation") &
    typeof import("./components/Dialog") & {
      usePageTitle: typeof usePageTitle;
      useSettingsDraft: typeof useSettingsDraft;
      SceneFilterEditor: R.ComponentType<FilterProps>;
    };
  native: {
    loadComponent(name: string): Promise<NativeComponent>;
    ensureComponents(name: string, required?: string[]): Promise<NativeComponent[]>;
  };
  captureEnabled(search?: string): boolean;
  captureUrl(to: string, search?: string): string;
  theme: ThemeApi;
  registerFieldAction(id: string, name: string, action: FieldAction): void;
  notifyConfigurationChanged(id: string, options?: { preserveSettingsPage?: boolean }): void;
  registerSettingsPanel(id: string, component: R.ComponentType<PanelProps>): void;
  registerSettingsAddon(id: string, component: R.ComponentType<PanelProps>): void;
  debugLog(scope: string, message: string, data?: unknown): DebugEntry;
}
