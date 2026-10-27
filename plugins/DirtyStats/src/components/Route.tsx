import { DashboardPage as Dashboard } from "../dashboard/Page";
import { FilterStatisticSelector, StatisticSelector } from "./Filters";
import { StatsSaveStatus, StatsState } from "./Primitives";
import { nativeFilterQuery, statisticFilterSearch } from "../domain/filters";
import {
  STATISTIC_LABELS,
  ageRoute,
  birthdayRoute,
  constellationRoute,
  countRatingRoute,
  dashboardRoute,
  growthRoute,
  performerRatingRoute,
  performerScatterRoute,
  performerSceneRatingsRoute,
  qualityEfficiencyRoute,
  ratingRoute,
  repeatOffenderRoute,
  studioRoute,
  tagDnaRoute,
} from "../domain/registry";
import { React, api, charts, hub, loadCharts } from "../runtime";
import { setStatsSettingExtra, statsThemeClass, useStatsSetting, statsSettingsReady } from "../settings";
import type * as R from "react";
export function DirtyStatsRoute(): R.ReactElement | null {
  const page = React.useRef<HTMLElement>(null);
  const [visualTheme] = useStatsSetting("visualTheme");
  const themeClass = statsThemeClass(visualTheme);
  const location = api.libraries.ReactRouterDOM.useLocation();
  const history = api.libraries.ReactRouterDOM.useHistory();
  const statistic =
    location.pathname === dashboardRoute
      ? "dashboard"
      : location.pathname === performerScatterRoute
        ? "performerScatter"
        : location.pathname === performerSceneRatingsRoute
          ? "performerSceneRatings"
          : location.pathname === countRatingRoute
            ? "countRating"
            : location.pathname === repeatOffenderRoute
              ? "repeatOffenders"
              : location.pathname === qualityEfficiencyRoute
                ? "qualityEfficiency"
                : location.pathname === studioRoute
                  ? "studios"
                  : location.pathname === tagDnaRoute
                    ? "tags"
                    : location.pathname === constellationRoute
                      ? "constellation"
                      : location.pathname === birthdayRoute
                        ? "birthdays"
                        : location.pathname === performerRatingRoute
                          ? "performerRatings"
                          : location.pathname === ratingRoute
                            ? "ratings"
                            : location.pathname === ageRoute
                              ? "ages"
                              : location.pathname === growthRoute
                                ? "growth"
                                : "origin";
  hub.react.usePageTitle("DirtyStats", STATISTIC_LABELS[statistic]);
  const sceneView =
    statistic !== "origin" &&
    statistic !== "performerRatings" &&
    statistic !== "performerScatter" &&
    statistic !== "performerSceneRatings" &&
    statistic !== "birthdays";
  // Readiness belongs to the view that loaded its native components. A route
  // change renders before its effect runs, so a shared boolean can mount the
  // next view's controls while their lazy components are still undefined.
  const state = React.useState<string | null>(null),
    ready = state[0] === statistic,
    setReadyStatistic = state[1];
  const [error, setError] = React.useState("");
  // Every Stats view renders inside this route, so it waits here for the separate chart file.
  const [chartsReady, setChartsReady] = React.useState(Boolean(charts));
  const [chartsError, setChartsError] = React.useState("");
  React.useEffect(() => {
    if (chartsReady) return;
    let active = true;
    loadCharts().then(
      () => {
        if (active) setChartsReady(true);
      },
      (err: Error) => {
        if (active) setChartsError((err.message || String(err)) + " Reload the Stash page to try again.");
      },
    );
    return () => {
      active = false;
    };
  }, []);
  React.useEffect(() => {
    let active = true;
    setReadyStatistic(null);
    setError("");
    if (statistic === "dashboard")
      return () => {
        active = false;
      };
    (async () => {
      await statsSettingsReady;
      if (!active) return;
      const search = statisticFilterSearch(statistic, location.search);
      if (search !== location.search) history.replace(Object.assign({}, location, { search }));
      if (sceneView) {
        await hub.native.ensureComponents("SceneList", ["FilteredSceneList", "SceneCard"]);
      } else {
        await hub.native.ensureComponents("Performers", ["FilteredPerformerList", "PerformerCard"]);
      }
      if (statistic === "ages")
        await hub.native.ensureComponents("Performers", ["FilteredPerformerList", "PerformerCard"]);
      if (active) setReadyStatistic(statistic);
    })().catch(err => {
      if (active) setError(err.message);
    });
    return () => {
      active = false;
    };
  }, [sceneView, statistic]);
  React.useEffect(() => {
    if (!ready || statistic === "dashboard") return;
    const query = nativeFilterQuery(location.search);
    if (query) setStatsSettingExtra("statisticFilter_" + statistic, query);
  }, [ready, statistic, location.search]);
  if (!chartsReady)
    return (
      <main ref={page} className={"dirty-stats-page " + themeClass}>
        {chartsError ? (
          <StatsState detail={chartsError} role="alert" title="Could not load the charts" />
        ) : (
          <StatsState title="Loading charts…" />
        )}
      </main>
    );
  if (statistic === "dashboard") {
    return (
      <main ref={page} className={"dirty-stats-page dirty-stats-dashboard-page " + themeClass}>
        <StatsSaveStatus />
        {Dashboard ? (
          <Dashboard selector={<StatisticSelector value={statistic} />} />
        ) : (
          <p role="status">Loading dashboard...</p>
        )}
      </main>
    );
  }
  return (
    <main ref={page} className={"dirty-stats-page dirty-stats-native-filters " + themeClass}>
      <StatsSaveStatus />
      {ready ? <FilterStatisticSelector page={page} value={statistic} /> : null}
      {error ? (
        <StatsState detail={error} role="alert" title="Could not load the native filters" />
      ) : ready &&
        (statistic !== "ages" || api.components.PerformerCard) &&
        (sceneView ? api.components.FilteredSceneList : api.components.FilteredPerformerList) ? (
        React.createElement(sceneView ? api.components.FilteredSceneList : api.components.FilteredPerformerList, {
          key: statistic,
          view: sceneView ? "scenes" : "performers",
          alterQuery: true,
          extraCriteria: { dirtyStats: true },
        })
      ) : (
        <StatsState detail="Loading filters…" title="Loading" />
      )}
    </main>
  );
}

/** Header button to the dashboard; hidden until settings load and while `showInMenu` is off. */
export function NavIcon(): R.ReactElement | null {
  const [shown] = useStatsSetting("showInMenu");
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    void statsSettingsReady.then(() => {
      if (active) setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!loaded || !shown) return null;
  return (
    <hub.react.NavAction
      to={dashboardRoute}
      label="Open DirtyStats dashboard"
      className="dirty-stats-nav dirty-stats-nav-button"
      icon={
        <svg viewBox="2 2 20 20" aria-hidden={true}>
          <rect x={2} y={2} width={20} height={20} rx={0.3} fill="var(--dirty-ui-icon-white)" />
          <rect x={3} y={3} width={18} height={18} fill="var(--dirty-ui-icon-black)" />
          <rect x={5} y={5} width={0.9} height={14.5} fill="var(--dirty-ui-icon-white)" />
          <rect x={5} y={18.6} width={14.5} height={0.9} fill="var(--dirty-ui-icon-white)" />
          <circle cx={10} cy={13} r={3.6} fill="var(--dirty-ui-icon-red)" />
          <circle cx={16} cy={8.2} r={2.6} fill="var(--dirty-ui-icon-blue)" />
          <circle cx={16.5} cy={15} r={1.8} fill="var(--dirty-ui-icon-white)" />
        </svg>
      }
    />
  );
}
