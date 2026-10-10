import { PerformerCards } from "./Cards";
import { StatsState, chartImage, exportButton, pageToolbar } from "./Primitives";
import {
  aggregateScatter,
  nearestScatterOption,
  performerVariables,
  scatterClickHitsPoint,
  scatterGuideForClick,
  scatterSeriesData,
} from "../domain/analytics";
import { React } from "../runtime";
import { STATS_SETTING_SPECS, useChartTheme, useStatsSetting } from "../settings";
import * as chartLifecycle from "../domain/charts";
import * as chartOptions from "../domain/chartOptions";
import * as dataLoader from "../domain/data";
import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
export function PerformerScatterPage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(),
    performers = pageData.rows,
    loading = pageData.loading,
    error = pageData.error;
  const [chartError, setChartError] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [minRating, setMinRating] = useStatsSetting("scatterMinRating");
  const [maxScenes, setMaxScenes] = useStatsSetting("scatterMaxScenes");
  const [refresh, setRefresh] = React.useState(0);
  const node = React.useRef<HTMLDivElement>(null),
    chartRef = React.useRef<ChartInstance | null>(null);
  const queryKey = JSON.stringify(performerVariables(props.filter, 1));
  const stats = React.useMemo(
    () => aggregateScatter(performers, minRating, maxScenes),
    [performers, minRating, maxScenes],
  );
  React.useEffect(() => {
    setSelected(null);
  }, [queryKey, minRating, maxScenes]);
  pageData.useLoad(
    {
      query:
        "query DirtyStatsPerformerScatter($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id name rating100 scene_count}}}",
      variables: page => performerVariables(props.filter, page),
      entity: "performers",
    },
    [queryKey, refresh],
  );
  chartLifecycle.useChart(() => {
    if (loading || error || !node.current || !stats.points.length) return;
    return {
      node: node.current,
      chartRef,
      configure: chart => {
        chart.on("click", event => {
          if (event.componentType === "series" && event.data && event.data.id)
            setSelected(current => (current === event.data.id ? null : event.data.id));
        });
        chart.getZr().on("click", event => {
          const pixel = [event.offsetX, event.offsetY];
          if (!stats.points.length || !chart.containPixel({ gridIndex: 0 }, pixel)) return;
          if (scatterClickHitsPoint(chart, stats.points, pixel)) return;
          const value = chart.convertFromPixel({ gridIndex: 0 }, pixel);
          if (!value || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) return;
          let rect = { x: 0, y: 0, width: chart.getWidth(), height: chart.getHeight() };
          try {
            const gridModel = chart.getModel().getComponent("grid");
            if (gridModel && gridModel.coordinateSystem) rect = gridModel.coordinateSystem.getRect();
          } catch (_error) {
            /* keep the container fallback */
          }
          const guide = scatterGuideForClick(rect, pixel);
          if (guide === "scatterMinRating") {
            setMinRating(nearestScatterOption(STATS_SETTING_SPECS.scatterMinRating.options, value[0]));
          } else if (guide === "scatterMaxScenes") {
            setMaxScenes(nearestScatterOption(STATS_SETTING_SPECS.scatterMaxScenes.options, value[1]));
          }
        });
        chart.setOption(chartOptions.scatterOption(stats, selected, maxScenes, minRating));
        setChartError("");
      },
      onError: err => {
        setChartError(err.message);
      },
    };
  }, [stats, loading, error, chartTheme]);
  React.useEffect(() => {
    if (chartRef.current) chartRef.current.setOption({ series: [{ data: scatterSeriesData(stats, selected) }] });
  }, [selected, stats, loading, error, chartTheme]);
  const matching = React.useMemo(
    () => (selected == null ? stats.points : stats.points.filter(point => point.id === selected)),
    [stats, selected],
  );
  return (
    <section className="dirty-stats-content">
      {pageToolbar(
        loading
          ? "Loading performers..."
          : stats.points.length + " rated performers \u00b7 " + stats.highlights + " high rating, few scenes",
        loading,
        () => {
          setRefresh(refresh + 1);
        },
      )}
      {error ? (
        <StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load performers" />
      ) : null}
      {!loading && !error && stats.points.length ? (
        <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Performer rating versus scene count">
          <div className="dirty-stats-map-controls">
            {selected != null ? (
              <button
                className="btn btn-secondary dirty-ui-button"
                onClick={() => {
                  setSelected(null);
                }}
              >
                Show all performers
              </button>
            ) : null}
            <label className="dirty-stats-date-basis">
              {"Minimum rating"}
              <select
                className="form-control dirty-ui-select dirty-stats-statistic"
                value={minRating}
                onChange={event => {
                  setMinRating(Number(event.target.value));
                }}
              >
                {STATS_SETTING_SPECS.scatterMinRating.options.map(value => {
                  return (
                    <option key={value} value={value}>
                      {value ? value + "+" : "Any"}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="dirty-stats-date-basis">
              {"Maximum scenes"}
              <select
                className="form-control dirty-ui-select dirty-stats-statistic"
                value={maxScenes}
                onChange={event => {
                  setMaxScenes(Number(event.target.value));
                }}
              >
                {STATS_SETTING_SPECS.scatterMaxScenes.options.map(value => {
                  return (
                    <option key={value} value={value}>
                      {value ? value : "Any"}
                    </option>
                  );
                })}
              </select>
            </label>
            {exportButton(
              chartRef,
              "DirtyStats-rating-vs-scenes.png",
              loading || Boolean(error) || Boolean(chartError),
            )}
          </div>
          {chartImage(
            node,
            "dirty-stats-growth-chart",
            "Scatter plot of performer rating out of ten versus number of scenes. Highlighted points have a high rating and few scenes.",
          )}
        </section>
      ) : null}
      {chartError ? <StatsState detail={chartError} role="alert" title="Chart unavailable" /> : null}
      {!loading && !error && !stats.points.length ? (
        <StatsState title="No rated performers match these filters." />
      ) : null}
      <p>
        Each dot is a distinct performer: rating out of ten on the x-axis and scene count on the y-axis. The upper-left
        corner holds promising performers with a high rating and few scenes; highlighted dots meet both limits. Click a
        dot to show that performer below. Click empty space near the bottom (rating axis) to set the minimum rating, or
        near the left (scenes axis) to set the maximum scenes.
      </p>
      {!loading && !error && (stats.missingRating || stats.missingScenes) ? (
        <p role="status">
          {stats.missingRating +
            " performers without a rating and " +
            stats.missingScenes +
            " with an unavailable scene count were omitted."}
        </p>
      ) : null}
      {!loading && !error ? (
        <PerformerCards
          performers={matching}
          filter={props.filter}
          title={selected == null ? "Performers" : "Selected performer"}
          selection={selected}
          clearSelection={() => {
            setSelected(null);
          }}
          clearLabel="Show all performers"
        />
      ) : null}
    </section>
  );
}
