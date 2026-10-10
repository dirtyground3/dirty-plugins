import {
  getOverallSortRevision,
  getOverallSortSettings,
  sortPerformersByOverall,
  subscribeToOverallSortSettings,
} from "../domain/rank";
import { CONFIGURATION_CHANGED_EVENT, settingsFromConfiguration } from "../domain/settings";
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
  const [revision, setRevision] = React.useState(getOverallSortRevision());
  React.useEffect(() => subscribeToOverallSortSettings(setRevision), []);

  const listProps = props.listProps;
  const filter = listProps.filter;
  const currentPage = Number(filter[OVERALL_SORT_PAGE]) || 1;
  const pageSize = Number(filter[OVERALL_SORT_PAGE_SIZE]) || 40;
  const direction = filter[OVERALL_SORT_DIRECTION] || "ASC";
  const pagePerformers = React.useMemo(() => {
    const sorted = sortPerformersByOverall(
      Array.isArray(listProps.performers) ? listProps.performers : [],
      direction,
      getOverallSortSettings(),
    );
    const start = Math.max(0, (currentPage - 1) * pageSize);
    return sorted.slice(start, start + pageSize);
  }, [currentPage, direction, listProps.performers, pageSize, revision]);

  return props.next(Object.assign({}, listProps, { performers: pagePerformers }));
}

export function DirtyRankBattleNavLink(): R.JSX.Element | null {
  return (
    <ui.NavAction
      as={Router.NavLink}
      className="dirty-rank-nav-link dirty-rank-nav-button"
      exact={false}
      icon={RankNavGlyph("battle")}
      label="DirtyRank performer battles"
      to={ROUTE_PATH}
    />
  );
}

export function DirtyRankGauntletLaunch(props: { performer: RankPerformer }): R.JSX.Element | null {
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
    </div>
  );
}

function RankNavGlyph(kind: string): R.JSX.Element | null {
  return (
    <i aria-hidden="true" className="dirty-rank-nav-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--dirty-ui-icon-white)" strokeWidth="1.8">
        {kind === "battle" ? (
          ["red", "blue"].map((color, index) => {
            return (
              <g
                key={color}
                transform={index ? "translate(24 0) scale(-1 1)" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              >
                <path
                  d="M2.5 2.5l4 1L17 14l-3 3L3.5 6.5z"
                  fill={"var(--dirty-ui-icon-" + color + ")"}
                  strokeWidth="0.7"
                />
                <path d="M16.5 16.5l4 4" strokeWidth="3.2" />
                <path d="M16.5 16.5l4 4" stroke="var(--dirty-ui-icon-blue)" strokeWidth="1.6" />
                <path d="M12.5 18.5l6-6M19 22l3-3" strokeWidth="1.8" />
              </g>
            );
          })
        ) : (
          <React.Fragment>
            <path d="M7 5H4v2c0 2 1 3 4 4" stroke="var(--dirty-ui-icon-red)" />
            <path d="M17 5h3v2c0 2-1 3-4 4" stroke="var(--dirty-ui-icon-blue)" />
            <path d="M7 3h10v6c0 3-2 5-5 5s-5-2-5-5V3z" fill="var(--dirty-ui-icon-blue)" />
            <path d="M12 14v5M8 21h8M10 19h4" />
          </React.Fragment>
        )}
      </svg>
    </i>
  );
}

export function DirtyRankLeaderboardsNavLink(): R.JSX.Element | null {
  return (
    <ui.NavAction
      as={Router.NavLink}
      className="dirty-rank-nav-link dirty-rank-leaderboards-nav-link dirty-rank-nav-button"
      exact={true}
      icon={RankNavGlyph("leaderboard")}
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
