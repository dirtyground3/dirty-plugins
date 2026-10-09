import { charts } from "./echarts";
import world from "../vendor/world.js";
import { readRuntime } from "./runtime";
import { createViews } from "./views";

const INSTANCE_KEY = "__dirtyStatsPlugin", globals = window as unknown as Record<string, unknown>;
if (!globals[INSTANCE_KEY]) {
  const runtime = readRuntime(charts, world);
  if (runtime) {
    const { React, api, hub, filterBridge } = runtime;
    let active = true, registrationAttempted = false, app: ReturnType<typeof createViews> | null = null;
    const effects = new Set<() => void>(), subscribers = new Set<(active: boolean) => void>();
    runtime.own = cleanup => { effects.add(cleanup); return () => { effects.delete(cleanup) }; };
    // Host React still owns rendering. This adapter additionally releases each
    // effect when the instance is destroyed, even before its route unmounts.
    runtime.React = {      
...React, useEffect(effect, dependencies) {
        React.useEffect(() => {
          if (!active) return;
          const cleanup = effect(); if (typeof cleanup !== "function") return;
          let released = false;
          const release = () => { if (released) return; released = true; effects.delete(release); cleanup(); };
          effects.add(release); return release;
        }, dependencies);
      }    
};
    const instance = { route: "/plugins/dirty-stats", status: "registering", destroy };
    globals[INSTANCE_KEY] = instance;
    globals.__dirtyCurrentPluginId = "dirtyStats";
    function destroy() {
      if (!active) return;
      active = false; instance.status = "destroyed";
      subscribers.forEach(listener => listener(false)); subscribers.clear();
      for (const release of Array.from(effects)) try { release(); } catch (error) { console.warn("DirtyStats cleanup failed", error); }
      effects.clear();
    }
    try {
      app = createViews(runtime); const { views, registry, settings } = app;
      effects.add(() => app?.dispose());
      function Route() {
        const [enabled, setEnabled] = React.useState(active);
        React.useEffect(() => { subscribers.add(setEnabled); return () => { subscribers.delete(setEnabled) }; }, []);
        return enabled ? <views.DirtyStatsRoute /> : null;
      }
      // Stash cannot unregister these integrations. Keep an inert guard after
      // any attempted registration, including hosts that throw after installing.
      registrationAttempted = true; api.register.route(instance.route, Route);
      api.patch.instead("PerformerList", (...argumentsValue) => {
        const args = argumentsValue.slice(), next = args.pop(), props = args[0];
        if (!active) return next.apply(null, args);
        const path = window.location.pathname;
        if (path === registry.entries.dashboard.route && filterBridge.activeEntity === "performers" && props?.filter) return <views.DashboardFilterCapture entity="performers" filter={props.filter} />;
        if (path === registry.entries.ages.route && props?.extraCriteria?.dirtyStatsAgeFilters) return <views.PerformerFilterCapture filter={props.filter} />;
        if (path === registry.entries.performerRatings.route && props?.extraCriteria?.dirtyStats) return <views.RatingPage filter={props.filter} performerMode={true} />;
        if (path === registry.entries.performerScatter.route && props?.extraCriteria?.dirtyStats) return <views.PerformerScatterPage filter={props.filter} />;
        if (path === registry.entries.birthdays.route && props?.extraCriteria?.dirtyStats) return <views.BirthdayPage filter={props.filter} />;
        if (path !== instance.route || !props?.extraCriteria?.dirtyStats) return next.apply(null, args);
        return <views.StatsPage filter={props.filter} />;
      });
      const pages = {
        constellation: views.ConstellationPage, ratings: views.RatingPage, ages: views.AgePage, growth: views.GrowthPage,
        studios: views.StudioValuePage, tags: views.TagDnaPage, countRating: views.CountRatingPage,
        repeatOffenders: views.RepeatOffenderPage, qualityEfficiency: views.QualityEfficiencyPage
      };
      api.patch.instead("SceneList", (...argumentsValue) => {
        const args = argumentsValue.slice(), next = args.pop(), props = args[0];
        if (!active) return next.apply(null, args);
        const path = window.location.pathname;
        if (path === registry.entries.dashboard.route && filterBridge.activeEntity === "scenes" && props?.filter) return <views.DashboardFilterCapture entity="scenes" filter={props.filter} />;
        const key = Object.keys(pages).find(key => registry.entries[key].route === path), Page = key ? pages[key as keyof typeof pages] : null;
        return Page && props?.filter ? <Page filter={props.filter} /> : next.apply(null, args);
      });
      api.patch.before("MainNavBar.UtilityItems", props => active ? [{        
children: <React.Fragment>
          {props.children}
          <views.NavIcon />
        </React.Fragment>      
}] : [props]);
      const configurationChanged = (event: Event) => { if (active && (event as CustomEvent<{ pluginId: string }>).detail?.pluginId === "dirtyStats") void settings.loadStatsSettings(); };
      window.addEventListener("dirty-plugins:configuration-changed", configurationChanged);
      effects.add(() => window.removeEventListener("dirty-plugins:configuration-changed", configurationChanged));
      if (hub.theme?.subscribe) effects.add(hub.theme.subscribe(settings.syncSuiteTheme));
      void app.start(); instance.status = "active";
      hub.debugLog?.("dirtyStats", "script finished registering");
    } catch (error) { destroy(); instance.status = "failed"; if (!registrationAttempted) delete globals[INSTANCE_KEY]; console.error("[DirtyStats] registration failed", error); }
    finally { globals.__dirtyCurrentPluginId = null; }
  }
}
