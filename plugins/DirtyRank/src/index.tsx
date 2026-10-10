import { DirtyRankRoute } from "./components/Battles";
import { DirtyRankLeaderboardFilterCapture, DirtyRankLeaderboardsRoute } from "./components/Leaderboards";
import {
  DirtyRankGauntletLaunch,
  DirtyRankNavLinks,
  DirtyRankPerformerListShell,
  DirtyRankSortedPerformerList,
  isPerformerListRoute,
  overallPerformerFilterHook,
} from "./components/Native";
import {
  BATTLE_CATEGORY_ROUTE_PATH,
  GAUNTLET_ROUTE_PATH,
  LEADERBOARDS_ROUTE_PATH,
  OVERALL_SORT_ACTIVE,
  PLUGIN_ID,
  ROUTE_PATH,
} from "./constants";
import { loadRatingIndex, queryPerformers, refreshOverallSortSettings } from "./domain/rank";
import { CONFIGURATION_CHANGED_EVENT } from "./domain/settings";
import { DirtyPlugins, PluginApi, React } from "./runtime";
import { DirtyRankSettings } from "./settingsPanel";
import type { ConfigurationEvent } from "./types";

DirtyPlugins?.registerPlugin(PLUGIN_ID, () => {
  PluginApi.register.route(ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(BATTLE_CATEGORY_ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(GAUNTLET_ROUTE_PATH, DirtyRankRoute);
  PluginApi.register.route(GAUNTLET_ROUTE_PATH + "/:categoryId", DirtyRankRoute);
  PluginApi.register.route(LEADERBOARDS_ROUTE_PATH + "/:statistic?", DirtyRankLeaderboardsRoute);
  DirtyPlugins.registerSettingsPanel(PLUGIN_ID, DirtyRankSettings);
  void refreshOverallSortSettings();
  void Promise.all([loadRatingIndex(), queryPerformers(false, { refresh: false })]).catch(error =>
    console.error("DirtyRank could not load its reference population", error),
  );
  window.addEventListener(CONFIGURATION_CHANGED_EVENT, event => {
    const detail = (event as ConfigurationEvent).detail;
    if (!detail || detail.pluginId === PLUGIN_ID) void refreshOverallSortSettings();
  });
  PluginApi.patch.before("FilteredPerformerList", props =>
    isPerformerListRoute() && props
      ? [{ ...props, filterHook: overallPerformerFilterHook(props.filterHook) }]
      : [props],
  );
  PluginApi.patch.after("FilteredPerformerList", (...args) => {
    const result = args.pop();
    return isPerformerListRoute() ? <DirtyRankPerformerListShell>{result}</DirtyRankPerformerListShell> : result;
  });
  PluginApi.patch.after("PerformerDetailsPanel", (...args) => {
    const result = args.pop(),
      props = args[0];
    return props?.performer?.id ? (
      <React.Fragment>
        {result}
        <DirtyRankGauntletLaunch performer={props.performer} />
      </React.Fragment>
    ) : (
      result
    );
  });
  PluginApi.patch.instead("PerformerList", (...args) => {
    const next = args.pop(),
      props = args[0];
    if (
      props?.filter &&
      props.extraCriteria?.dirtyRankLeaderboardFilter &&
      window.location.pathname.startsWith(LEADERBOARDS_ROUTE_PATH)
    )
      return <DirtyRankLeaderboardFilterCapture filter={props.filter} />;
    return isPerformerListRoute() && props?.filter?.[OVERALL_SORT_ACTIVE] ? (
      <DirtyRankSortedPerformerList listProps={props} next={next} />
    ) : (
      next.apply(null, args)
    );
  });
  PluginApi.patch.before("MainNavBar.UtilityItems", props => [
    {
      children: (
        <React.Fragment>
          {props.children}
          <DirtyRankNavLinks />
        </React.Fragment>
      ),
    },
  ]);
});
