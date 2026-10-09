import type * as R from "react";
import type { ViewDependencies } from "../view";
export function createRoute(dependencies: ViewDependencies) {
  const { statsThemeClass, useStatsSetting, StatsSaveStatus, StatsState, StatisticSelector, FilterStatisticSelector, nativeFilterQuery, statisticFilterSearch, setStatsSettingExtra, api, hub, React, dashboardRoute, growthRoute, ageRoute, ratingRoute, performerRatingRoute, performerScatterRoute, countRatingRoute, repeatOffenderRoute, qualityEfficiencyRoute, constellationRoute, studioRoute, tagDnaRoute, birthdayRoute, STATISTIC_LABELS } = dependencies;
  function DirtyStatsRoute(): R.ReactElement | null {
    var page = React.useRef<HTMLElement>(null);
    var themeState = useStatsSetting("visualTheme"), visualTheme = themeState[0];
    var themeClass = statsThemeClass(visualTheme);
    var location = api.libraries.ReactRouterDOM.useLocation();
    var history = api.libraries.ReactRouterDOM.useHistory();
    var statistic = location.pathname === dashboardRoute ? "dashboard" : location.pathname === performerScatterRoute ? "performerScatter" : location.pathname === countRatingRoute ? "countRating" : location.pathname === repeatOffenderRoute ? "repeatOffenders" : location.pathname === qualityEfficiencyRoute ? "qualityEfficiency" : location.pathname === studioRoute ? "studios" : location.pathname === tagDnaRoute ? "tags" : location.pathname === constellationRoute ? "constellation" : location.pathname === birthdayRoute ? "birthdays" : location.pathname === performerRatingRoute ? "performerRatings" : location.pathname === ratingRoute ? "ratings" : location.pathname === ageRoute ? "ages" : location.pathname === growthRoute ? "growth" : "origin";
    hub.react.usePageTitle("DirtyStats", STATISTIC_LABELS[statistic]);
    var sceneView = statistic !== "origin" && statistic !== "performerRatings" && statistic !== "performerScatter" && statistic !== "birthdays";
    // Readiness belongs to the view that loaded its native components. A route
    // change renders before its effect runs, so a shared boolean can mount the
    // next view's controls while their lazy components are still undefined.
    var state = React.useState<string | null>(null), ready = state[0] === statistic, setReadyStatistic = state[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    React.useEffect(function () {
      var active = true;
      setReadyStatistic(null); setError("");
      if (statistic === "dashboard") return function () { active = false; };
      (async function () {
        await dependencies.statsSettingsReady;
        if (!active) return;
        var search = statisticFilterSearch(statistic, location.search);
        if (search !== location.search) history.replace(Object.assign({}, location, { search: search }));
        if (sceneView) {
          await hub.native.ensureComponents("SceneList", ["FilteredSceneList", "SceneCard"]);
        } else {
          await hub.native.ensureComponents("Performers", ["FilteredPerformerList", "PerformerCard"]);
        }
        if (statistic === "ages") await hub.native.ensureComponents("Performers", ["FilteredPerformerList", "PerformerCard"]);
        if (active) setReadyStatistic(statistic);
      })().catch(function (err) { if (active) setError(err.message); });
      return function () { active = false; };
    }, [sceneView, statistic]);
    React.useEffect(function () {
      if (!ready || statistic === "dashboard") return;
      var query = nativeFilterQuery(location.search);
      if (query) setStatsSettingExtra("statisticFilter_" + statistic, query);
    }, [ready, statistic, location.search]);
    if (statistic === "dashboard") {
      var Dashboard = dependencies.views.Dashboard;
      return (<main ref={page} className={"dirty-stats-page dirty-stats-dashboard-page " + themeClass}>

        <StatsSaveStatus />

        {Dashboard ? (<Dashboard selector={(<StatisticSelector value={statistic} />)} />) : (<p role="status">

          {"Loading dashboard..."}

        </p>)}

      </main>);
    }
    return (<main ref={page} className={"dirty-stats-page dirty-stats-native-filters " + themeClass}>

      <StatsSaveStatus />

      {ready ? (<FilterStatisticSelector page={page} value={statistic} />) : null}

      {error ? (<StatsState detail={error} role="alert" title="Could not load the native filters" />) : ready && (statistic !== "ages" || api.components.PerformerCard) && (sceneView ? api.components.FilteredSceneList : api.components.FilteredPerformerList) ? (React.createElement(sceneView ? api.components.FilteredSceneList : api.components.FilteredPerformerList, { "key": statistic, "view": sceneView ? "scenes" : "performers", "alterQuery": true, "extraCriteria": { dirtyStats: true } })) : (<StatsState detail="Loading filters…" title="Loading" />)}

    </main>);
  }

  function NavIcon(): R.ReactElement | null {
    return (<hub.react.NavAction
      to={dashboardRoute}
      label="Open DirtyStats dashboard"
      className="dirty-stats-nav dirty-stats-nav-button"
      icon={(<svg viewBox="0 0 24 24" aria-hidden={true}>

        <rect x={2} y={2} width={20} height={20} rx={0.3} fill="var(--dirty-ui-icon-white)" />

        <rect x={3} y={3} width={18} height={18} fill="var(--dirty-ui-icon-black)" />

        <rect x={3} y={3} width={11} height={10} fill="var(--dirty-ui-icon-red)" />

        <rect x={16} y={3} width={5} height={5} fill="var(--dirty-ui-icon-white)" />

        <rect x={16} y={10} width={5} height={11} fill="var(--dirty-ui-icon-blue)" />

        <rect x={3} y={15} width={11} height={6} fill="var(--dirty-ui-icon-white)" />

      </svg>)} />);
  }
  return { DirtyStatsRoute, NavIcon };
}
