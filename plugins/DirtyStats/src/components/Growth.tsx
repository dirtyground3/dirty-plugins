import { SceneCards } from "./Cards";
import { StatsState, chartImage, exportButton, pageToolbar } from "./Primitives";
import { sceneVariables } from "../domain/analytics";
import {
  aggregateGrowth,
  forecastGrowth,
  formatBytes,
  growthBucket,
  growthBucketEnd,
  growthDataZoomRange,
  periodGrowth,
  scenesInPeriod,
} from "../domain/growth";
import { React, hub } from "../runtime";
import { themeColor, useChartTheme, useStatsSetting } from "../settings";
import * as chartLifecycle from "../domain/charts";
import * as chartOptions from "../domain/chartOptions";
import * as dataLoader from "../domain/data";
import type * as R from "react";
import type { PageProps } from "../props";
import type { Capacity, ChartInstance, ChartOption, StatsPerformer, StatsScene } from "../types";
export function GrowthPage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(),
    scenes = pageData.rows,
    loading = pageData.loading,
    error = pageData.error;
  const [chartError, setChartError] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const node = React.useRef<HTMLDivElement>(null),
    chartRef = React.useRef<ChartInstance | null>(null),
    periodZoomRef = React.useRef<number[] | null>(null);
  const [capacity, setCapacity] = React.useState<Capacity | null>(null);
  const [showCapacity, setShowCapacity] = useStatsSetting("growthShowCapacity");
  const [capacityError, setCapacityError] = React.useState("");
  React.useEffect(() => {
    let active = true;
    setCapacity(null);
    setCapacityError("");
    hub
      .graphql<{ configuration: { general: { stashes: Array<{ path: string; excludeVideo: boolean }> } } }>(
        "query DirtyStatsSources{configuration{general{stashes{path excludeVideo}}}}",
        {},
      )
      .then(data => {
        const paths = data.configuration.general.stashes
          .filter(source => !source.excludeVideo)
          .map(source => source.path);
        return hub.runPluginOperation<Capacity>("dirtyStats", { mode: "capacity", paths });
      })
      .then(result => {
        if (active) setCapacity(result);
      })
      .catch(err => {
        if (active) setCapacityError(err.message);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const queryKey = JSON.stringify(sceneVariables(props.filter, 1));
  const [dateBasis, setDateBasis] = useStatsSetting("growthDateBasis");
  const [grouping, setGrouping] = useStatsSetting("growthGrouping");
  const [showForecast, setShowForecast] = useStatsSetting("growthShowForecast");
  const dateLabel =
    dateBasis === "mod_time"
      ? "file modification date"
      : dateBasis === "scene_date"
        ? "scene date"
        : "scene creation date";
  const [period, setPeriod] = React.useState<number[] | null>(null);
  const [anchor, setAnchor] = React.useState<number | null>(null);
  const selectionRef = React.useRef<((day: number) => void) | null>(null);
  function rememberPeriodZoom() {
    const chart = chartRef.current;
    periodZoomRef.current = chart && chart.getOption ? growthDataZoomRange(chart.getOption()) : null;
  }
  selectionRef.current = (day: number) => {
    rememberPeriodZoom();
    day = growthBucket(day, grouping);
    if (anchor == null) {
      setPeriod(null);
      setAnchor(day);
    } else {
      setPeriod([Math.min(anchor, day), growthBucketEnd(Math.max(anchor, day), grouping)]);
      setAnchor(null);
    }
  };
  React.useEffect(() => {
    setPeriod(null);
    setAnchor(null);
  }, [queryKey, dateBasis, grouping]);
  const selectedScenes = React.useMemo(() => scenesInPeriod(scenes, dateBasis, period), [scenes, dateBasis, period]);
  const stats = React.useMemo(() => aggregateGrowth(scenes, null, dateBasis, grouping), [scenes, dateBasis, grouping]);
  const forecast = React.useMemo(
    () => forecastGrowth(aggregateGrowth(scenes, null, dateBasis), capacity && capacity.total, null, period),
    [scenes, dateBasis, capacity, period],
  );
  pageData.useLoad(
    {
      query:
        "query DirtyStatsGrowth($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id created_at date files{id size mod_time}}}}",
      variables: page => sceneVariables(props.filter, page),
      entity: "scenes",
    },
    [queryKey, refresh],
  );
  chartLifecycle.useChart(() => {
    if (loading || error || !node.current) return;
    return {
      node: node.current,
      chartRef,
      configure: chart => {
        chart.setOption(chartOptions.growthOption(stats, grouping));
        let pointerDown: number[] | null = null,
          zr = chart.getZr();
        zr.on("mousedown", event => {
          pointerDown = [event.offsetX, event.offsetY];
        });
        zr.on("click", event => {
          const pixel = [event.offsetX, event.offsetY];
          if (pointerDown && Math.hypot(pixel[0] - pointerDown[0], pixel[1] - pointerDown[1]) > 5) return;
          if (!stats.points.length || !chart.containPixel({ gridIndex: 0 }, pixel)) return;
          const value = chart.convertFromPixel({ gridIndex: 0 }, pixel);
          if (!value || !Number.isFinite(value[0])) return;
          const day =
            Math.floor(
              Math.max(stats.points[0][0], Math.min(stats.points[stats.points.length - 1][0], value[0])) / 86400000,
            ) * 86400000;
          selectionRef.current?.(day);
        });
        setChartError("");
      },
      beforeDispose: chart => {
        const zoom = chart.getOption ? growthDataZoomRange(chart.getOption()) : null;
        if (zoom) periodZoomRef.current = zoom;
      },
      onError: err => {
        setChartError(err.message);
      },
    };
  }, [stats, loading, error, chartTheme]);
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const preservedZoom = periodZoomRef.current;
    const capacityLine: ChartOption[] =
      showCapacity && capacity && capacity.total > 0
        ? [
            {
              yAxis: capacity.total,
              lineStyle: { color: themeColor("muted"), type: "dashed" },
              label: {
                show: true,
                position: "insideEndTop",
                color: themeColor("text"),
                fontSize: 10,
                formatter: (capacity.errors.length ? "Known capacity: " : "Capacity: ") + formatBytes(capacity.total),
              },
            },
          ]
        : [];
    chart.setOption({
      yAxis: {
        max:
          capacityLine.length || (showForecast && forecast.points)
            ? Math.max(stats.bytes, capacity!.total) * 1.05
            : null,
      },
      series: [
        {
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: themeColor("accent"), type: "dashed" },
            data: capacityLine.concat(anchor == null ? [] : [{ xAxis: anchor }]),
          },
          markArea: {
            silent: true,
            label: { show: false },
            itemStyle: { color: themeColor("accent"), opacity: 0.2 },
            data: period ? [[{ xAxis: period[0] }, { xAxis: period[1] + 86400000 }]] : [],
          },
        },
        {
          name: "Forecast",
          type: "line",
          showSymbol: false,
          lineStyle: { color: themeColor("accent"), type: "dashed", width: 2 },
          itemStyle: { color: themeColor("accent") },
          data: showForecast && forecast.points ? forecast.points : [],
        },
      ],
    });
    if (preservedZoom && chart.dispatchAction) {
      const zooms = (chart.getOption().dataZoom || []).map((_zoom: unknown, index: number) => ({
        dataZoomIndex: index,
        startValue: preservedZoom![0],
        endValue: preservedZoom![1],
      }));
      if (zooms.length) chart.dispatchAction({ type: "dataZoom", silent: true, batch: zooms });
    }
    periodZoomRef.current = null;
  }, [period, anchor, stats, loading, error, capacity, showCapacity, showForecast, forecast, chartTheme]);
  return (
    <section className="dirty-stats-content">
      {pageToolbar(
        loading
          ? "Loading scenes..."
          : stats.included +
              " scenes \u00b7 " +
              formatBytes(stats.bytes) +
              (stats.excluded ? " \u00b7 " + stats.excluded + " excluded" : ""),
        loading,
        () => {
          setRefresh(refresh + 1);
        },
      )}
      {error ? (
        <StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />
      ) : null}
      <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Scene content growth">
        <div className="dirty-stats-map-controls">
          <label className="dirty-stats-date-basis">
            {"Date basis"}
            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={dateBasis}
              onChange={event => {
                setDateBasis(event.target.value);
              }}
            >
              <option value="created_at">Created at</option>
              <option value="mod_time">File modified at</option>
              <option value="scene_date">Scene date</option>
            </select>
          </label>
          <label
            className="dirty-stats-numbers"
            title={capacityError ? "Source capacity unavailable: " + capacityError : undefined}
          >
            <input
              type="checkbox"
              checked={showCapacity}
              onChange={event => {
                setShowCapacity(event.target.checked);
              }}
            />
            {"Show capacity"}
          </label>
          <label
            className="dirty-stats-numbers"
            title={
              forecast.reason ||
              (forecast.reachedAt
                ? "Estimated capacity date: " + new Date(forecast.reachedAt!).toISOString().slice(0, 10) + " (UTC)"
                : undefined)
            }
          >
            <input
              type="checkbox"
              checked={showForecast}
              onChange={event => {
                setShowForecast(event.target.checked);
              }}
            />
            {"Show forecast"}
          </label>
          <label className="dirty-stats-date-basis">
            {"Group by"}
            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={grouping}
              onChange={event => {
                setGrouping(event.target.value);
              }}
            >
              <option value="day">Day</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
          {period || anchor != null ? (
            <button
              className="btn btn-secondary dirty-ui-button"
              onClick={() => {
                rememberPeriodZoom();
                setPeriod(null);
                setAnchor(null);
              }}
            >
              Clear period
            </button>
          ) : null}
          {!loading && !error && (period || anchor != null) ? (
            <span className="dirty-stats-period-status" role="status">
              {period
                ? new Date(period[0]).toISOString().slice(0, 10) +
                  " to " +
                  new Date(period[1]).toISOString().slice(0, 10) +
                  " (UTC) \u00b7 " +
                  formatBytes(periodGrowth(stats.points, period)) +
                  " added \u00b7 " +
                  selectedScenes.length +
                  " scenes"
                : "Start: " +
                  new Date(anchor!).toISOString().slice(0, 10) +
                  " (UTC). Click the end date to complete the period."}
            </span>
          ) : null}
          {exportButton(
            chartRef,
            "DirtyStats-content-growth-" + dateBasis + ".png",
            loading || Boolean(error) || Boolean(chartError),
          )}
        </div>
        {!loading && !error
          ? chartImage(
              node,
              "dirty-stats-growth-chart",
              "Cumulative scene file size over time, grouped by " + dateLabel + " in UTC.",
            )
          : null}
      </section>
      {chartError ? <StatsState detail={chartError} role="alert" title="Chart unavailable" /> : null}
      {!loading && !error && !stats.included ? (
        <StatsState title="No scenes with a valid selected date and file size match these filters." />
      ) : null}
      {!loading && !error ? <SceneCards scenes={selectedScenes} filter={props.filter} /> : null}
    </section>
  );
}
