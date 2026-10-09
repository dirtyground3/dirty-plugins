import { PluginApi } from "./runtime";
import type { NativeComponent } from "./types";

const componentLoads: Record<string, Promise<NativeComponent>> = {};
const bundleLoads: Record<string, Promise<unknown>> = {};

function loadable(name: string) {
  return Boolean(PluginApi.utils && typeof PluginApi.utils.loadComponents === "function" && PluginApi.loadableComponents && PluginApi.loadableComponents[name]);
}
/** Load one lazy bundle once; a failed load may be retried. */
function loadBundle<T>(loads: Record<string, Promise<T>>, name: string, then: () => T | Promise<T>) {
  if (!loads[name]) {
    loads[name] = Promise.resolve()
      .then(() => PluginApi.utils!.loadComponents([PluginApi.loadableComponents![name]]))
      .then(then)
      .catch(error => { delete loads[name]; throw error; });
  }
  return loads[name];
}

export function loadComponent(name: string): Promise<NativeComponent> {
  if (PluginApi.components && PluginApi.components[name]) return Promise.resolve(PluginApi.components[name]);
  if (!loadable(name)) return Promise.reject(new Error("Stash does not expose " + name + "."));
  return loadBundle(componentLoads, name, () => {
    if (!PluginApi.components || !PluginApi.components[name]) throw new Error("Stash did not register " + name + ".");
    return PluginApi.components[name];
  });
}

export function ensureComponents(loadableName: string, requiredNames?: string[]): Promise<NativeComponent[]> {
  const names = requiredNames || [loadableName];
  const available = () => names.every(name => PluginApi.components && PluginApi.components[name]);
  const components = () => names.map(name => PluginApi.components[name]);
  if (available()) return Promise.resolve(components());
  if (!loadable(loadableName)) return Promise.reject(new Error("Stash does not expose " + loadableName + "."));
  return loadBundle(bundleLoads, loadableName, () => undefined).then(() => {
    if (!available()) throw new Error("Stash did not register " + names.join(", ") + ".");
    return components();
  });
}
