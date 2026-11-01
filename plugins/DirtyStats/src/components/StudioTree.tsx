import { SceneCards } from "./Cards";
import { StatsState, chartImage, exportButton, pageToolbar } from "./Primitives";
import { STUDIO_TREE_LEVELS, aggregateStudioTree, sceneVariables, studioPath } from "../domain/analytics";
import { React } from "../runtime";
import { useChartTheme } from "../settings";
import * as chartLifecycle from "../domain/charts";
import * as chartOptions from "../domain/chartOptions";
import * as dataLoader from "../domain/data";
import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
export function StudioTreePage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(),
    scenes = pageData.rows,
    loading = pageData.loading,
    error = pageData.error;
  const [chartError, setChartError] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  // Remounting is how the chart leaves a studio it zoomed into on its own.
  const [view, setView] = React.useState(0);
  const node = React.useRef<HTMLDivElement>(null),
    chartRef = React.useRef<ChartInstance | null>(null);
  const queryKey = JSON.stringify(sceneVariables(props.filter, 1));
  const stats = React.useMemo(() => aggregateStudioTree(scenes), [scenes]);
  const matching = React.useMemo(
    () =>
      selected == null ? scenes : scenes.filter(scene => studioPath(scene.studio).some(item => item.id === selected)),
    [scenes, selected],
  );
  const selectedStudio = matching.length ? studioPath(matching[0].studio).find(item => item.id === selected) : null;
  function showAll() {
    setSelected(null);
    setView(current => current + 1);
  }
  React.useEffect(() => {
    setSelected(null);
  }, [queryKey]);
  pageData.useLoad(
    {
      query: dataLoader.STUDIO_TREE_QUERY,
      variables: page => sceneVariables(props.filter, page),
      entity: "scenes",
    },
    [queryKey, refresh],
  );
  chartLifecycle.useChart(() => {
    if (loading || error || !node.current || !stats.nodes.length) return;
    return {
      node: node.current,
      chartRef,
      configure: chart => {
        // Fires for every zoom, including the center click that goes back up to the whole chart.
        chart.on("sunburstroottonode", event => {
          const id = event.targetNode?.getId();
          setSelected(id && scenes.some(scene => studioPath(scene.studio).some(item => item.id === id)) ? id : null);
        });
        chart.setOption(chartOptions.studioTreeOption(stats.nodes, stats.total));
        setChartError("");
      },
      onError: err => {
        setChartError(err.message);
      },
    };
  }, [stats, loading, error, chartTheme, view]);
  return (
    <section className="dirty-stats-content">
      {pageToolbar(
        loading ? "Loading scenes..." : stats.studios + " studios · " + stats.total + " matching scenes",
        loading,
        () => {
          setRefresh(refresh + 1);
        },
      )}
      {error ? (
        <StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />
      ) : null}
      {!loading && !error && stats.nodes.length ? (
        <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Scenes per studio">
          <div className="dirty-stats-map-controls">
            {selected != null ? (
              <button className="btn btn-secondary dirty-ui-button" onClick={showAll}>
                Show all scenes
              </button>
            ) : null}
            {exportButton(
              chartRef,
              "DirtyStats-scenes-per-studio.png",
              loading || Boolean(error) || Boolean(chartError),
            )}
          </div>
          {chartImage(
            node,
            "dirty-stats-growth-chart",
            "Multi-level pie chart of matching scenes per studio, with sub-studios in the outer rings.",
          )}
        </section>
      ) : null}
      {chartError ? <StatsState detail={chartError} role="alert" title="Chart unavailable" /> : null}
      {!loading && !error && !stats.nodes.length ? (
        <StatsState title="No studios match these filters." detail="None of the matching scenes has a studio." />
      ) : null}
      <p>
        The inner ring holds top-level studios and each ring outward holds their sub-studios, up to {STUDIO_TREE_LEVELS}{" "}
        levels. A gap in a ring is the share of scenes directly in the parent studio. Click a segment to zoom into that
        studio and show its scenes below; click the center to go back up.
      </p>
      {!loading && !error && (stats.missingStudio || stats.merged) ? (
        <p role="status">
          {stats.missingStudio ? stats.missingStudio + " scenes without a studio were omitted. " : ""}
          {stats.merged
            ? stats.merged +
              " scenes from studios below level " +
              STUDIO_TREE_LEVELS +
              " count toward their level " +
              STUDIO_TREE_LEVELS +
              " studio."
            : ""}
        </p>
      ) : null}
      {!loading && !error ? (
        <SceneCards
          scenes={matching}
          filter={props.filter}
          title={selectedStudio ? "Scenes in " + selectedStudio.name : "Scenes"}
          selection={selected}
          clearSelection={showAll}
          clearLabel="Show all scenes"
        />
      ) : null}
    </section>
  );
}
