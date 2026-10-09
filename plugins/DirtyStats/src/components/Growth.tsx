import type * as R from "react";
import type { PageProps } from "../props";
import type { Capacity, ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createGrowth(dependencies: ViewDependencies) {
  const { themeColor, useStatsSetting, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, SceneCards, hub, React, chartLifecycle, chartOptions, dataLoader, charts, formatBytes, growthBucket, growthBucketEnd, aggregateGrowth, scenesInPeriod, periodGrowth, growthDataZoomRange, forecastGrowth } = dependencies;
  function GrowthPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null), periodZoomRef = React.useRef<number[] | null>(null);
    var capacityState = React.useState<Capacity | null>(null), capacity = capacityState[0], setCapacity = capacityState[1];
    var showCapacityState = useStatsSetting("growthShowCapacity"), showCapacity = showCapacityState[0], setShowCapacity = showCapacityState[1];
    var capacityErrorState = React.useState(""), capacityError = capacityErrorState[0], setCapacityError = capacityErrorState[1];
    React.useEffect(function () {
      var active = true;
      setCapacity(null); setCapacityError("");
      hub.graphql<{ configuration: { general: { stashes: Array<{ path: string; excludeVideo: boolean }> } } }>("query DirtyStatsSources{configuration{general{stashes{path excludeVideo}}}}", {}).then(function (data) {
        var paths = data.configuration.general.stashes.filter(function (source) { return !source.excludeVideo; }).map(function (source) { return source.path; });
        return hub.runPluginOperation<Capacity>("dirtyStats", { mode: "capacity", paths: paths });
      }).then(function (result) { if (active) setCapacity(result); }).catch(function (err) { if (active) setCapacityError(err.message); });
      return function () { active = false; };
    }, [refresh]);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var dateState = useStatsSetting("growthDateBasis"), dateBasis = dateState[0], setDateBasis = dateState[1];
    var groupingState = useStatsSetting("growthGrouping"), grouping = groupingState[0], setGrouping = groupingState[1];
    var forecastState = useStatsSetting("growthShowForecast"), showForecast = forecastState[0], setShowForecast = forecastState[1];
    var dateLabel = dateBasis === "mod_time" ? "file modification date" : dateBasis === "scene_date" ? "scene date" : "scene creation date";
    var periodState = React.useState<number[] | null>(null), period = periodState[0], setPeriod = periodState[1];
    var anchorState = React.useState<number | null>(null), anchor = anchorState[0], setAnchor = anchorState[1];
    var selectionRef = React.useRef<((day: number) => void) | null>(null);
    function rememberPeriodZoom() {
      var chart = chartRef.current;
      periodZoomRef.current = chart && chart.getOption ? growthDataZoomRange(chart.getOption()) : null;
    }
    selectionRef.current = function (day: number) {
      rememberPeriodZoom();
      day = growthBucket(day, grouping);
      if (anchor == null) { setPeriod(null); setAnchor(day); }
      else { setPeriod([Math.min(anchor, day), growthBucketEnd(Math.max(anchor, day), grouping)]); setAnchor(null); }
    };
    React.useEffect(function () { setPeriod(null); setAnchor(null); }, [queryKey, dateBasis, grouping]);
    var selectedScenes = React.useMemo(function () { return scenesInPeriod(scenes, dateBasis, period); }, [scenes, dateBasis, period]);
    var stats = React.useMemo(function () { return aggregateGrowth(scenes, null, dateBasis, grouping); }, [scenes, dateBasis, grouping]);
    var forecast = React.useMemo(function () { return forecastGrowth(aggregateGrowth(scenes, null, dateBasis), capacity && capacity.total, null, period); }, [scenes, dateBasis, capacity, period]);
    pageData.useLoad({
      query: "query DirtyStatsGrowth($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id created_at date files{id size mod_time}}}}",
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
          chart.setOption(chartOptions.growthOption(stats, grouping));
          var pointerDown: number[] | null = null, zr = chart.getZr();
          zr.on("mousedown", function (event) { pointerDown = [event.offsetX, event.offsetY]; });
          zr.on("click", function (event) {
            var pixel = [event.offsetX, event.offsetY];
            if (pointerDown && Math.hypot(pixel[0] - pointerDown[0], pixel[1] - pointerDown[1]) > 5) return;
            if (!stats.points.length || !chart.containPixel({ gridIndex: 0 }, pixel)) return;
            var value = chart.convertFromPixel({ gridIndex: 0 }, pixel);
            if (!value || !Number.isFinite(value[0])) return;
            var day = Math.floor(Math.max(stats.points[0][0], Math.min(stats.points[stats.points.length - 1][0], value[0])) / 86400000) * 86400000;
            selectionRef.current?.(day);
          });
          setChartError("");
        },
        beforeDispose: function (chart) {
          var zoom = chart.getOption ? growthDataZoomRange(chart.getOption()) : null;
          if (zoom) periodZoomRef.current = zoom;
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    React.useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      var preservedZoom = periodZoomRef.current;
      var capacityLine: import("../types").ChartOption[] = showCapacity && capacity && capacity.total > 0 ? [{ yAxis: capacity.total, lineStyle: { color: themeColor("muted"), type: "dashed" }, label: { show: true, position: "insideEndTop", color: themeColor("text"), fontSize: 10, formatter: (capacity.errors.length ? "Known capacity: " : "Capacity: ") + formatBytes(capacity.total) } }] : [];
      chart.setOption({
        yAxis: { max: capacityLine.length || (showForecast && forecast.points) ? Math.max(stats.bytes, capacity!.total) * 1.05 : null }, series: [{
          markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: themeColor("accent"), type: "dashed" }, data: capacityLine.concat(anchor == null ? [] : [{ xAxis: anchor }]) },
          markArea: { silent: true, label: { show: false }, itemStyle: { color: themeColor("accent"), opacity: .2 }, data: period ? [[{ xAxis: period[0] }, { xAxis: period[1] + 86400000 }]] : [] }
        }, { name: "Forecast", type: "line", showSymbol: false, lineStyle: { color: themeColor("accent"), type: "dashed", width: 2 }, itemStyle: { color: themeColor("accent") }, data: showForecast && forecast.points ? forecast.points : [] }]
      });
      if (preservedZoom && chart.dispatchAction) {
        var zooms = (chart.getOption().dataZoom || []).map(function (_zoom: unknown, index: number) { return { dataZoomIndex: index, startValue: preservedZoom![0], endValue: preservedZoom![1] }; });
        if (zooms.length) chart.dispatchAction({ type: "dataZoom", silent: true, batch: zooms });
      }
      periodZoomRef.current = null;
    }, [period, anchor, stats, loading, error, capacity, showCapacity, showForecast, forecast, chartTheme]);
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Loading scenes..." : stats.included + " scenes \u00b7 " + formatBytes(stats.bytes) + (stats.excluded ? " \u00b7 " + stats.excluded + " excluded" : ""), loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />) : null}

      <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Scene content growth">

        <div className="dirty-stats-map-controls">

          <label className="dirty-stats-date-basis">

            {"Date basis"}

            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={dateBasis}
              onChange={function (event) { setDateBasis(event.target.value); }}>

              <option value="created_at">

                {"Created at"}

              </option>

              <option value="mod_time">

                {"File modified at"}

              </option>

              <option value="scene_date">

                {"Scene date"}

              </option>

            </select>

          </label>

          <label
            className="dirty-stats-numbers"
            title={capacityError ? "Source capacity unavailable: " + capacityError : undefined}>

            <input
              type="checkbox"
              checked={showCapacity}
              onChange={function (event) { setShowCapacity(event.target.checked); }} />

            {"Show capacity"}

          </label>

          <label
            className="dirty-stats-numbers"
            title={forecast.reason || (forecast.reachedAt ? "Estimated capacity date: " + new Date(forecast.reachedAt!).toISOString().slice(0, 10) + " (UTC)" : undefined)}>

            <input
              type="checkbox"
              checked={showForecast}
              onChange={function (event) { setShowForecast(event.target.checked); }} />

            {"Show forecast"}

          </label>

          <label className="dirty-stats-date-basis">

            {"Group by"}

            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={grouping}
              onChange={function (event) { setGrouping(event.target.value); }}>

              <option value="day">

                {"Day"}

              </option>

              <option value="month">

                {"Month"}

              </option>

              <option value="year">

                {"Year"}

              </option>

            </select>

          </label>

          {period || anchor != null ? (<button
            className="btn btn-secondary dirty-ui-button"
            onClick={function () { rememberPeriodZoom(); setPeriod(null); setAnchor(null); }}>

            {"Clear period"}

          </button>) : null}

          {!loading && !error && (period || anchor != null) ? (<span className="dirty-stats-period-status" role="status">

            {period ? new Date(period[0]).toISOString().slice(0, 10) + " to " + new Date(period[1]).toISOString().slice(0, 10) + " (UTC) \u00b7 " + formatBytes(periodGrowth(stats.points, period)) + " added \u00b7 " + selectedScenes.length + " scenes" : "Start: " + new Date(anchor!).toISOString().slice(0, 10) + " (UTC). Click the end date to complete the period."}

          </span>) : null}

          {exportButton(chartRef, "DirtyStats-content-growth-" + dateBasis + ".png", loading || Boolean(error) || Boolean(chartError))}

        </div>

        {!loading && !error ? (chartImage(node, "dirty-stats-growth-chart", "Cumulative scene file size over time, grouped by " + dateLabel + " in UTC.")) : null}

      </section>

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !stats.included ? (<StatsState title="No scenes with a valid selected date and file size match these filters." />) : null}

      {!loading && !error ? (<SceneCards scenes={selectedScenes} filter={props.filter} />) : null}

    </section>);
  }
  return { GrowthPage };
}
