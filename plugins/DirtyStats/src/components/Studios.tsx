import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createStudios(dependencies: ViewDependencies) {
  const { useStatsSetting, useChartTheme, docsCaptureEnabled, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, SceneCards, loadStudioImage, studioSeriesData, aggregateStudios, React, chartLifecycle, chartOptions, dataLoader, STATS_SETTING_SPECS, charts, growth, formatBytes } = dependencies;
  function StudioValuePage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var minState = useStatsSetting("studioMinScenes"), minScenes = minState[0], setMinScenes = minState[1];
    var selectionState = React.useState<string | null>(null), selected = selectionState[0], setSelected = selectionState[1];
    var logoState = React.useState(0), logoVersion = logoState[0], setLogoVersion = logoState[1];
    var docsCapture = React.useMemo(function () { return docsCaptureEnabled(window.location.search); }, []);
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateStudios(scenes); }, [scenes]);
    var points = React.useMemo(function () { return stats.points.filter(function (point) { return point.rating != null && point.scenes >= minScenes; }); }, [stats, minScenes]);
    var maxBytes = React.useMemo(function () { return points.reduce(function (max, point) { return Math.max(max, point.bytes); }, 0); }, [points]);
    var selectedStudio = React.useMemo(function () { return selected == null ? null : stats.points.find(function (point) { return point.id === selected; }); }, [stats, selected]);
    var matching = React.useMemo(function () { return selected == null ? scenes : scenes.filter(function (scene) { return scene.studio && String(scene.studio.id) === selected; }); }, [scenes, selected]);
    React.useEffect(function () { setSelected(null); }, [queryKey, minScenes]);
    pageData.useLoad({
      query: "query DirtyStatsStudios($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100 studio{id name image_path} files{id size}}}}",
      variables: function (page) { return sceneVariables(props.filter, page); },
      entity: "scenes"
    }, [queryKey, refresh]);
    React.useEffect(function () {
      if (loading || error || docsCapture || !points.length) return;
      var active = true;
      var paths = points.map(function (point) { return point.image; }).filter(Boolean);
      if (!paths.length) return;
      Promise.all(paths.map(loadStudioImage)).then(function () {
        if (active) setLogoVersion(function (version) { return version + 1; });
      });
      return function () { active = false; };
    }, [points, loading, error, docsCapture]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current || !points.length) return;
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        },
        configure: function (chart) {
          chart.on("click", function (event) { if (event.componentType === "series" && event.data && event.data.id) setSelected(function (current) { return current === event.data.id ? null : event.data.id; }); });
          chart.setOption(chartOptions.studioOption(points, maxBytes, selected));
          setChartError("");
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [points, maxBytes, loading, error, logoVersion, chartTheme]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: studioSeriesData(points, maxBytes, selected) }] }); }, [selected, points, maxBytes, loading, error, logoVersion, chartTheme]);
    var unratedStudios = stats.points.filter(function (point) { return point.rating == null; }).length;
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Loading scenes..." : points.length + " studios \u00b7 " + stats.total + " matching scenes \u00b7 " + formatBytes(stats.totalBytes), loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />) : null}

      {!loading && !error && points.length ? (<section
        className="dirty-stats-map-panel dirty-ui-panel"
        aria-label="Studio scene count versus average rating">

        <div className="dirty-stats-map-controls">

          {selected != null ? (<button className="btn btn-secondary dirty-ui-button" onClick={function () { setSelected(null); }}>

            {"Show all scenes"}

          </button>) : null}

          <label className="dirty-stats-date-basis">

            {"Minimum scenes"}

            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={minScenes}
              onChange={function (event) { setMinScenes(Number(event.target.value)); }}>

              {STATS_SETTING_SPECS.studioMinScenes.options.map(function (value) {
                return (<option key={value} value={value}>

                  {value === 1 ? "All" : value}

                </option>);
              })}

            </select>

          </label>

          {exportButton(chartRef, "DirtyStats-studio-value.png", loading || Boolean(error) || Boolean(chartError))}

        </div>

        {chartImage(node, "dirty-stats-growth-chart", "Scatter plot of studio scene count versus average scene rating. Bubble size represents total file size.")}

      </section>) : null}

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !points.length ? (<StatsState title="No rated studios match these filters." />) : null}

      <p>

        {"Each bubble is a studio: scene count on the x-axis, average scene rating out of ten on the y-axis, and bubble size representing total file size. Highly rated studios with few scenes appear near the upper left. Click a bubble to show that studio's scenes below."}

      </p>

      {!loading && !error && (stats.missingStudio || unratedStudios || stats.missingSizes) ? (<p role="status">

        {stats.missingStudio + " scenes without a studio, " + unratedStudios + " studios without a rated scene and " + stats.missingSizes + " files with an unavailable size were omitted."}

      </p>) : null}

      {!loading && !error ? (<SceneCards
        scenes={matching}
        filter={props.filter}
        title={selectedStudio ? "Scenes by " + selectedStudio.name : "Scenes"}
        selection={selected}
        clearSelection={function () { setSelected(null); }}
        clearLabel="Show all scenes" />) : null}

    </section>);
  }
  return { StudioValuePage };
}
