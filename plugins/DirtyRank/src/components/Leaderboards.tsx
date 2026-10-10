import {
  ConfidenceIndicator,
  Field,
  LeaderboardInfoPopover,
  LeaderboardStat,
  OverallConfidence,
  RankButton,
  RankStatisticSelector,
} from "./Primitives";
import {
  battleCategoryPath,
  leaderboardIdFromPath,
  leaderboardStatPath,
  leaderboardTopCount,
} from "../domain/navigation";
import {
  filteredLeaderboardEntries,
  filteredLeaderboardPanelProps,
  leaderboardData,
  leaderboardEntries,
  leaderboardFeaturedCount,
  leaderboardPageSize,
  leaderboardPoolFor,
  leaderboardRatingText,
  leaderboardStandingEntries,
  loadNativePerformerCard,
  loadRatingIndex,
  overallCategoryScoresTitle,
  paginatedLeaderboard,
  queryLeaderboardPerformerIds,
  queryPerformers,
  serializeLeaderboardPerformerFilter,
} from "../domain/rank";
import { CONFIGURATION_CHANGED_EVENT, boxOptions, categoriesFor, settingsFromConfiguration } from "../domain/settings";
import { DirtyPlugins, PluginApi, React, Router, documentationCapture, ui } from "../runtime";
import type * as R from "react";
import { LEADERBOARD_TOP_OPTIONS, OVERALL_LEADERBOARD_ID, PLUGIN_ID, ROUTE_PATH } from "../constants";
import { linkedBox } from "../domain/navigation";
import type {
  ConfigurationEvent,
  LeaderboardProps,
  PerformerFilter,
  PerformerFilterModel,
  RankPerformer,
  RankSettings,
} from "../types";
let leaderboardFilterListener: ((model: PerformerFilterModel) => void) | null = null;
export function LeaderboardPodium(props: LeaderboardProps): R.JSX.Element | null {
  const NativePerformerCard = PluginApi.components && PluginApi.components.PerformerCard;
  const topCount = leaderboardTopCount(props.topCount);
  const showcase = LEADERBOARD_TOP_OPTIONS.filter(option => option.count === topCount)[0];
  const top = props.ranked.slice(0, topCount);
  const podiumOrder = [1, 0, 2];
  const displayOrder = topCount === 3 ? podiumOrder : top.map((_performer, index) => index);
  if (!top.length) {
    return (
      <ui.StateView
        title="No rated performers"
        detail="Complete a battle in this category to create its leaderboard."
      />
    );
  }
  return (
    <section
      aria-label={showcase.name}
      className={
        "dirty-rank-podium" +
        (topCount > 3 ? " dirty-rank-podium-expanded dirty-rank-showcase dirty-rank-showcase-" + showcase.theme : "")
      }
      style={{ "--dirty-rank-top-count": topCount } as R.CSSProperties}
    >
      {displayOrder
        .filter(index => top[index])
        .map(index => {
          const performer = top[index];
          const pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
          return (
            <article
              className={"dirty-rank-podium-place d-flex flex-column dirty-rank-podium-" + (index + 1)}
              key={performer.id}
            >
              <div className={NativePerformerCard ? "dirty-rank-native-card" : "dirty-rank-podium-card"}>
                {NativePerformerCard ? (
                  <NativePerformerCard performer={performer} />
                ) : (
                  <Router.NavLink className="dirty-rank-podium-image-link" to={"/performers/" + performer.id}>
                    {performer.image_path ? (
                      <img alt="" className="dirty-rank-podium-image" loading="lazy" src={performer.image_path} />
                    ) : (
                      <div className="dirty-rank-podium-placeholder d-flex align-items-center justify-content-center">
                        ◇
                      </div>
                    )}
                  </Router.NavLink>
                )}
                <div className="dirty-rank-podium-copy text-center">
                  {!NativePerformerCard && (
                    <Router.NavLink className="dirty-rank-podium-name text-truncate" to={"/performers/" + performer.id}>
                      {performer.name}
                    </Router.NavLink>
                  )}
                  <div className="dirty-rank-leaderboard-rating-row">
                    <strong className="dirty-rank-leaderboard-rank">{"#" + (index + 1)}</strong>
                    <strong
                      className="dirty-rank-podium-rating"
                      title={overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings)}
                    >
                      {leaderboardRatingText(pool, props.settings)}
                    </strong>
                  </div>
                </div>
              </div>
              {topCount === 3 && (
                <div aria-hidden="true" className="dirty-rank-podium-step">
                  <span>{index + 1}</span>
                </div>
              )}
              {topCount > 3 && (
                <div aria-hidden="true" className="dirty-rank-showcase-base">
                  <span>{topCount === 4 ? ["I", "II", "III", "IV"][index] : index + 1}</span>
                </div>
              )}
            </article>
          );
        })}
    </section>
  );
}

export function LeaderboardPagination(props: {
  totalPages: number;
  page: number;
  firstRank: number;
  lastRank: number;
  onPageChange(page: number): void;
}): R.JSX.Element | null {
  if (props.totalPages <= 1) return null;
  const summary =
    "Page " +
    props.page.toLocaleString() +
    " of " +
    props.totalPages.toLocaleString() +
    " · ranks " +
    props.firstRank.toLocaleString() +
    "–" +
    props.lastRank.toLocaleString();
  return (
    <ui.Pagination
      ariaLabel="Leaderboard pages"
      className="dirty-rank-pagination"
      onPageChange={props.onPageChange!}
      page={props.page}
      summary={summary}
      totalPages={props.totalPages}
    />
  );
}

export function DirtyRankLeaderboardFilterCapture(props: { filter: PerformerFilter }): R.JSX.Element | null {
  const model = serializeLeaderboardPerformerFilter(props.filter);
  const key = JSON.stringify(model);
  React.useEffect(() => {
    if (leaderboardFilterListener) leaderboardFilterListener(model);
  }, [key]);
  return null;
}

/** The standings below the featured performers, paged in whole featured rows. */
function standingsPage(props: LeaderboardProps) {
  const entries = leaderboardStandingEntries(props);
  const ranked = props.ranked || entries.map(entry => entry.performer);
  const topCount = leaderboardFeaturedCount(props);
  const pageSize = leaderboardPageSize(
    props.settings,
    topCount,
    props.showFeatured === false ? 0 : Math.min(topCount, ranked.length),
  );
  return { ranked, topCount, page: paginatedLeaderboard(entries, props.page || 1, pageSize) };
}

/** Shared empty state and pagination around a standings page (a render helper the tests call shallowly). */
function standingsPanel(
  props: LeaderboardProps,
  standings: ReturnType<typeof standingsPage>,
  children: R.ReactNode,
  wrapClassName?: string,
) {
  const page = standings.page;
  const content = (
    <React.Fragment>
      {children}
      <LeaderboardPagination
        firstRank={page.firstRank}
        lastRank={page.lastRank}
        onPageChange={props.onPageChange!}
        page={page.currentPage}
        totalPages={page.totalPages}
      />
    </React.Fragment>
  );
  return (
    <section className="dirty-rank-standings-panel dirty-ui-feature-card">
      {!page.total ? (
        <div className="dirty-rank-empty-standings">
          {props.emptyMessage ||
            (standings.ranked.length ? "Every rated performer is featured above." : "No standings yet.")}
        </div>
      ) : wrapClassName ? (
        <div className={wrapClassName}>{content}</div>
      ) : (
        content
      )}
    </section>
  );
}

export function LeaderboardTable(props: LeaderboardProps): R.JSX.Element | null {
  const standings = standingsPage(props);
  return standingsPanel(
    props,
    standings,
    <table className="table table-hover mb-0 dirty-ui-table dirty-rank-standings-table">
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Performer</th>
          <th scope="col">{props.leaderboardId === OVERALL_LEADERBOARD_ID ? "Score" : "Rating"}</th>
        </tr>
      </thead>
      <tbody>
        {standings.page.items.map(entry => {
          const performer = entry.performer;
          const pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
          return (
            <tr key={performer.id}>
              <td className="dirty-rank-table-rank">{"#" + entry.rank}</td>
              <td>
                <Router.NavLink
                  className="dirty-rank-table-performer d-inline-flex align-items-center"
                  to={"/performers/" + performer.id}
                >
                  {performer.image_path ? (
                    <img alt="" className="rounded-circle" loading="lazy" src={performer.image_path} />
                  ) : (
                    <span className="dirty-rank-table-avatar-placeholder d-inline-flex align-items-center justify-content-center rounded-circle">
                      ◇
                    </span>
                  )}
                  <span className="text-truncate">{performer.name}</span>
                </Router.NavLink>
              </td>
              <td
                className="dirty-rank-table-rating"
                title={overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings)}
              >
                {leaderboardRatingText(pool, props.settings)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>,
    "dirty-rank-table-wrap dirty-ui-table-wrap",
  );
}

export function LeaderboardGalleryCard(props: {
  performer: RankPerformer;
  leaderboardId: string;
  cohort: string;
  settings: RankSettings;
  rank: number;
}): R.JSX.Element | null {
  const NativePerformerCard = PluginApi.components && PluginApi.components.PerformerCard;
  const performer = props.performer;
  const pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
  const [imageReady, setImageReady] = React.useState(!performer.image_path);
  const [imageFailed, setImageFailed] = React.useState(false);
  return (
    <article className={NativePerformerCard ? "dirty-rank-native-card" : "dirty-rank-gallery-card"}>
      {NativePerformerCard ? (
        <NativePerformerCard performer={performer} />
      ) : (
        <Router.NavLink className="dirty-rank-gallery-image-link" to={"/performers/" + performer.id}>
          {performer.image_path && !imageFailed ? (
            <img
              alt=""
              className={
                imageReady ? "dirty-rank-gallery-image dirty-rank-gallery-image-ready" : "dirty-rank-gallery-image"
              }
              loading="lazy"
              onError={() => {
                setImageFailed(true);
                setImageReady(true);
              }}
              onLoad={() => {
                setImageReady(true);
              }}
              src={performer.image_path}
            />
          ) : (
            <div className="dirty-rank-gallery-placeholder d-flex align-items-center justify-content-center">◇</div>
          )}
          {performer.image_path && !imageFailed && !imageReady && (
            <span aria-hidden="true" className="dirty-rank-gallery-loading" />
          )}
        </Router.NavLink>
      )}
      <div className="dirty-rank-gallery-copy">
        {!NativePerformerCard && (
          <Router.NavLink
            className="dirty-rank-gallery-name text-truncate"
            title={performer.name}
            to={"/performers/" + performer.id}
          >
            {performer.name}
          </Router.NavLink>
        )}
        <div className="dirty-rank-gallery-rating-row dirty-rank-leaderboard-rating-row">
          <strong className="dirty-rank-leaderboard-rank">{"#" + props.rank}</strong>
          <strong title={overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings)}>
            {leaderboardRatingText(pool, props.settings)}
          </strong>
        </div>
      </div>
    </article>
  );
}

export function LeaderboardGallery(props: LeaderboardProps): R.JSX.Element | null {
  const standings = standingsPage(props);
  return standingsPanel(
    props,
    standings,
    <div
      className="dirty-rank-gallery-grid"
      style={{ "--dirty-rank-gallery-columns": standings.topCount } as R.CSSProperties}
    >
      {standings.page.items.map(entry => (
        <LeaderboardGalleryCard
          cohort={props.cohort}
          key={entry.performer.id}
          leaderboardId={props.leaderboardId}
          performer={entry.performer}
          rank={entry.rank}
          settings={props.settings}
        />
      ))}
    </div>,
  );
}

export function DirtyRankLeaderboardsRoute(): R.JSX.Element | null {
  DirtyPlugins.react.usePageTitle("DirtyRank", "Leaderboard");
  const [settings, setSettings] = React.useState<RankSettings | null>(null);
  const [performers, setPerformers] = React.useState<RankPerformer[]>([]);
  const location = Router.useLocation();
  const history = Router.useHistory();
  const query = new URLSearchParams(location.search),
    requestedBox = query.get("box") || query.get("cohort") || "";
  const cohort =
    settings && settings.enabledCohorts.indexOf(requestedBox) !== -1
      ? requestedBox
      : settings
        ? settings.defaultCohort
        : "";
  const requestedLeaderboardId = leaderboardIdFromPath(location.pathname);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [filterModel, setFilterModel] = React.useState<PerformerFilterModel | null>(null);
  const [filterIds, setFilterIds] = React.useState<Set<string> | null>(null);
  const [resolvedFilterKey, setResolvedFilterKey] = React.useState("");
  const [filterBusy, setFilterBusy] = React.useState(false);
  const [filterError, setFilterError] = React.useState("");
  const [nativeReady, setNativeReady] = React.useState(false);
  const [nativeError, setNativeError] = React.useState("");
  const filterTrigger = React.useRef<HTMLButtonElement>(null);
  const filterClose = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    let active = true;
    leaderboardFilterListener = model => {
      if (active) setFilterModel(model);
    };
    DirtyPlugins.native
      .ensureComponents("Performers", ["FilteredPerformerList"])
      .then(() => {
        if (active) setNativeReady(true);
      })
      .catch(caught => {
        if (active) setNativeError(caught.message || String(caught));
      });
    return () => {
      active = false;
      leaderboardFilterListener = null;
    };
  }, []);

  const filterKey = filterModel ? JSON.stringify(filterModel) : "";
  const filterActive = Boolean(filterModel && filterModel!.count > 0);
  React.useEffect(() => {
    if (!filterActive) {
      setFilterIds(null);
      setResolvedFilterKey("");
      setFilterBusy(false);
      setFilterError("");
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setFilterBusy(true);
    setFilterError("");
    queryLeaderboardPerformerIds(filterModel!, controller.signal)
      .then(ids => {
        if (active) {
          setFilterIds(ids);
          setResolvedFilterKey(filterKey);
        }
      })
      .catch(caught => {
        if (active && caught.name !== "AbortError") setFilterError(caught.message || String(caught));
      })
      .finally(() => {
        if (active) setFilterBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [filterKey]);

  const loadRequest = React.useRef(0),
    mounted = React.useRef(true);
  const load = React.useCallback(() => {
    const request = ++loadRequest.current;
    setLoading(true);
    setError("");
    return Promise.all([
      DirtyPlugins.getPluginSettings(PLUGIN_ID),
      queryPerformers(true),
      loadRatingIndex(),
      loadNativePerformerCard(),
    ])
      .then(values => {
        if (!mounted.current || request !== loadRequest.current) return;
        const nextSettings = settingsFromConfiguration(values[0]);
        setSettings(nextSettings);
        setPerformers(values[1]);
      })
      .catch(caught => {
        if (mounted.current && request === loadRequest.current) setError(caught.message || String(caught));
      })
      .finally(() => {
        if (mounted.current && request === loadRequest.current) setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    function changed(event: ConfigurationEvent) {
      if (!event.detail || event.detail.pluginId === PLUGIN_ID) void load();
    }
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, changed);
    return () => {
      mounted.current = false;
      loadRequest.current += 1;
      window.removeEventListener(CONFIGURATION_CHANGED_EVENT, changed);
    };
  }, [load]);

  const availableCohorts = settings ? boxOptions(settings!, true) : [];
  const enabledCategories = settings ? categoriesFor(settings!, cohort).filter(category => category.enabled) : [];
  const leaderboardId =
    requestedLeaderboardId === OVERALL_LEADERBOARD_ID ||
    enabledCategories.some(category => category.id === requestedLeaderboardId)
      ? requestedLeaderboardId
      : OVERALL_LEADERBOARD_ID;
  const viewMode = settings ? settings.leaderboardView : "gallery";
  const topCount = settings ? settings.leaderboardTopCount : 3;
  const selectedCategory = enabledCategories.find(category => category.id === leaderboardId) || null;
  const data = React.useMemo(
    () => (settings ? leaderboardData(performers, leaderboardId, cohort, settings) : null),
    [cohort, leaderboardId, performers, settings],
  );
  const allEntries = React.useMemo(() => (data ? leaderboardEntries(data.ranked) : []), [data]);
  const standingEntries = React.useMemo(() => {
    if (filterActive) return filteredLeaderboardEntries(allEntries, filterIds);
    return allEntries.slice(leaderboardTopCount(topCount));
  }, [allEntries, filterActive, filterIds, topCount]);
  React.useEffect(() => {
    setPage(1);
  }, [cohort, leaderboardId, viewMode, filterKey, topCount, settings && settings.leaderboardPerformerCount]);
  const pageSize = settings
    ? leaderboardPageSize(settings, topCount, filterActive ? 0 : Math.min(topCount, data ? data.ranked.length : 0))
    : 15;
  const totalPages = Math.max(1, Math.ceil(standingEntries.length / pageSize));
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (loading)
    return (
      <main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
        <ui.StateView title="Loading DirtyRank leaderboards…" />
      </main>
    );
  if (error || !settings || !data) {
    return (
      <main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
        <ui.StateView
          title="Could not load DirtyRank leaderboards"
          detail={error || "DirtyRank settings are unavailable."}
          actions={<RankButton onClick={load}>Retry</RankButton>}
        />
      </main>
    );
  }

  const stats = data.stats;
  const censorMedia = documentationCapture();
  const box = linkedBox(settings.defaultCohort, cohort);
  const Standings = viewMode === "gallery" ? LeaderboardGallery : LeaderboardTable;
  return (
    <main
      className={
        "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide dirty-rank-leaderboards-route" +
        (censorMedia ? " dirty-rank-censored-media" : "")
      }
    >
      <div className="dirty-rank-leaderboards-shell">
        <header className="dirty-rank-leaderboards-header dirty-ui-page-header dirty-ui-feature-card">
          <h1 className="dirty-rank-leaderboards-page-title">Leaderboards</h1>
          <div className="dirty-rank-leaderboards-controls dirty-ui-control-row">
            <RankStatisticSelector value={leaderboardId} categories={enabledCategories} boxId={box} />
            <button
              ref={filterTrigger}
              className="btn btn-secondary dirty-ui-button dirty-ui-control"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              onClick={() => {
                setFilterOpen(true);
              }}
            >
              {"Filter"}
              {filterActive ? " (" + filterModel!.count + ")" : ""}
            </button>
            <LeaderboardInfoPopover id="dirty-rank-coverage" label="Coverage">
              <section aria-label="Leaderboard statistics" className="dirty-rank-stats">
                <LeaderboardStat
                  detail={stats.coverage.toFixed(1) + "% of eligible performers"}
                  label="Rated coverage"
                  value={stats.rated.toLocaleString() + "/" + data.eligible.toLocaleString()}
                />
                <LeaderboardStat
                  detail={
                    stats.excellent.toLocaleString() +
                    " excellent · " +
                    (stats.rated
                      ? ((stats.stable / stats.rated) * 100).toFixed(1) + "% refined or better"
                      : "No rated performers")
                  }
                  label="Refined ratings"
                  value={stats.stable.toLocaleString()}
                />
                <LeaderboardStat
                  detail="Recorded head-to-head results"
                  label="Completed battles"
                  value={stats.completedBattles.toLocaleString()}
                />
                <LeaderboardStat
                  detail={
                    selectedCategory ? "Lower means more precise" : "Weighted category RD; lower means more precise"
                  }
                  label={selectedCategory ? "Median RD" : "Median category RD"}
                  value={stats.medianDeviation.toFixed(1)}
                />
                <LeaderboardStat
                  detail="Share of completed battles"
                  label="Draw rate"
                  value={stats.drawRate.toFixed(1) + "%"}
                />
                <LeaderboardStat
                  detail="Highest to lowest rated"
                  label={selectedCategory ? "Rating spread" : "Score spread"}
                  value={
                    selectedCategory ? Math.round(stats.ratingSpread).toLocaleString() : stats.ratingSpread.toFixed(1)
                  }
                />
              </section>
            </LeaderboardInfoPopover>
            <LeaderboardInfoPopover
              id="dirty-rank-confidence"
              label="Confidence"
              className="dirty-rank-leaderboards-confidence"
            >
              {selectedCategory ? (
                <ConfidenceIndicator
                  category={selectedCategory}
                  cohort={cohort}
                  performers={performers}
                  settings={settings}
                />
              ) : (
                <OverallConfidence cohort={cohort} performers={performers} settings={settings} />
              )}
            </LeaderboardInfoPopover>
            <Router.NavLink
              className="btn btn-secondary dirty-ui-button dirty-ui-control dirty-rank-leaderboards-battles"
              to={
                selectedCategory
                  ? battleCategoryPath(selectedCategory.id, false, "", box)
                  : ROUTE_PATH + (box ? "?box=" + encodeURIComponent(box) : "")
              }
            >
              Battles
            </Router.NavLink>
            <Router.NavLink
              className="btn btn-secondary dirty-ui-button dirty-ui-control dirty-rank-leaderboards-options"
              to="/plugins/dirty-plugins?plugin=dirtyRank"
            >
              Options
            </Router.NavLink>
          </div>
        </header>
        <ui.Dialog
          open={filterOpen}
          id="dirty-rank-performer-filter-dialog"
          backdropClassName="dirty-ui-native-filter-overlay"
          className="dirty-ui-native-filter-dialog dirty-ui-panel"
          ariaLabel="Performer filters"
          initialFocusRef={filterClose}
          openerRef={filterTrigger}
          allowNativePopup={true}
          onClose={() => {
            setFilterOpen(false);
          }}
        >
          <div className="dirty-rank-filter-dialog-heading">
            <h2>Performer filters</h2>
            <button
              ref={filterClose}
              className="btn btn-secondary dirty-ui-button"
              onClick={() => {
                setFilterOpen(false);
              }}
              type="button"
            >
              Done
            </button>
          </div>
          {availableCohorts.length > 1 && (
            <Field className="dirty-rank-control" id="dirty-rank-leaderboard-cohort" label="Gender box">
              <select
                className="form-control"
                id="dirty-rank-leaderboard-cohort"
                onChange={event => {
                  const nextBox = event.target.value;
                  const nextId = categoriesFor(settings!, nextBox).some(
                    category => category.enabled && category.id === leaderboardId,
                  )
                    ? leaderboardId
                    : OVERALL_LEADERBOARD_ID;
                  const path = leaderboardStatPath(nextId, nextBox);
                  history.push(DirtyPlugins.captureUrl(path));
                }}
                value={cohort}
              >
                {availableCohorts.map(item => {
                  return (
                    <option key={item[0]} value={item[0]}>
                      {item[1]}
                    </option>
                  );
                })}
              </select>
            </Field>
          )}
          {nativeError ? (
            <ui.StateView title="Stash filters unavailable" detail={nativeError} />
          ) : !nativeReady ? (
            <ui.StateView title="Loading Stash filters…" />
          ) : censorMedia ? (
            <p role="note">Native filter results are hidden while capturing documentation.</p>
          ) : (
            <PluginApi.components.FilteredPerformerList
              alterQuery={false}
              extraCriteria={{ dirtyRankLeaderboardFilter: true }}
            />
          )}
        </ui.Dialog>
        {filterError ? (
          <ui.StateView title="Could not filter performers" detail={filterError} />
        ) : filterActive && (filterBusy || resolvedFilterKey !== filterKey) ? (
          <ui.StateView title="Filtering performers…" />
        ) : (
          <React.Fragment>
            {!filterActive && (
              <LeaderboardPodium
                cohort={cohort}
                leaderboardId={leaderboardId}
                ranked={data.ranked}
                settings={settings}
                topCount={topCount}
              />
            )}
            <Standings
              cohort={cohort}
              entries={standingEntries}
              leaderboardId={leaderboardId}
              onPageChange={setPage}
              page={page}
              ranked={data.ranked}
              topCount={topCount}
              showFeatured={!filterActive}
              settings={settings}
              {...(filterActive ? filteredLeaderboardPanelProps() : {})}
            />
          </React.Fragment>
        )}
      </div>
    </main>
  );
}
