interface Window {
  DirtyPlugins: {
    values: {
      asObject(value: unknown): Record<string, unknown>;
      clampInteger(value: unknown, fallback: number, min: number, max: number): number;
      coerceBoolean(value: unknown, fallback: boolean): boolean;
    };
    captureEnabled?: (search: string) => boolean;
    notifyConfigurationChanged?: (pluginId: string) => void;
  };
}
