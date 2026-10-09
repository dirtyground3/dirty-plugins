import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createCounters(dependencies: ViewDependencies) {
  const { useStatsSetting, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, SceneCards, countRatingLabel, countRatingSeriesData, aggregateCountRating, aggregateRepeatOffenders, repeatOffenderSeriesData, repeatOffenderRowAtShare, React, chartLifecycle, chartOptions, dataLoader, STATS_SETTING_SPECS, charts, growth } = dependencies;
  function CountRatingPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var selectionState = React.useState<string | null>(null), selected = selectionState[0], setSelected = selectionState[1];
    var metricState = useStatsSetting("countRatingMetric"), metric = metricState[0], setMetric = metricState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateCountRating(scenes, metric); }, [scenes, metric]);
    React.useEffect(function () { setSelected(null); }, [queryKey, metric]);
    pageData.useLoad({
      query: "query DirtyStatsCountRating($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id title rating100 play_count o_counter}}}",
      variables: function (page) { return sceneVariables(props.filter, page); },
      entity: "scenes"
    }, [queryKey, refresh]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current || !stats.points.length) return;
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        },
        configure: function (chart) {
          chart.on("click", function (event) { if (event.componentType === "series" && event.data && event.data.id) setSelected(function (current) { return current === event.data.id ? null : event.data.id; }); });
          chart.setOption(chartOptions.countRatingOption(stats, metric, selected));
          setChartError("");
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [stats, metric, loading, error, chartTheme]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: countRatingSeriesData(stats, selected) }] }); }, [selected, stats, metric, loading, error, chartTheme]);
    var matching = React.useMemo(function () { return selected == null ? scenes : scenes.filter(function (scene) { return String(scene.id) === selected; }); }, [scenes, selected]);
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Loading scenes..." : stats.points.length + " rated scenes", loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />) : null}

      {!loading && !error && stats.points.length ? (<section
        className="dirty-stats-map-panel dirty-ui-panel"
        aria-label={"Scene rating versus " + countRatingLabel(metric).toLowerCase()}>

        <div className="dirty-stats-map-controls">

          {selected != null ? (<button className="btn btn-secondary dirty-ui-button" onClick={function () { setSelected(null); }}>

            {"Show all scenes"}

          </button>) : null}

          <label className="dirty-stats-date-basis">

            {"Count"}

            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={metric}
              onChange={function (event) { setMetric(event.target.value); }}>

              {STATS_SETTING_SPECS.countRatingMetric.options.map(function (value) {
                return (<option key={value} value={value}>

                  {countRatingLabel(value)}

                </option>);
              })}

            </select>

          </label>

          {exportButton(chartRef, "DirtyStats-" + metric + "-vs-scene-rating.png", loading || Boolean(error) || Boolean(chartError))}

        </div>

        {chartImage(node, "dirty-stats-growth-chart", "Scatter plot of scene rating out of ten versus scene " + countRatingLabel(metric).toLowerCase() + ".")}

      </section>) : null}

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !stats.points.length ? (<StatsState title="No rated scenes match these filters." />) : null}

      <p>

        {"Each dot is a distinct scene: scene rating out of ten on the x-axis and " + countRatingLabel(metric).toLowerCase() + " on the y-axis. Use Count to switch between the scene's view count and its O count. Click a dot to show that scene below."}

      </p>

      {!loading && !error && stats.missingRating ? (<p role="status">

        {stats.missingRating + " scenes without a rating were omitted."}

      </p>) : null}

      {!loading && !error ? (<SceneCards
        scenes={matching}
        filter={props.filter}
        title={selected == null ? "Scenes" : "Selected scene"}
        selection={selected}
        clearSelection={function () { setSelected(null); }}
        clearLabel="Show all scenes" />) : null}

    </section>);
  }

  function RepeatOffenderPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var selectionState = React.useState<string | null>(null), selected = selectionState[0], setSelected = selectionState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateRepeatOffenders(scenes); }, [scenes]);
    React.useEffect(function () { setSelected(null); }, [queryKey]);
    pageData.useLoad({
      query: "query DirtyStatsRepeatOffenders($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id title play_count}}}",
      variables: function (page) { return sceneVariables(props.filter, page); },
      entity: "scenes"
    }, [queryKey, refresh]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current || !stats.totalViews) return;
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        },
        configure: function (chart) {
          chart.getZr().on("click", function (event) {
            var pixel = [event.offsetX, event.offsetY];
            if (!chart.containPixel({ gridIndex: 0 }, pixel)) return;
            var value = chart.convertFromPixel({ gridIndex: 0 }, pixel);
            var row = value && repeatOffenderRowAtShare(stats, value[0]);
            var rowPixel = row && chart.convertToPixel({ gridIndex: 0 }, [row.sceneShare, row.viewShare]);
            if (!rowPixel || Math.abs(rowPixel[0] - pixel[0]) > 12 || Math.abs(rowPixel[1] - pixel[1]) > 12) return;
            setSelected(function (current) { return current === row!.id ? null : row!.id; });
          });
          chart.setOption(chartOptions.repeatOffenderOption(stats, selected));
          setChartError("");
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: repeatOffenderSeriesData(stats, selected) }] }); }, [selected, stats, loading, error, chartTheme]);
    var matching = React.useMemo(function () { return selected == null ? scenes : scenes.filter(function (scene) { return String(scene.id) === selected; }); }, [scenes, selected]);
    var topShare = Math.round(stats.topShare * 10) / 10;
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Loading scenes..." : stats.totalViews ? "Top 5% (" + stats.topCount + " scene" + (stats.topCount === 1 ? "" : "s") + ") account for " + topShare.toFixed(1) + "% of " + stats.totalViews + " recorded views" : stats.totalScenes + " scenes · no recorded views", loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />) : null}

      {!loading && !error && stats.totalViews ? (<section
        className="dirty-stats-map-panel dirty-ui-panel"
        aria-label="Cumulative share of views by scene rank">

        <div className="dirty-stats-map-controls">

          {selected != null ? (<button className="btn btn-secondary dirty-ui-button" onClick={function () { setSelected(null); }}>

            {"Show all scenes"}

          </button>) : null}

          {exportButton(chartRef, "DirtyStats-repeat-offender-curve.png", Boolean(chartError))}

        </div>

        {chartImage(node, "dirty-stats-growth-chart", "Curve showing the cumulative share of recorded views as scenes are added from most viewed to least viewed.")}

      </section>) : null}

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !stats.totalScenes ? (<StatsState title="No scenes match these filters." />) : null}

      {!loading && !error && stats.totalScenes && !stats.totalViews ? (<StatsState
        title="No recorded views match these filters."
        detail="Play some scenes to reveal how concentrated your viewing is." />) : null}

      <p>

        {"Scenes are ranked from most viewed to least viewed. A steep early rise means a small set receives most of your attention; the dashed diagonal shows an even distribution. Click a point on the curve to show that scene below."}

      </p>

      {!loading && !error && stats.totalViews ? (<p role="status">

        {stats.viewedScenes + " of " + stats.totalScenes + " scenes have at least one recorded view; " + (stats.totalScenes - stats.viewedScenes) + " have none."}

      </p>) : null}

      {!loading && !error ? (<SceneCards
        scenes={matching}
        filter={props.filter}
        title={selected == null ? "Scenes" : "Selected scene"}
        selection={selected}
        clearSelection={function () { setSelected(null); }}
        clearLabel="Show all scenes" />) : null}

    </section>);
  }
  return { CountRatingPage, RepeatOffenderPage };
}
