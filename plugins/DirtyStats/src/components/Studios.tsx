import { SceneCards } from "./Cards";
import { StatsState, chartImage, exportButton, pageToolbar } from "./Primitives";
import { aggregateStudios, loadStudioImage, sceneVariables, studioSeriesData } from "../domain/analytics";
import { docsCaptureEnabled } from "../domain/filters";
import { formatBytes } from "../domain/growth";
import { React } from "../runtime";
import { STATS_SETTING_SPECS, useChartTheme, useStatsSetting } from "../settings";
import * as chartLifecycle from "../domain/charts";
import * as chartOptions from "../domain/chartOptions";
import * as dataLoader from "../domain/data";
import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
export function StudioValuePage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(),
    scenes = pageData.rows,
    loading = pageData.loading,
    error = pageData.error;
  const [chartError, setChartError] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const [minScenes, setMinScenes] = useStatsSetting("studioMinScenes");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [logoVersion, setLogoVersion] = React.useState(0);
  const docsCapture = React.useMemo(() => docsCaptureEnabled(window.location.search), []);
  const node = React.useRef<HTMLDivElement>(null),
    chartRef = React.useRef<ChartInstance | null>(null);
  const queryKey = JSON.stringify(sceneVariables(props.filter, 1));
  const stats = React.useMemo(() => aggregateStudios(scenes), [scenes]);
  const points = React.useMemo(
    () => stats.points.filter(point => point.rating != null && point.scenes >= minScenes),
    [stats, minScenes],
  );
  const maxBytes = React.useMemo(() => points.reduce((max, point) => Math.max(max, point.bytes), 0), [points]);
  const selectedStudio = React.useMemo(
    () => (selected == null ? null : stats.points.find(point => point.id === selected)),
    [stats, selected],
  );
  const matching = React.useMemo(
    () => (selected == null ? scenes : scenes.filter(scene => scene.studio && String(scene.studio.id) === selected)),
    [scenes, selected],
  );
  React.useEffect(() => {
    setSelected(null);
  }, [queryKey, minScenes]);
  pageData.useLoad(
    {
      query:
        "query DirtyStatsStudios($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100 studio{id name image_path} files{id size}}}}",
      variables: page => sceneVariables(props.filter, page),
      entity: "scenes",
    },
    [queryKey, refresh],
  );
  React.useEffect(() => {
    if (loading || error || docsCapture || !points.length) return;
    let active = true;
    const paths = points.map(point => point.image).filter(Boolean);
    if (!paths.length) return;
    Promise.all(paths.map(loadStudioImage)).then(() => {
      if (active) setLogoVersion(version => version + 1);
    });
    return () => {
      active = false;
    };
  }, [points, loading, error, docsCapture]);
  chartLifecycle.useChart(() => {
    if (loading || error || !node.current || !points.length) return;
    return {
      node: node.current,
      chartRef,
      configure: chart => {
        chart.on("click", event => {
          if (event.componentType === "series" && event.data && event.data.id)
            setSelected(current => (current === event.data.id ? null : event.data.id));
        });
        chart.setOption(chartOptions.studioOption(points, maxBytes, selected));
        setChartError("");
      },
      onError: err => {
        setChartError(err.message);
      },
    };
  }, [points, maxBytes, loading, error, logoVersion, chartTheme]);
  React.useEffect(() => {
    if (chartRef.current)
      chartRef.current.setOption({ series: [{ data: studioSeriesData(points, maxBytes, selected) }] });
  }, [selected, points, maxBytes, loading, error, logoVersion, chartTheme]);
  const unratedStudios = stats.points.filter(point => point.rating == null).length;
  return (
    <section className="dirty-stats-content">
      {pageToolbar(
        loading
          ? "Loading scenes..."
          : points.length +
              " studios \u00b7 " +
              stats.total +
              " matching scenes \u00b7 " +
              formatBytes(stats.totalBytes),
        loading,
        () => {
          setRefresh(refresh + 1);
        },
      )}
      {error ? (
        <StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />
      ) : null}
      {!loading && !error && points.length ? (
        <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Studio scene count versus average rating">
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
              {"Minimum scenes"}
              <select
                className="form-control dirty-ui-select dirty-stats-statistic"
                value={minScenes}
                onChange={event => {
                  setMinScenes(Number(event.target.value));
                }}
              >
                {STATS_SETTING_SPECS.studioMinScenes.options.map(value => {
                  return (
                    <option key={value} value={value}>
                      {value === 1 ? "All" : value}
                    </option>
                  );
                })}
              </select>
            </label>
            {exportButton(chartRef, "DirtyStats-studio-value.png", loading || Boolean(error) || Boolean(chartError))}
          </div>
          {chartImage(
            node,
            "dirty-stats-growth-chart",
            "Scatter plot of studio scene count versus average scene rating. Bubble size represents total file size.",
          )}
        </section>
      ) : null}
      {chartError ? <StatsState detail={chartError} role="alert" title="Chart unavailable" /> : null}
      {!loading && !error && !points.length ? <StatsState title="No rated studios match these filters." /> : null}
      <p>
        Each bubble is a studio: scene count on the x-axis, average scene rating out of ten on the y-axis, and bubble
        size representing total file size. Highly rated studios with few scenes appear near the upper left. Click a
        bubble to show that studio's scenes below.
      </p>
      {!loading && !error && (stats.missingStudio || unratedStudios || stats.missingSizes) ? (
        <p role="status">
          {stats.missingStudio +
            " scenes without a studio, " +
            unratedStudios +
            " studios without a rated scene and " +
            stats.missingSizes +
            " files with an unavailable size were omitted."}
        </p>
      ) : null}
      {!loading && !error ? (
        <SceneCards
          scenes={matching}
          filter={props.filter}
          title={selectedStudio ? "Scenes by " + selectedStudio.name : "Scenes"}
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
