interface Window {
  __dirtyPluginsDebug?: boolean;
  __dirtyCurrentPluginId?: string;
  dirtyPluginsDumpDebugLogs?: () => unknown[];
  __dirtyPluginsSceneFilter?: any;
  DirtyPlugins: {
    settingsMetadata: {multiscreen: {defaults: MultiscreenDefaults; order: string[]; limits: Record<string, {min: number; max: number; step: number}>}};
    graphql<T = Record<string, any>>(query: string, variables?: Record<string, unknown>, options?: {signal?: AbortSignal}): Promise<T>;
    runPluginOperation<T = Record<string, any>>(pluginId: string, args: Record<string, unknown>): Promise<T>;
    runSharedOperation<T = Record<string, any>>(args: Record<string, unknown>): Promise<T>;
    getPluginSettings(pluginId: string): Promise<Record<string, unknown>>;
    configurePlugin(pluginId: string, settings: Record<string, unknown>, expectedRevision?: number): Promise<{revision: number; settings?: Record<string, unknown>}>;
    createSaveController<T, R>(options: SaveControllerOptions<T, R>): SaveController<T, R>;
    completedJob(event: StashJobEvent | null | undefined): CompletedJob | null;
    createReplayTracker(capacity?: number): JobReplayTracker;
    createJobHook(React: Pick<NativeReactHooks, "useRef" | "useEffect">): CompletedJobHook;
    registerSettingsPanel(pluginId: string, component: NativeComponent): void;
    registerSettingsAddon(pluginId: string, component: NativeComponent): void;
    unregisterSettingsPanel(pluginId: string, component: NativeComponent): void;
    unregisterSettingsAddon(pluginId: string, component: NativeComponent): void;
    isInternalScan(jobId: string, startTime: string): Promise<boolean>;
    react: {html: HtmlRenderer; usePageTitle(pluginName: string, viewTitle?: string): void; [component: string]: any};
    ui: {notify(message: string, options?: {kind?: string; duration?: number}): void; [helper: string]: any};
    native: {loadComponent(name: string): Promise<NativeComponent>; ensureComponents(name: string, required?: string[]): Promise<NativeComponent[]>};
    values: {
      parseMaybeJson(value: unknown): unknown;
      asObject(value: unknown): Record<string, unknown>;
      clampInteger(value: unknown, fallback: number, min: number, max: number): number;
      coerceBoolean(value: unknown, fallback: boolean): boolean;
    };
    captureEnabled?: (search: string) => boolean;
    captureUrl?: (url: string, search?: string) => string;
    notifyConfigurationChanged?: (pluginId: string, options?: {preserveSettingsPage?: boolean}) => void;
  };
}
