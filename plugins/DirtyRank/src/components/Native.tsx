import {
  getOverallSortRevision,
  getOverallSortSettings,
  loadRatingIndex,
  performerCategoryRanks,
  queryPerformers,
  refreshOverallSortSettings,
  sortPerformersByOverall,
  subscribeToOverallSortSettings,
} from "../domain/rank";
import { leaderboardStatPath } from "../domain/navigation";
import { useOverallScores } from "./useOverallScores";
import { boxFor, CONFIGURATION_CHANGED_EVENT, settingsFromConfiguration } from "../domain/settings";
import { DirtyPlugins, PluginApi, React, Router, ui } from "../runtime";
import type * as R from "react";
import type { NativeProps } from "../../../DirtyPlugins/src/types";
import {
  GAUNTLET_ROUTE_PATH,
  LEADERBOARDS_ROUTE_PATH,
  OVERALL_SORT_ACTIVE,
  OVERALL_SORT_DIRECTION,
  OVERALL_SORT_LABEL,
  OVERALL_SORT_MESSAGE_ID,
  OVERALL_SORT_PAGE,
  OVERALL_SORT_PAGE_SIZE,
  OVERALL_SORT_VALUE,
  PERFORMERS_ROUTE_PATH,
  PLUGIN_ID,
  ROUTE_PATH,
} from "../constants";
import type { ConfigurationEvent, RankPerformer, RankSettings } from "../types";
const overallFilterHookCache = new WeakMap();
export function isPerformerListRoute() {
  return window.location.pathname === PERFORMERS_ROUTE_PATH;
}

function addOverallSortOption(filter: NativeProps) {
  const options = filter && filter.options && filter.options.sortByOptions;
  if (!Array.isArray(options)) return;
  if (options.some(option => option.value === OVERALL_SORT_VALUE)) return;
  options.push({
    messageID: OVERALL_SORT_MESSAGE_ID,
    value: OVERALL_SORT_VALUE,
  });
}

function applyOverallPerformerFilter(filter: NativeProps, originalHook?: (filter: NativeProps) => NativeProps) {
  addOverallSortOption(filter);
  let effective = originalHook ? originalHook(filter) : filter;
  if (!effective) effective = filter;
  if (filter.sortBy !== OVERALL_SORT_VALUE) return effective;

  const queryFilter = effective.clone();
  queryFilter.sortBy = "name";
  queryFilter.sortDirection = "ASC";
  queryFilter.currentPage = 1;
  queryFilter.itemsPerPage = -1;
  queryFilter[OVERALL_SORT_ACTIVE] = true;
  queryFilter[OVERALL_SORT_PAGE] = filter.currentPage;
  queryFilter[OVERALL_SORT_PAGE_SIZE] = filter.itemsPerPage;
  queryFilter[OVERALL_SORT_DIRECTION] = filter.sortDirection;
  return queryFilter;
}

function defaultOverallPerformerFilterHook(filter: NativeProps) {
  return applyOverallPerformerFilter(filter, undefined);
}

export function overallPerformerFilterHook(originalHook?: (filter: NativeProps) => NativeProps) {
  if (typeof originalHook !== "function") return defaultOverallPerformerFilterHook;
  if (!overallFilterHookCache.has(originalHook)) {
    overallFilterHookCache.set(originalHook, (filter: NativeProps) =>
      applyOverallPerformerFilter(filter, originalHook),
    );
  }
  return overallFilterHookCache.get(originalHook);
}

export function DirtyRankPerformerListShell(props: { children?: R.ReactNode }): R.JSX.Element {
  const intl = PluginApi.libraries.Intl.useIntl();
  if (intl.messages && !Object.prototype.hasOwnProperty.call(intl.messages, OVERALL_SORT_MESSAGE_ID)) {
    intl.messages[OVERALL_SORT_MESSAGE_ID] = OVERALL_SORT_LABEL;
  }
  return <React.Fragment>{props.children}</React.Fragment>;
}

export function DirtyRankSortedPerformerList(props: NativeProps): R.JSX.Element | null {
  const settings = getOverallSortSettings();
  const scores = useOverallScores(settings, settings.enabledCohorts);

  const listProps = props.listProps;
  const filter = listProps.filter;
  const currentPage = Number(filter[OVERALL_SORT_PAGE]) || 1;
  const pageSize = Number(filter[OVERALL_SORT_PAGE_SIZE]) || 40;
  const direction = filter[OVERALL_SORT_DIRECTION] || "ASC";
  const pagePerformers = React.useMemo(() => {
    if (!scores.ready) return [];
    const sorted = sortPerformersByOverall(
      Array.isArray(listProps.performers) ? listProps.performers : [],
      direction,
      settings,
    );
    const start = Math.max(0, (currentPage - 1) * pageSize);
    return sorted.slice(start, start + pageSize);
  }, [currentPage, direction, listProps.performers, pageSize, scores.ready, scores.revision, settings]);

  if (!scores.ready)
    return (
      <ui.StateView
        title={scores.error ? "Could not calculate DirtyRank scores" : "Calculating DirtyRank scores…"}
        detail={scores.error}
        actions={scores.error ? <ui.Button onClick={scores.retry}>Retry</ui.Button> : undefined}
      />
    );

  return props.next(Object.assign({}, listProps, { performers: pagePerformers }));
}

export function DirtyRankBattleNavLink(): R.JSX.Element | null {
  return (
    <ui.NavAction
      as={Router.NavLink}
      className="dirty-rank-nav-link"
      exact={false}
      icon={<ui.NavIcon name="battles" />}
      label="DirtyRank performer battles"
      to={ROUTE_PATH}
    />
  );
}

export function DirtyRankGauntletLaunch(props: { performer: RankPerformer }): R.JSX.Element | null {
  const [revision, setRevision] = React.useState(getOverallSortRevision);
  React.useEffect(() => {
    const unsubscribe = subscribeToOverallSortSettings(setRevision);
    setRevision(getOverallSortRevision());
    void Promise.all([
      refreshOverallSortSettings(),
      loadRatingIndex(),
      queryPerformers(false, { refresh: false }),
    ]).catch(error => console.error("DirtyRank could not load profile ranks", error));
    return unsubscribe;
  }, []);
  const settings = getOverallSortSettings();
  const ranks = React.useMemo(
    () => performerCategoryRanks(props.performer, settings),
    [props.performer, settings, revision],
  );
  const multipleBoxes = new Set(ranks.map(entry => entry.cohort)).size > 1;
  return (
    <div className="dirty-rank-gauntlet-launch">
      <Router.NavLink
        className="btn btn-secondary dirty-rank-gauntlet-launch-button"
        title="Refine this performer's category ratings through focused DirtyRank battles"
        to={GAUNTLET_ROUTE_PATH.replace(":performerId", props.performer.id)}
      >
        <span aria-hidden="true">⚔</span>
        {" Start Gauntlet"}
      </Router.NavLink>
      {ranks.map(({ category, cohort, rank }) => {
        const box = boxFor(settings, cohort).name;
        const label = category.name + " #" + rank.toLocaleString();
        return (
          <Router.NavLink
            key={cohort + ":" + category.id}
            className="btn btn-secondary dirty-rank-profile-rank-button"
            title={box + " · " + label + " · View leaderboard"}
            to={DirtyPlugins.captureUrl(leaderboardStatPath(category.id, cohort))}
          >
            {multipleBoxes ? box + " · " + label : label}
          </Router.NavLink>
        );
      })}
    </div>
  );
}

export function DirtyRankLeaderboardsNavLink(): R.JSX.Element | null {
  return (
    <ui.NavAction
      as={Router.NavLink}
      className="dirty-rank-nav-link dirty-rank-leaderboards-nav-link"
      exact={true}
      icon={<ui.NavIcon name="leaderboards" />}
      label="DirtyRank leaderboards"
      to={LEADERBOARDS_ROUTE_PATH}
    />
  );
}

export function DirtyRankNavLinks(): R.JSX.Element | null {
  const [navigation, setNavigation] = React.useState<RankSettings | null>(null);

  React.useEffect(() => {
    let active = true;
    function refreshNavigation() {
      DirtyPlugins.getPluginSettings(PLUGIN_ID)
        .then(configuration => {
          if (active) setNavigation(settingsFromConfiguration(configuration));
        })
        .catch(error => {
          console.error("DirtyRank could not refresh navigation settings", error);
        });
    }
    function configurationChanged(event: ConfigurationEvent) {
      if (!event.detail || event.detail.pluginId === PLUGIN_ID) refreshNavigation();
    }
    refreshNavigation();
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, configurationChanged);
    return () => {
      active = false;
      window.removeEventListener(CONFIGURATION_CHANGED_EVENT, configurationChanged);
    };
  }, []);

  return (
    <React.Fragment>
      {navigation && navigation.showBattlesInMenu && <DirtyRankBattleNavLink />}
      {navigation && navigation.showLeaderboardsInMenu && <DirtyRankLeaderboardsNavLink />}
    </React.Fragment>
  );
}
