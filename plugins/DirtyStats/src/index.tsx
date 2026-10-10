import { AgePage } from "./components/Ages";
import { BirthdayPage } from "./components/Birthdays";
import { ConstellationPage } from "./components/Constellation";
import { CountRatingPage, RepeatOffenderPage } from "./components/Counters";
import { DashboardFilterCapture, PerformerFilterCapture } from "./components/Filters";
import { GrowthPage } from "./components/Growth";
import { StatsPage } from "./components/Origin";
import { QualityEfficiencyPage } from "./components/Quality";
import { RatingPage } from "./components/Ratings";
import { DirtyStatsRoute, NavIcon } from "./components/Route";
import { PerformerScatterPage } from "./components/Scatter";
import { StudioValuePage } from "./components/Studios";
import { TagDnaPage } from "./components/Tags";
import { entries, route } from "./domain/registry";
import { api, filterBridge, hub, PLUGIN_ID, React } from "./runtime";
import { loadStatsSettings, startStatsSettings, syncSuiteTheme } from "./settings";

// Stats pages that render inside Stash's native scene list on their own routes.
const SCENE_PAGES = {
  constellation: ConstellationPage,
  ratings: RatingPage,
  ages: AgePage,
  growth: GrowthPage,
  studios: StudioValuePage,
  tags: TagDnaPage,
  countRating: CountRatingPage,
  repeatOffenders: RepeatOffenderPage,
  qualityEfficiency: QualityEfficiencyPage,
};

hub?.registerPlugin(PLUGIN_ID, () => {
  api.register.route(route, DirtyStatsRoute);
  api.patch.instead("PerformerList", (...args) => {
    const next = args.pop(),
      props = args[0];
    const path = window.location.pathname;
    if (path === entries.dashboard.route && filterBridge.activeEntity === "performers" && props?.filter)
      return <DashboardFilterCapture entity="performers" filter={props.filter} />;
    if (path === entries.ages.route && props?.extraCriteria?.dirtyStatsAgeFilters)
      return <PerformerFilterCapture filter={props.filter} />;
    if (path === entries.performerRatings.route && props?.extraCriteria?.dirtyStats)
      return <RatingPage filter={props.filter} performerMode={true} />;
    if (path === entries.performerScatter.route && props?.extraCriteria?.dirtyStats)
      return <PerformerScatterPage filter={props.filter} />;
    if (path === entries.birthdays.route && props?.extraCriteria?.dirtyStats)
      return <BirthdayPage filter={props.filter} />;
    if (path !== route || !props?.extraCriteria?.dirtyStats) return next.apply(null, args);
    return <StatsPage filter={props.filter} />;
  });
  api.patch.instead("SceneList", (...args) => {
    const next = args.pop(),
      props = args[0];
    const path = window.location.pathname;
    if (path === entries.dashboard.route && filterBridge.activeEntity === "scenes" && props?.filter)
      return <DashboardFilterCapture entity="scenes" filter={props.filter} />;
    const key = (Object.keys(SCENE_PAGES) as (keyof typeof SCENE_PAGES)[]).find(key => entries[key].route === path);
    const Page = key ? SCENE_PAGES[key] : null;
    return Page && props?.filter ? <Page filter={props.filter} /> : next.apply(null, args);
  });
  api.patch.before("MainNavBar.UtilityItems", props => [
    {
      children: (
        <React.Fragment>
          {props.children}
          <NavIcon />
        </React.Fragment>
      ),
    },
  ]);
  window.addEventListener("dirty-plugins:configuration-changed", event => {
    if ((event as CustomEvent<{ pluginId: string }>).detail?.pluginId === PLUGIN_ID) void loadStatsSettings();
  });
  hub.theme.subscribe(syncSuiteTheme);
  void startStatsSettings();
});
