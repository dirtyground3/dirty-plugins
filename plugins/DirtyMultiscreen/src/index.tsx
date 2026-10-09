import { readRuntime } from "./runtime";
import { createSettingsDomain } from "./domain/settings";
import { createContexts } from "./contexts";
import { createQueries } from "./queries";
import { createCounts } from "./counts";
import { createLifecycle, observeSubtree } from "./lifecycle";
import { createHooks } from "./hooks";
import { createControls } from "./components/Controls";
import { createLoadedNativePlayer } from "./components/LoadedNativePlayer";
import { createNativePlayerTile } from "./components/NativePlayerTile";
import { createGrid } from "./components/Grid";
import { createCounter } from "./components/Counter";
import { createRoute } from "./components/Route";
import { createNavigation } from "./components/Navigation";
import type { Lifetime, ComponentDependencies } from "./types";
const INSTANCE_KEY = "__dirtyMultiscreenPlugin", globals = window as unknown as Record<string, unknown>;
if (!globals[INSTANCE_KEY]) {
  const runtime = readRuntime();
  if (runtime) {
    const life: Lifetime = { active: true, effects: new Set() }, base = { ...runtime, life }, React = runtime.api.React;
    const instance = { route: "/plugins/multiscreen", status: "registering", destroy }; let registrationAttempted = false;
    globals[INSTANCE_KEY] = instance; globals.__dirtyCurrentPluginId = "multiscreen";
    function destroy() { if (!life.active) return; life.active = false; instance.status = "destroyed"; Array.from(life.effects).forEach(release => release()); life.effects.clear(); }
    try {
      const settingsDomain = createSettingsDomain(runtime.hub), contexts = createContexts(base), queries = createQueries(runtime.hub, settingsDomain), counts = createCounts();
      life.effects.add(() => counts.clear());
      const deps: ComponentDependencies = { ...base, React, settingsDomain, contexts, queries, counts, controls: createControls(base), observeSubtree, ...createLifecycle(base) };
      deps.hooks = createHooks(deps); deps.LoadedNativePlayer = createLoadedNativePlayer(deps); deps.NativePlayerTile = createNativePlayerTile(deps);
      deps.Grid = createGrid(deps); deps.Counter = createCounter(deps);
      const Route = createRoute(deps), Navigation = createNavigation(deps);
      // Stash cannot unregister routes/patches. Claim before the first attempt,
      // and keep an inert guard if the host throws after installing any of them.
      registrationAttempted = true; runtime.api.register.route(instance.route, Route);
      function captureList(component: string, path: string, key: string) {
        runtime!.api.patch.before(component, props => {
          if (life.active && window.location.pathname === path && props.filter && props.selectedIds instanceof Set) contexts.captureList(key, { filter: props.filter, selectedIds: props.selectedIds });
          return [props];
        });
      }
      captureList("SceneMarkerList", "/scenes/markers", "marker-list"); captureList("SceneList", "/scenes", "scene-list"); captureList("PerformerList", "/performers", "performer-list");
      runtime.api.patch.before("PerformerPage", props => { if (life.active && window.location.pathname.startsWith("/performers/") && props.performer?.id) contexts.captureDetail("performer-detail", props.performer.id); return [props]; });
      captureList("StudioList", "/studios", "studio-list");
      runtime.api.patch.before("StudioPage", props => { if (life.active && window.location.pathname.startsWith("/studios/") && props.studio?.id) contexts.captureDetail("studio-detail", props.studio.id); return [props]; });
      runtime.api.patch.before("MainNavBar.UtilityItems", props => life.active ? [{ children: <React.Fragment>{props.children}<Navigation /></React.Fragment> }] : [props]);
      instance.status = "active"; runtime.hub.debugLog("multiscreen", "script finished registering");
    } catch (error) { destroy(); instance.status = "failed"; if (!registrationAttempted) delete globals[INSTANCE_KEY]; console.error("[DirtyMultiscreen] registration failed", error); }
    finally { globals.__dirtyCurrentPluginId = null; }
  }
}
