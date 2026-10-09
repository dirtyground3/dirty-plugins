import { ContextualMultiscreenNavLink } from "./components/Navigation";
import { MultiscreenRoute } from "./components/Route";
import { bindRuntime, contexts, life, PluginApi, React, readRuntime } from "./runtime";
const INSTANCE_KEY = "__dirtyMultiscreenPlugin", globals = window as unknown as Record<string, unknown>;
if (!globals[INSTANCE_KEY]) {
  const runtime = readRuntime();
  if (runtime) {
    const instance = { route: "/plugins/multiscreen", status: "registering", destroy }; let registrationAttempted = false;
    globals[INSTANCE_KEY] = instance; globals.__dirtyCurrentPluginId = "multiscreen";
    function destroy() { if (!life.active) return; life.active = false; instance.status = "destroyed"; Array.from(life.effects).forEach(release => release()); life.effects.clear(); }
    try {
      bindRuntime(runtime);
      // Stash cannot unregister routes/patches. Claim before the first attempt,
      // and keep an inert guard if the host throws after installing any of them.
      registrationAttempted = true; PluginApi.register.route(instance.route, MultiscreenRoute);
      function captureList(component: string, path: string, key: string) {
        PluginApi.patch.before(component, props => {
          if (life.active && window.location.pathname === path && props.filter && props.selectedIds instanceof Set) contexts.captureList(key, { filter: props.filter, selectedIds: props.selectedIds });
          return [props];
        });
      }
      function captureDetail(component: string, prefix: string, entity: "performer" | "studio") {
        PluginApi.patch.before(component, props => {
          if (life.active && window.location.pathname.startsWith(prefix) && props[entity]?.id) contexts.captureDetail(entity + "-detail", props[entity].id);
          return [props];
        });
      }
      captureList("SceneMarkerList", "/scenes/markers", "marker-list"); captureList("SceneList", "/scenes", "scene-list"); captureList("PerformerList", "/performers", "performer-list");
      captureDetail("PerformerPage", "/performers/", "performer");
      captureList("StudioList", "/studios", "studio-list");
      captureDetail("StudioPage", "/studios/", "studio");
      PluginApi.patch.before("MainNavBar.UtilityItems", props => life.active ? [{ children: <React.Fragment>{props.children}<ContextualMultiscreenNavLink /></React.Fragment> }] : [props]);
      instance.status = "active"; runtime.hub.debugLog("multiscreen", "script finished registering");
    } catch (error) { destroy(); instance.status = "failed"; if (!registrationAttempted) delete globals[INSTANCE_KEY]; console.error("[DirtyMultiscreen] registration failed", error); }
    finally { globals.__dirtyCurrentPluginId = null; }
  }
}
