import { BATTLE_CATEGORY_ROUTE_PATH, GAUNTLET_ROUTE_PATH, LEADERBOARDS_ROUTE_PATH, OVERALL_SORT_ACTIVE, OVERALL_SORT_LABEL, PLUGIN_ID, ROUTE_PATH } from "./constants";
import { readRuntime } from "./host";
import { createLifecycle } from "./lifecycle";
import { createViews } from "./views";
const INSTANCE_KEY = "__dirtyRankPlugin", globals = window as unknown as Record<string, unknown>;
if (!globals[INSTANCE_KEY]) {
  const runtime = readRuntime();
  if (runtime) {
    const { React, PluginApi, DirtyPlugins } = runtime, life = createLifecycle(React);
    const instance = {
      status: "registering", route: ROUTE_PATH, leaderboardsRoute: LEADERBOARDS_ROUTE_PATH,
      gauntletRoute: GAUNTLET_ROUTE_PATH, overallSortLabel: OVERALL_SORT_LABEL, destroy
    };
    let registrationAttempted = false;
    globals[INSTANCE_KEY] = instance; globals.__dirtyCurrentPluginId = PLUGIN_ID;
    function destroy() { life.destroy(); instance.status = "destroyed"; }
    try {
      const views = createViews({ ...runtime, isActive: life.isActive, useEffect: life.useOwnedEffect });
      life.own(views.dispose);
      function owned<P extends object>(Component: import("react").ComponentType<P>) {
        return function OwnedRankComponent(props: P) { return life.useActive() ? <Component {...props} /> : null; };
      }
      const Route = owned(views.DirtyRankRoute), Boards = owned(views.DirtyRankLeaderboardsRoute);
      const Settings = owned(views.DirtyRankSettings), Navigation = owned(views.DirtyRankNavLinks);
      // Stash cannot unregister routes or patches. Retain an inert guard after
      // the first attempted host registration, including partial failure.
      registrationAttempted = true;
      PluginApi.register.route(ROUTE_PATH, Route);
      PluginApi.register.route(BATTLE_CATEGORY_ROUTE_PATH, Route);
      PluginApi.register.route(GAUNTLET_ROUTE_PATH, Route);
      PluginApi.register.route(GAUNTLET_ROUTE_PATH + "/:categoryId", Route);
      PluginApi.register.route(LEADERBOARDS_ROUTE_PATH + "/:statistic?", Boards);
      life.own(() => DirtyPlugins.unregisterSettingsPanel(PLUGIN_ID, Settings));
      DirtyPlugins.registerSettingsPanel(PLUGIN_ID, Settings);
      void views.refreshOverallSortSettings();
      const changed = (event: import("./types").ConfigurationEvent) => {
        if (life.isActive() && (!event.detail || event.detail.pluginId === PLUGIN_ID)) void views.refreshOverallSortSettings();
      };
      window.addEventListener(views.CONFIGURATION_CHANGED_EVENT, changed);
      life.own(() => window.removeEventListener(views.CONFIGURATION_CHANGED_EVENT, changed));
      PluginApi.patch.before("FilteredPerformerList", props => life.isActive() && views.isPerformerListRoute() && props
        ? [{ ...props, filterHook: views.overallPerformerFilterHook(props.filterHook) }] : [props]);
      PluginApi.patch.after("FilteredPerformerList", (...args) => {
        const result = args.pop();
        return life.isActive() && views.isPerformerListRoute() ? <views.DirtyRankPerformerListShell>
          {result}
        </views.DirtyRankPerformerListShell> : result;
      });
      PluginApi.patch.after("PerformerDetailsPanel", (...args) => {
        const result = args.pop(), props = args[0];
        return life.isActive() && props?.performer?.id ? <React.Fragment>
          {result}
          <views.DirtyRankGauntletLaunch performer={props.performer} />
        </React.Fragment> : result;
      });
      PluginApi.patch.instead("PerformerList", (...args) => {
        const next = args.pop(), props = args[0];
        if (!life.isActive()) return next.apply(null, args);
        if (props?.filter && props.extraCriteria?.dirtyRankLeaderboardFilter && window.location.pathname.startsWith(LEADERBOARDS_ROUTE_PATH)) return <views.DirtyRankLeaderboardFilterCapture filter={props.filter} />;
        return views.isPerformerListRoute() && props?.filter?.[OVERALL_SORT_ACTIVE]
          ? <views.DirtyRankSortedPerformerList listProps={props} next={next} /> : next.apply(null, args);
      });
      PluginApi.patch.before("MainNavBar.UtilityItems", props => life.isActive()
        ? [{
          children: <React.Fragment>
            {props.children}
            <Navigation />
          </React.Fragment>
        }] : [props]);
      instance.status = "active"; DirtyPlugins.debugLog(PLUGIN_ID, "script finished registering");
    } catch (error) {
      destroy(); instance.status = "failed";
      if (!registrationAttempted) delete globals[INSTANCE_KEY];
      console.error("[DirtyRank] registration failed", error);
    } finally { globals.__dirtyCurrentPluginId = null; }
  }
}
