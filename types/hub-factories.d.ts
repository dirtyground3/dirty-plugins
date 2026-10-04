// Factory dependencies are explicit. Native Stash/React values are compatibility boundaries.
interface HubDebugDependencies {
  PluginApi: any;
  hubApi: Window["DirtyPlugins"] & Record<string, any>;
}
interface HubTransportDependencies {
  pluginRevisionCache: Record<string, number>;
  hubApi: Window["DirtyPlugins"] & Record<string, any>;
  fieldActions: any;
  FIELD_ACTIONS_CHANGED_EVENT: string;
  CONFIGURATION_CHANGED_EVENT: string;
  settingsPanels: any;
  SETTINGS_PANELS_CHANGED_EVENT: string;
  pluginResult: (value: unknown) => Record<string, any>;
  asObject: (value: unknown) => Record<string, any>;
  applyVisualTheme: (value: unknown) => string;
  debugGraphqlOperationName: (query: string) => string;
  debugNow: () => number;
  debugLogThrottled: (scope: string, message: string, data?: unknown, interval?: number) => unknown;
  debugDescribe: (value: unknown) => string;
  debugLog: (scope: string, message: string, data?: unknown) => unknown;
}
interface HubReactDependencies {
  useEffect: NativeReactHooks["useEffect"];
  useRef: NativeReactHooks["useRef"];
  html: HtmlRenderer;
  PluginApi: any;
  FontAwesomeIcon: any;
  React: any;
  Link: any;
  hubApi: Window["DirtyPlugins"] & Record<string, any>;
}
interface HubThemeDependencies {
  hubApi: Window["DirtyPlugins"] & Record<string, any>;
  DEFAULT_VISUAL_THEME: string;
  getPluginSettings: (pluginId: string) => Promise<Record<string, unknown>>;
  asObject: (value: unknown) => Record<string, any>;
}
interface HubNativeDependencies {
  hubApi: Window["DirtyPlugins"] & Record<string, any>;
  PluginApi: any;
  Dialog: NativeComponent;
  StateView: NativeComponent;
  Button: NativeComponent;
  html: HtmlRenderer;
  useEffect: NativeReactHooks["useEffect"];
  useState: NativeReactHooks["useState"];
  useRef: NativeReactHooks["useRef"];
}
