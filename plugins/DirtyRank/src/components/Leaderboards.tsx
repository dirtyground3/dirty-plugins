import type * as R from "react";
import { LEADERBOARD_TOP_OPTIONS, OVERALL_LEADERBOARD_ID, PLUGIN_ID, ROUTE_PATH } from "../constants";
import type { LeaderboardProps, PerformerFilter, PerformerFilterModel, RankPerformer, RankSettings } from "../types";
import type { ViewDependencies } from "../view";
export function createLeaderboards(dependencies: Pick<ViewDependencies, "React" | "Fragment" | "DirtyPlugins" | "PluginApi" | "Router" | "NavLink" | "useState" | "useEffect" | "useMemo" | "useRef" | "useCallback" | "documentationCapture" | "StateView" | "SharedPagination" | "SharedDialog" | "CONFIGURATION_CHANGED_EVENT" | "boxOptions" | "categoriesFor" | "settingsFromConfiguration" | "loadRatingIndex" | "loadNativePerformerCard" | "queryPerformers" | "leaderboardPoolFor" | "leaderboardData" | "leaderboardFeaturedCount" | "leaderboardPageSize" | "overallCategoryScoresTitle" | "leaderboardRatingText" | "leaderboardEntries" | "filteredLeaderboardEntries" | "serializeLeaderboardPerformerFilter" | "queryLeaderboardPerformerIds" | "leaderboardStandingEntries" | "filteredLeaderboardPanelProps" | "paginatedLeaderboard" | "leaderboardTopCount" | "battleCategoryPath" | "leaderboardStatPath" | "leaderboardIdFromPath" | "RankButton" | "ConfidenceIndicator" | "LeaderboardStat" | "OverallConfidence" | "Field" | "RankStatisticSelector" | "LeaderboardInfoPopover">) {
  const { React, Fragment, DirtyPlugins, PluginApi, Router, NavLink, useState, useEffect, useMemo, useRef, useCallback, documentationCapture, StateView, SharedPagination, SharedDialog, CONFIGURATION_CHANGED_EVENT, boxOptions, categoriesFor, settingsFromConfiguration, loadRatingIndex, loadNativePerformerCard, queryPerformers, leaderboardPoolFor, leaderboardData, leaderboardFeaturedCount, leaderboardPageSize, overallCategoryScoresTitle, leaderboardRatingText, leaderboardEntries, filteredLeaderboardEntries, serializeLeaderboardPerformerFilter, queryLeaderboardPerformerIds, leaderboardStandingEntries, filteredLeaderboardPanelProps, paginatedLeaderboard, leaderboardTopCount, battleCategoryPath, leaderboardStatPath, leaderboardIdFromPath, RankButton, ConfidenceIndicator, LeaderboardStat, OverallConfidence, Field, RankStatisticSelector, LeaderboardInfoPopover } = dependencies;
  let leaderboardFilterListener: ((model: PerformerFilterModel) => void) | null = null;
  function LeaderboardPodium(props: LeaderboardProps): R.JSX.Element | null {
    var NativePerformerCard = PluginApi.components && PluginApi.components.PerformerCard;
    var topCount = leaderboardTopCount(props.topCount);
    var showcase = LEADERBOARD_TOP_OPTIONS.filter(function (option) { return option.count === topCount; })[0];
    var top = props.ranked.slice(0, topCount);
    var podiumOrder = [1, 0, 2];
    var displayOrder = topCount === 3 ? podiumOrder : top.map(function (_performer, index) { return index; });
    if (!top.length) {
      return (<StateView
        title="No rated performers"
        detail="Complete a battle in this category to create its leaderboard." />);
    }
    return (<section
      aria-label={showcase.name}
      className={"dirty-rank-podium" + (topCount > 3 ? " dirty-rank-podium-expanded dirty-rank-showcase dirty-rank-showcase-" + showcase.theme : "")}
      style={{ "--dirty-rank-top-count": topCount } as R.CSSProperties}>
      {displayOrder.filter(function (index) { return top[index]; }).map(function (index) {
        var performer = top[index];
        var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
        return (<article
          className={"dirty-rank-podium-place d-flex flex-column dirty-rank-podium-" + (index + 1)}
          key={performer.id}>
          <div className={NativePerformerCard ? "dirty-rank-native-card" : "dirty-rank-podium-card"}>
            {NativePerformerCard ? (<NativePerformerCard performer={performer} />) : (<NavLink className="dirty-rank-podium-image-link" to={"/performers/" + performer.id}>
              {performer.image_path
                ? (<img alt="" className="dirty-rank-podium-image" loading="lazy" src={performer.image_path} />)
                : (<div className="dirty-rank-podium-placeholder d-flex align-items-center justify-content-center">
                  {"◇"}
                </div>)}
            </NavLink>)}
            <div className="dirty-rank-podium-copy text-center">
              {!NativePerformerCard && (<NavLink className="dirty-rank-podium-name text-truncate" to={"/performers/" + performer.id}>
                {performer.name}
              </NavLink>)}
              <div className="dirty-rank-leaderboard-rating-row">
                <strong className="dirty-rank-leaderboard-rank">
                  {"#" + (index + 1)}
                </strong>
                <strong
                  className="dirty-rank-podium-rating"
                  title={overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings)}>
                  {leaderboardRatingText(pool, props.settings)}
                </strong>
              </div>
            </div>
          </div>
          {topCount === 3 && (<div aria-hidden="true" className="dirty-rank-podium-step">
            <span>
              {index + 1}
            </span>
          </div>)}
          {topCount > 3 && (<div aria-hidden="true" className="dirty-rank-showcase-base">
            <span>
              {topCount === 4 ? ["I", "II", "III", "IV"][index] : index + 1}
            </span>
          </div>)}
        </article>);
      })}
    </section>);
  }

  function LeaderboardPagination(props: { totalPages: number; page: number; firstRank: number; lastRank: number; onPageChange(page: number): void }): R.JSX.Element | null {
    if (props.totalPages <= 1) return null;
    var summary = "Page " + props.page.toLocaleString() + " of " +
      props.totalPages.toLocaleString() + " · ranks " +
      props.firstRank.toLocaleString() + "–" + props.lastRank.toLocaleString();
    return (<SharedPagination
      ariaLabel="Leaderboard pages"
      className="dirty-rank-pagination"
      onPageChange={props.onPageChange!}
      page={props.page}
      summary={summary}
      totalPages={props.totalPages} />);
  }

  function DirtyRankLeaderboardFilterCapture(props: { filter: PerformerFilter }): R.JSX.Element | null {
    var model = serializeLeaderboardPerformerFilter(props.filter);
    var key = JSON.stringify(model);
    useEffect(function () {
      if (leaderboardFilterListener) leaderboardFilterListener(model);
    }, [key]);
    return null;
  }

  function LeaderboardTable(props: LeaderboardProps): R.JSX.Element | null {
    var entries = leaderboardStandingEntries(props);
    var ranked = props.ranked || entries.map(function (entry) { return entry.performer; });
    var topCount = leaderboardFeaturedCount(props);
    var pageSize = leaderboardPageSize(props.settings, topCount, props.showFeatured === false ? 0 : Math.min(topCount, ranked.length));
    var page = paginatedLeaderboard(entries, props.page || 1, pageSize);
    return (<section className="dirty-rank-standings-panel dirty-ui-feature-card">
      {!page.total
        ? (<div className="dirty-rank-empty-standings">
          {props.emptyMessage || (ranked.length ? "Every rated performer is featured above." : "No standings yet.")}
        </div>)
        : (<div className="dirty-rank-table-wrap dirty-ui-table-wrap">
          <table className="table table-hover mb-0 dirty-ui-table dirty-rank-standings-table">
            <thead>
              <tr>
                <th scope="col">
                  {"Rank"}
                </th>
                <th scope="col">
                  {"Performer"}
                </th>
                <th scope="col">
                  {props.leaderboardId === OVERALL_LEADERBOARD_ID ? "Score" : "Rating"}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.items.map(function (entry) {
                var performer = entry.performer;
                var rank = entry.rank;
                var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
                return (<tr key={performer.id}>
                  <td className="dirty-rank-table-rank">
                    {"#" + rank}
                  </td>
                  <td>
                    <NavLink
                      className="dirty-rank-table-performer d-inline-flex align-items-center"
                      to={"/performers/" + performer.id}>
                      {performer.image_path
                        ? (<img alt="" className="rounded-circle" loading="lazy" src={performer.image_path} />)
                        : (<span
                          className="dirty-rank-table-avatar-placeholder d-inline-flex align-items-center justify-content-center rounded-circle">
                          {"◇"}
                        </span>)}
                      <span className="text-truncate">
                        {performer.name}
                      </span>
                    </NavLink>
                  </td>
                  <td
                    className="dirty-rank-table-rating"
                    title={overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings)}>
                    {leaderboardRatingText(pool, props.settings)}
                  </td>
                </tr>);
              })}
            </tbody>
          </table>
          <LeaderboardPagination
            firstRank={page.firstRank}
            lastRank={page.lastRank}
            onPageChange={props.onPageChange!}
            page={page.currentPage}
            totalPages={page.totalPages} />
        </div>)}
    </section>);
  }

  function LeaderboardGalleryCard(props: { performer: RankPerformer; leaderboardId: string; cohort: string; settings: RankSettings; rank: number }): R.JSX.Element | null {
    var NativePerformerCard = PluginApi.components && PluginApi.components.PerformerCard;
    var performer = props.performer;
    var pool = leaderboardPoolFor(performer, props.leaderboardId, props.cohort, props.settings);
    var imageState = useState(!performer.image_path);
    var imageReady = imageState[0];
    var setImageReady = imageState[1];
    var failedState = useState(false);
    var imageFailed = failedState[0];
    var setImageFailed = failedState[1];
    return (<article className={NativePerformerCard ? "dirty-rank-native-card" : "dirty-rank-gallery-card"}>
      {NativePerformerCard ? (<NativePerformerCard performer={performer} />) : (<NavLink className="dirty-rank-gallery-image-link" to={"/performers/" + performer.id}>
        {performer.image_path && !imageFailed
          ? (<img
            alt=""
            className={imageReady ? "dirty-rank-gallery-image dirty-rank-gallery-image-ready" : "dirty-rank-gallery-image"}
            loading="lazy"
            onError={function () { setImageFailed(true); setImageReady(true); }}
            onLoad={function () { setImageReady(true); }}
            src={performer.image_path} />)
          : (<div className="dirty-rank-gallery-placeholder d-flex align-items-center justify-content-center">
            {"◇"}
          </div>)}
        {performer.image_path && !imageFailed && !imageReady && (<span aria-hidden="true" className="dirty-rank-gallery-loading" />)}
      </NavLink>)}
      <div className="dirty-rank-gallery-copy">
        {!NativePerformerCard && (<NavLink
          className="dirty-rank-gallery-name text-truncate"
          title={performer.name}
          to={"/performers/" + performer.id}>
          {performer.name}
        </NavLink>)}
        <div className="dirty-rank-gallery-rating-row dirty-rank-leaderboard-rating-row">
          <strong className="dirty-rank-leaderboard-rank">
            {"#" + props.rank}
          </strong>
          <strong title={overallCategoryScoresTitle(performer, props.leaderboardId, props.cohort, props.settings)}>
            {leaderboardRatingText(pool, props.settings)}
          </strong>
        </div>
      </div>
    </article>);
  }

  function LeaderboardGallery(props: LeaderboardProps): R.JSX.Element | null {
    var entries = leaderboardStandingEntries(props);
    var ranked = props.ranked || entries.map(function (entry) { return entry.performer; });
    var topCount = leaderboardFeaturedCount(props);
    var pageSize = leaderboardPageSize(props.settings, topCount, props.showFeatured === false ? 0 : Math.min(topCount, ranked.length));
    var page = paginatedLeaderboard(entries, props.page!, pageSize);
    return (<section className="dirty-rank-standings-panel dirty-ui-feature-card">
      {!page.total
        ? (<div className="dirty-rank-empty-standings">
          {props.emptyMessage || (ranked.length ? "Every rated performer is featured above." : "No standings yet.")}
        </div>)
        : (<Fragment>
          <div
            className="dirty-rank-gallery-grid"
            style={{ "--dirty-rank-gallery-columns": topCount } as R.CSSProperties}>
            {page.items.map(function (entry) {
              return (<LeaderboardGalleryCard
                cohort={props.cohort}
                key={entry.performer.id}
                leaderboardId={props.leaderboardId}
                performer={entry.performer}
                rank={entry.rank}
                settings={props.settings} />);
            })}
          </div>
          <LeaderboardPagination
            firstRank={page.firstRank}
            lastRank={page.lastRank}
            onPageChange={props.onPageChange!}
            page={page.currentPage}
            totalPages={page.totalPages} />
        </Fragment>)}
    </section>);
  }

  function DirtyRankLeaderboardsRoute(): R.JSX.Element | null {
    DirtyPlugins.react.usePageTitle("DirtyRank", "Leaderboard");
    var settingsState = useState<RankSettings | null>(null);
    var settings = settingsState[0];
    var setSettings = settingsState[1];
    var performersState = useState<RankPerformer[]>([]);
    var performers = performersState[0];
    var setPerformers = performersState[1];
    var location = Router.useLocation();
    var history = Router.useHistory();
    var requestedBox = new URLSearchParams(location.search).get("box") || new URLSearchParams(location.search).get("cohort") || "";
    var cohort = settings && settings.enabledCohorts.indexOf(requestedBox) !== -1 ? requestedBox : settings ? settings.defaultCohort : "";
    var requestedLeaderboardId = leaderboardIdFromPath(location.pathname);
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var pageState = useState(1);
    var page = pageState[0];
    var setPage = pageState[1];
    var filterOpenState = useState(false);
    var filterOpen = filterOpenState[0];
    var setFilterOpen = filterOpenState[1];
    var filterModelState = useState<PerformerFilterModel | null>(null);
    var filterModel = filterModelState[0];
    var setFilterModel = filterModelState[1];
    var filterIdsState = useState<Set<string> | null>(null);
    var filterIds = filterIdsState[0];
    var setFilterIds = filterIdsState[1];
    var resolvedFilterKeyState = useState("");
    var resolvedFilterKey = resolvedFilterKeyState[0];
    var setResolvedFilterKey = resolvedFilterKeyState[1];
    var filterBusyState = useState(false);
    var filterBusy = filterBusyState[0];
    var setFilterBusy = filterBusyState[1];
    var filterErrorState = useState("");
    var filterError = filterErrorState[0];
    var setFilterError = filterErrorState[1];
    var nativeReadyState = useState(false);
    var nativeReady = nativeReadyState[0];
    var setNativeReady = nativeReadyState[1];
    var nativeErrorState = useState("");
    var nativeError = nativeErrorState[0];
    var setNativeError = nativeErrorState[1];
    var filterTrigger = useRef<HTMLButtonElement>(null);
    var filterClose = useRef<HTMLButtonElement>(null);

    useEffect(function () {
      var active = true;
      leaderboardFilterListener = function (model) { if (active) setFilterModel(model); };
      DirtyPlugins.native.ensureComponents("Performers", ["FilteredPerformerList"])
        .then(function () { if (active) setNativeReady(true); })
        .catch(function (caught) { if (active) setNativeError(caught.message || String(caught)); });
      return function () {
        active = false;
        leaderboardFilterListener = null;
      };
    }, []);

    var filterKey = filterModel ? JSON.stringify(filterModel) : "";
    var filterActive = Boolean(filterModel && filterModel!.count > 0);
    useEffect(function () {
      if (!filterActive) {
        setFilterIds(null);
        setResolvedFilterKey("");
        setFilterBusy(false);
        setFilterError("");
        return undefined;
      }
      var controller = new AbortController();
      var active = true;
      setFilterBusy(true);
      setFilterError("");
      queryLeaderboardPerformerIds(filterModel!, controller.signal)
        .then(function (ids) { if (active) { setFilterIds(ids); setResolvedFilterKey(filterKey); } })
        .catch(function (caught) { if (active && caught.name !== "AbortError") setFilterError(caught.message || String(caught)); })
        .finally(function () { if (active) setFilterBusy(false); });
      return function () { active = false; controller.abort(); };
    }, [filterKey]);

    const loadRequest = useRef(0), mounted = useRef(true);
    var load = useCallback(function () {
      const request = ++loadRequest.current;
      setLoading(true);
      setError("");
      return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), queryPerformers(true), loadRatingIndex(), loadNativePerformerCard()])
        .then(function (values) {
          if (!mounted.current || request !== loadRequest.current) return;
          var nextSettings = settingsFromConfiguration(values[0]);
          setSettings(nextSettings);
          setPerformers(values[1]);
        })
        .catch(function (caught) { if (mounted.current && request === loadRequest.current) setError(caught.message || String(caught)); })
        .finally(function () { if (mounted.current && request === loadRequest.current) setLoading(false); });
    }, []);

    useEffect(function () {
      mounted.current = true;
      void load();
      function changed(event: import("../types").ConfigurationEvent) {
        if (!event.detail || event.detail.pluginId === PLUGIN_ID) void load();
      }
      window.addEventListener(CONFIGURATION_CHANGED_EVENT, changed);
      return function () { mounted.current = false; loadRequest.current += 1; window.removeEventListener(CONFIGURATION_CHANGED_EVENT, changed); };
    }, [load]);

    var availableCohorts = settings ? boxOptions(settings!, true) : [];
    var enabledCategories = settings ? categoriesFor(settings!, cohort).filter(function (category) { return category.enabled; }) : [];
    var leaderboardId = requestedLeaderboardId === OVERALL_LEADERBOARD_ID || enabledCategories.some(function (category) { return category.id === requestedLeaderboardId; })
      ? requestedLeaderboardId : OVERALL_LEADERBOARD_ID;
    var viewMode = settings ? settings.leaderboardView : "gallery";
    var topCount = settings ? settings.leaderboardTopCount : 3;
    var selectedCategory = enabledCategories.find(function (category) { return category.id === leaderboardId; }) || null;
    var data = useMemo(function () {
      return settings ? leaderboardData(performers, leaderboardId, cohort, settings) : null;
    }, [cohort, leaderboardId, performers, settings]);
    var allEntries = useMemo(function () {
      return data ? leaderboardEntries(data.ranked) : [];
    }, [data]);
    var standingEntries = useMemo(function () {
      if (filterActive) return filteredLeaderboardEntries(allEntries, filterIds);
      return allEntries.slice(leaderboardTopCount(topCount));
    }, [allEntries, filterActive, filterIds, topCount]);
    useEffect(function () { setPage(1); }, [cohort, leaderboardId, viewMode, filterKey, topCount, settings && settings.leaderboardPerformerCount]);
    var pageSize = settings ? leaderboardPageSize(settings, topCount, filterActive ? 0 : Math.min(topCount, data ? data.ranked.length : 0)) : 15;
    var totalPages = Math.max(1, Math.ceil(standingEntries.length / pageSize));
    useEffect(function () {
      if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    if (loading) return (<main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
      <StateView title="Loading DirtyRank leaderboards…" />
    </main>);
    if (error || !settings || !data) {
      return (<main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
        <StateView
          title="Could not load DirtyRank leaderboards"
          detail={error || "DirtyRank settings are unavailable."}
          actions={(<RankButton onClick={load}>
            {"Retry"}
          </RankButton>)} />
      </main>);
    }

    var stats = data.stats;
    var censorMedia = documentationCapture();
    return (<main
      className={"dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide dirty-rank-leaderboards-route" + (censorMedia ? " dirty-rank-censored-media" : "")}>
      <div className="dirty-rank-leaderboards-shell">
        <header className="dirty-rank-leaderboards-header dirty-ui-page-header dirty-ui-feature-card">
          <h1 className="dirty-rank-leaderboards-page-title">
            {"Leaderboards"}
          </h1>
          <div className="dirty-rank-leaderboards-controls dirty-ui-control-row">
            <RankStatisticSelector
              value={leaderboardId}
              categories={enabledCategories}
              boxId={cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : cohort} />
            <button
              ref={filterTrigger}
              className="btn btn-secondary dirty-ui-button dirty-ui-control"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={filterOpen}
              onClick={function () { setFilterOpen(true); }}>
              {"Filter"}
              {filterActive ? " (" + filterModel!.count + ")" : ""}
            </button>
            <LeaderboardInfoPopover id="dirty-rank-coverage" label="Coverage">
              <section aria-label="Leaderboard statistics" className="dirty-rank-stats">
                <LeaderboardStat
                  detail={stats.coverage.toFixed(1) + "% of eligible performers"}
                  label="Rated coverage"
                  value={stats.rated.toLocaleString() + "/" + data.eligible.toLocaleString()} />
                <LeaderboardStat
                  detail={stats.excellent.toLocaleString() + " excellent · " + (stats.rated ? (stats.stable / stats.rated * 100).toFixed(1) + "% refined or better" : "No rated performers")}
                  label="Refined ratings"
                  value={stats.stable.toLocaleString()} />
                <LeaderboardStat
                  detail="Recorded head-to-head results"
                  label="Completed battles"
                  value={stats.completedBattles.toLocaleString()} />
                <LeaderboardStat
                  detail={selectedCategory ? "Lower means more precise" : "Weighted category RD; lower means more precise"}
                  label={selectedCategory ? "Median RD" : "Median category RD"}
                  value={stats.medianDeviation.toFixed(1)} />
                <LeaderboardStat
                  detail="Share of completed battles"
                  label="Draw rate"
                  value={stats.drawRate.toFixed(1) + "%"} />
                <LeaderboardStat
                  detail="Highest to lowest rated"
                  label={selectedCategory ? "Rating spread" : "Score spread"}
                  value={selectedCategory ? Math.round(stats.ratingSpread).toLocaleString() : stats.ratingSpread.toFixed(1)} />
              </section>
            </LeaderboardInfoPopover>
            <LeaderboardInfoPopover
              id="dirty-rank-confidence"
              label="Confidence"
              className="dirty-rank-leaderboards-confidence">
              {selectedCategory
                ? (<ConfidenceIndicator
                  category={selectedCategory}
                  cohort={cohort}
                  performers={performers}
                  settings={settings} />)
                : (<OverallConfidence cohort={cohort} performers={performers} settings={settings} />)}
            </LeaderboardInfoPopover>
            <NavLink
              className="btn btn-secondary dirty-ui-button dirty-ui-control dirty-rank-leaderboards-battles"
              to={selectedCategory ? battleCategoryPath(selectedCategory.id, false, "", cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : cohort) : ROUTE_PATH + (cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : "?box=" + encodeURIComponent(cohort))}>
              {"Battles"}
            </NavLink>
            <NavLink
              className="btn btn-secondary dirty-ui-button dirty-ui-control dirty-rank-leaderboards-options"
              to="/plugins/dirty-plugins?plugin=dirtyRank">
              {"Options"}
            </NavLink>
          </div>
        </header>
        <SharedDialog
          open={filterOpen}
          id="dirty-rank-performer-filter-dialog"
          backdropClassName="dirty-ui-native-filter-overlay"
          className="dirty-ui-native-filter-dialog dirty-ui-panel"
          ariaLabel="Performer filters"
          initialFocusRef={filterClose}
          openerRef={filterTrigger}
          allowNativePopup={true}
          onClose={function () { setFilterOpen(false); }}>
          <div className="dirty-rank-filter-dialog-heading">
            <h2>
              {"Performer filters"}
            </h2>
            <button
              ref={filterClose}
              className="btn btn-secondary dirty-ui-button"
              onClick={function () { setFilterOpen(false); }}
              type="button">
              {"Done"}
            </button>
          </div>
          {availableCohorts.length > 1 && (<Field className="dirty-rank-control" id="dirty-rank-leaderboard-cohort" label="Gender box">
            <select className="form-control" id="dirty-rank-leaderboard-cohort" onChange={function (event) {
              var nextBox = event.target.value;
              var nextId = categoriesFor(settings!, nextBox).some(function (category) { return category.enabled && category.id === leaderboardId; }) ? leaderboardId : OVERALL_LEADERBOARD_ID;
              var path = leaderboardStatPath(nextId, nextBox);
              history.push(DirtyPlugins.captureUrl(path));
            }} value={cohort}>
              {availableCohorts.map(function (item) {
                return (<option key={item[0]} value={item[0]}>
                  {item[1]}
                </option>);
              })}
            </select>
          </Field>)}
          {nativeError ? (<StateView title="Stash filters unavailable" detail={nativeError} />)
            : !nativeReady ? (<StateView title="Loading Stash filters…" />)
              : censorMedia ? (<p role="note">
                {"Native filter results are hidden while capturing documentation."}
              </p>)
                : (<PluginApi.components.FilteredPerformerList
                  alterQuery={false}
                  extraCriteria={{ dirtyRankLeaderboardFilter: true }} />)}
        </SharedDialog>
        {filterError ? (<StateView title="Could not filter performers" detail={filterError} />)
          : filterActive && (filterBusy || resolvedFilterKey !== filterKey)
            ? (<StateView title="Filtering performers…" />)
            : (<Fragment>
              {!filterActive && (<LeaderboardPodium
                cohort={cohort}
                leaderboardId={leaderboardId}
                ranked={data.ranked}
                settings={settings}
                topCount={topCount} />)}
              {viewMode === "gallery"
                ? (<LeaderboardGallery {...Object.assign({
                  cohort: cohort,
                  entries: standingEntries,
                  leaderboardId: leaderboardId,
                  onPageChange: setPage,
                  page: page,
                  ranked: data.ranked,
                  topCount: topCount,
                  showFeatured: !filterActive,
                  settings: settings,
                }, filterActive ? filteredLeaderboardPanelProps() : {})} />)
                : (<LeaderboardTable {...Object.assign({
                  cohort: cohort,
                  entries: standingEntries,
                  leaderboardId: leaderboardId,
                  onPageChange: setPage,
                  page: page,
                  ranked: data.ranked,
                  topCount: topCount,
                  showFeatured: !filterActive,
                  settings: settings,
                }, filterActive ? filteredLeaderboardPanelProps() : {})} />)}
            </Fragment>)}
      </div>
    </main>);
  }
  return { LeaderboardPodium, LeaderboardPagination, DirtyRankLeaderboardFilterCapture, LeaderboardTable, LeaderboardGalleryCard, LeaderboardGallery, DirtyRankLeaderboardsRoute };
}
