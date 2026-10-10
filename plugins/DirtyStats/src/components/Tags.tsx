import { SceneCards } from "./Cards";
import { StatsState, chartImage, exportButton, pageToolbar } from "./Primitives";
import {
  aggregateTagDna,
  sceneVariables,
  tagDnaMetricLabel,
  tagDnaScenes,
  tagDnaSeriesData,
} from "../domain/analytics";
import { React } from "../runtime";
import { STATS_SETTING_SPECS, useChartTheme, useStatsSetting } from "../settings";
import * as chartLifecycle from "../domain/charts";
import * as chartOptions from "../domain/chartOptions";
import * as dataLoader from "../domain/data";
import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
export function TagDnaPage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(),
    scenes = pageData.rows,
    loading = pageData.loading,
    error = pageData.error;
  const [chartError, setChartError] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [metric, setMetric] = useStatsSetting("tagDnaColorMetric");
  const [maxTags, setMaxTags] = useStatsSetting("tagDnaMaxTags");
  const [refresh, setRefresh] = React.useState(0);
  const node = React.useRef<HTMLDivElement>(null),
    chartRef = React.useRef<ChartInstance | null>(null);
  const queryKey = JSON.stringify(sceneVariables(props.filter, 1));
  const stats = React.useMemo(() => aggregateTagDna(scenes), [scenes]);
  const data = React.useMemo(
    () => tagDnaSeriesData(stats, metric, maxTags, selected),
    [stats, metric, maxTags, selected, chartTheme],
  );
  const selectedTag = React.useMemo(
    () => (selected == null ? null : stats.rows.find(row => row.id === selected)),
    [stats, selected],
  );
  const matching = React.useMemo(() => tagDnaScenes(scenes, selected), [scenes, selected]);
  React.useEffect(() => {
    setSelected(null);
  }, [queryKey]);
  React.useEffect(() => {
    if (selected != null && !data.some(item => item.id === selected)) setSelected(null);
  }, [selected, data]);
  pageData.useLoad(
    {
      query:
        "query DirtyStatsTagDna($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100 play_count tags{id name}}}}",
      variables: page => sceneVariables(props.filter, page),
      entity: "scenes",
    },
    [queryKey, refresh],
  );
  chartLifecycle.useChart(() => {
    if (loading || error || !node.current || !data.length) return;
    return {
      node: node.current,
      chartRef,
      configure: chart => {
        chart.on("click", event => {
          if (event.componentType === "series" && event.data && event.data.id)
            setSelected(current => (current === event.data.id ? null : event.data.id));
        });
        chart.setOption(chartOptions.tagDnaOption(data, metric), true);
        setChartError("");
      },
      onError: err => {
        setChartError(err.message);
      },
    };
  }, [data, metric, loading, error, chartTheme]);
  return (
    <section className="dirty-stats-content">
      {pageToolbar(
        loading
          ? "Loading scene tags..."
          : stats.tags + " tags · " + stats.taggedScenes + " tagged scenes · " + stats.untaggedScenes + " untagged",
        loading,
        () => {
          setRefresh(refresh + 1);
        },
      )}
      {error ? (
        <StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scene tags" />
      ) : null}
      {!loading && !error && data.length ? (
        <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Tag DNA treemap">
          <div className="dirty-stats-map-controls">
            {selected != null ? (
              <button
                className="btn btn-secondary dirty-ui-button"
                onClick={() => {
                  setSelected(null);
                }}
              >
                Show all scenes
              </button>
            ) : null}
            <label className="dirty-stats-date-basis">
              {"Color by"}
              <select
                className="form-control dirty-ui-select dirty-stats-statistic"
                value={metric}
                onChange={event => {
                  setMetric(event.target.value);
                }}
              >
                {STATS_SETTING_SPECS.tagDnaColorMetric.options.map(value => {
                  return (
                    <option key={value} value={value}>
                      {tagDnaMetricLabel(value)}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="dirty-stats-date-basis">
              {"Maximum tags"}
              <select
                className="form-control dirty-ui-select dirty-stats-statistic"
                value={maxTags}
                onChange={event => {
                  setMaxTags(Number(event.target.value));
                }}
              >
                {STATS_SETTING_SPECS.tagDnaMaxTags.options.map(value => {
                  return (
                    <option key={value} value={value}>
                      {value || "All"}
                    </option>
                  );
                })}
              </select>
            </label>
            <span
              className="dirty-stats-tag-color-key"
              title="Darker cells have a lower value; gold cells have a higher value."
            >
              <span>Lower</span>
              <i aria-hidden={true} />
              <span>Higher</span>
            </span>
            {exportButton(chartRef, "DirtyStats-tag-dna.png", loading || Boolean(error) || Boolean(chartError))}
          </div>
          {chartImage(
            node,
            "dirty-stats-growth-chart dirty-stats-tag-chart",
            "Treemap of tags sized by distinct scene count and colored by " +
              tagDnaMetricLabel(metric).toLowerCase() +
              ".",
          )}
        </section>
      ) : null}
      {chartError ? <StatsState detail={chartError} role="alert" title="Chart unavailable" /> : null}
      {!loading && !error && !data.length ? <StatsState title="No tagged scenes match these filters." /> : null}
      <p>
        {"Rectangle area represents distinct scene count. Color represents " +
          tagDnaMetricLabel(metric).toLowerCase() +
          "; gray tags have no rated scenes. Showing " +
          data.length +
          " of " +
          stats.tags +
          " tags. Click a tag to show its scenes below."}
      </p>
      {!loading && !error ? (
        <SceneCards
          scenes={matching}
          filter={props.filter}
          title={selectedTag ? "Scenes tagged " + selectedTag.name : "Scenes"}
          selection={selected}
          clearSelection={() => {
            setSelected(null);
          }}
          clearLabel="Show all scenes"
        />
      ) : null}
    </section>
  );
}
