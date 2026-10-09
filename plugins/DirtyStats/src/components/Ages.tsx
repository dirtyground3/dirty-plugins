import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createAges(dependencies: ViewDependencies) {
  const { themeColor, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, useAgePerformerFilter, filterAgeScenes, sceneVariables, performerVariables, PerformerCards, React, chartLifecycle, chartOptions, dataLoader, charts, aggregateAges, performersAtAge } = dependencies;
  function AgePage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, sceneLoading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var performerModel = useAgePerformerFilter();
    var matchingState = React.useState<string[] | null>(null), matchingIds = matchingState[0], setMatchingIds = matchingState[1];
    var matchingLoadingState = React.useState(false), matchingLoading = matchingLoadingState[0], setMatchingLoading = matchingLoadingState[1];
    var matchingErrorState = React.useState(""), matchingError = matchingErrorState[0], setMatchingError = matchingErrorState[1];
    var performerKey = JSON.stringify(performerModel ? performerVariables(performerModel!, 1) : null);
    var loading = sceneLoading || matchingLoading;
    dataLoader.usePageLoad<StatsPerformer>({
      query: "query DirtyStatsAgePerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id}}}",
      variables: function (page) {
        var variables = performerVariables(performerModel!, page);
        variables.filter.sort = "id"; variables.filter.direction = "ASC";
        return variables;
      },
      collection: function (response) {
        var batch = response.findPerformers;
        return { count: batch!.count, rows: batch!.performers };
      },
      failureLabel: "The performer list changed while loading. Try Refresh.",
      enabled: Boolean(performerModel),
      onDisabled: function () { setMatchingIds(null); },
      onError: function () { setMatchingIds([]); },
      setLoading: setMatchingLoading,
      setError: setMatchingError,
      publish: function (result) { setMatchingIds(result.map(performer => performer.id)); }
    }, [performerKey, refresh]);
    var matchingScenes = React.useMemo(function () { return filterAgeScenes(scenes, matchingIds); }, [scenes, matchingIds]);
    var ageState = React.useState<number | null>(null), selectedAge = ageState[0], setSelectedAge = ageState[1];
    React.useEffect(function () { setSelectedAge(null); }, [queryKey, performerKey]);
    var selectedPerformers = React.useMemo(function () { return performersAtAge(matchingScenes, selectedAge); }, [matchingScenes, selectedAge]);
    var stats = React.useMemo(function () { return aggregateAges(matchingScenes); }, [matchingScenes]);
    pageData.useLoad({
      query: "query DirtyStatsAges($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id date performers{id birthdate}}}}",
      variables: function (page) { return sceneVariables(props.filter, page); },
      entity: "scenes"
    }, [queryKey, refresh]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current) return;
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload the Stash page.");
        },
        configure: function (chart) {
          chart.on("click", function (event) { if (event.componentType === "series" && Number.isFinite(Number(event.name))) setSelectedAge(Number(event.name)); });
          chart.setOption(chartOptions.ageOption(stats));
          setChartError("");
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    React.useEffect(function () {
      if (chartRef.current) chartRef.current.setOption({ series: [{ data: stats.rows.map(function (row) { return { value: row.count, itemStyle: { color: selectedAge === row.age ? themeColor("accent") : themeColor("primary") } }; }) }] });
    }, [selectedAge, stats, loading, error, chartTheme]);
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Loading scene ages..." : stats.performers + " distinct performers across " + stats.scenes + " matching scenes", loading, function () { setRefresh(refresh + 1); })}

      {matchingError ? (<StatsState detail={"Performer filters: " + matchingError} role="alert" title="Performer filter error" />) : null}

      {error ? (<StatsState detail={error} role="alert" title="Could not load scene ages" />) : null}

      <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Performer age histogram">

        <div className="dirty-stats-map-controls">

          {exportButton(chartRef, "DirtyStats-age-at-scene.png", loading || Boolean(error) || Boolean(chartError))}

        </div>

        {!loading && !error ? (chartImage(node, "dirty-stats-growth-chart dirty-stats-age-chart", "Histogram of age in completed years at scene date versus distinct performer count.")) : null}

      </section>

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !stats.rows.length ? (<StatsState title="No performers with valid birthdates and scene dates match these filters." />) : null}

      <p>

        {"Click an age bar to show its performers below. Each bar counts distinct performers at that age on matching scene dates. Repeated scenes at the same age count once; a performer may appear in several age bars."}

      </p>

      {!loading && !error && (stats.missingSceneDates || stats.missingBirthdates) ? (<p role="status">

        {stats.missingSceneDates + " scenes without valid full dates and " + stats.missingBirthdates + " performer appearances without usable birthdates were excluded."}

      </p>) : null}

      {!loading && !error ? (<PerformerCards
        performers={selectedPerformers}
        title={selectedAge == null ? "Performers" : "Performers aged " + selectedAge}
        selection={selectedAge}
        clearSelection={function () { setSelectedAge(null); }}
        clearLabel="Show all ages" />) : null}

    </section>);
  }
  return { AgePage };
}
