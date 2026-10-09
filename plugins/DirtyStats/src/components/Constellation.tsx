import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, ConstellationSelection, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createConstellation(dependencies: ViewDependencies) {
  const { useStatsSetting, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, SceneCards, aggregateConstellation, constellationScenes, React, chartLifecycle, chartOptions, dataLoader, STATS_SETTING_SPECS } = dependencies;
  function ConstellationPage(props: PageProps): R.ReactElement | null {
    const chartTheme = useChartTheme();
    const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    const [chartError, setChartError] = React.useState("");
    const [refresh, setRefresh] = React.useState(0);
    const [maxPerformers, setMaxPerformers] = useStatsSetting("constellationMaxPerformers");
    const [minShared, setMinShared] = useStatsSetting("constellationMinShared");
    const [selected, setSelected] = React.useState<ConstellationSelection | null>(null);
    const node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    const queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    const stats = React.useMemo(() => aggregateConstellation(scenes, maxPerformers, minShared), [scenes, maxPerformers, minShared]);
    const matching = React.useMemo(() => constellationScenes(scenes, selected), [scenes, selected]);
    React.useEffect(() => { setSelected(null); }, [queryKey, maxPerformers, minShared]);
    pageData.useLoad({
      query: "query DirtyStatsConstellation($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id performers{id name gender}}}}",
      variables: page => sceneVariables(props.filter, page),
      entity: "scenes"
    }, [queryKey, refresh]);
    chartLifecycle.useChart(() => {
      if (loading || error || !node.current || !stats.nodes.length) return;
      return {
        node: node.current,
        chartRef,
        configure: chart => {
          chart.setOption(chartOptions.constellationOption(stats));
          chart.on("click", event => {
            if (event.componentType !== "series") return;
            const choice = event.dataType === "edge" ? { type: "pair", ids: [event.data.source, event.data.target], label: event.data.sourceName + " + " + event.data.targetName, key: "pair:" + event.data.id } : { type: "performer", ids: [event.data.id], label: event.data.name, key: "performer:" + event.data.id };
            setSelected(current => current && current.key === choice.key ? null : choice);
          });
          setChartError("");
        },
        onError: err => { setChartError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    React.useEffect(() => {
      const chart = chartRef.current;
      if (!chart) return;
      chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
      if (!selected) return;
      const dataType = selected.type === "pair" ? "edge" : "node";
      const dataIndex = dataType === "edge" ? stats.links.findIndex(link => "pair:" + link.id === selected!.key) : stats.nodes.findIndex(item => "performer:" + item.id === selected!.key);
      if (dataIndex >= 0) chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataType, dataIndex });
    }, [selected, stats, chartTheme]);
    const selectionTitle = !selected ? "Scenes" : selected.type === "pair" ? "Scenes shared by " + selected.label : "Scenes with " + selected.label;
    return (<section className="dirty-stats-content">
      {pageToolbar(loading ? "Building constellation..." : stats.totalScenes + " matching scenes · " + stats.totalPerformers + " performers · " + stats.nodes.length + " shown · " + stats.links.length + " connections", loading, () => { setRefresh(refresh + 1); })}
      {error ? (<StatsState detail={error} role="alert" title="Could not build the constellation" />) : null}
      {!loading && !error && stats.nodes.length ? (<section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Cast constellation">
        <div className="dirty-stats-map-controls">
          <label className="dirty-stats-date-basis">
            {"Maximum performers"}
            <select
              className="form-control form-control-sm dirty-ui-select"
              value={maxPerformers}
              onChange={event => { setMaxPerformers(Number(event.target.value)); }}>
              {STATS_SETTING_SPECS.constellationMaxPerformers.options.map(value => {
                return (<option key={value} value={value}>
                  {value === 0 ? "All" : value}
                </option>);
              })}
            </select>
          </label>
          <label className="dirty-stats-date-basis">
            {"Minimum shared scenes"}
            <select
              className="form-control form-control-sm dirty-ui-select"
              value={minShared}
              onChange={event => { setMinShared(Number(event.target.value)); }}>
              {STATS_SETTING_SPECS.constellationMinShared.options.map(value => {
                return (<option key={value} value={value}>
                  {value}
                </option>);
              })}
            </select>
          </label>
          {selected ? (<button className="btn btn-secondary dirty-ui-button" onClick={() => { setSelected(null); }}>
            Show all scenes
          </button>) : null}
          {exportButton(chartRef, "DirtyStats-cast-constellation.png", Boolean(chartError))}
        </div>
        {chartImage(node, "dirty-stats-constellation-chart", "Network of performers connected by matching scenes. Larger performers appear in more scenes; thicker lines represent more shared scenes.")}
      </section>) : null}
      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}
      {!loading && !error && !stats.nodes.length ? (<StatsState title="No performers occur in the matching scenes." />) : null}
      {!loading && !error && stats.nodes.length ? (<p>
        Click a performer to show their scenes, or click a connection to show shared scenes. Click the same item again to clear it. Drag performers to rearrange the graph; scroll to zoom and drag the background to pan.
      </p>) : null}
      {!loading && !error ? (<SceneCards
        scenes={matching}
        filter={props.filter}
        title={selectionTitle}
        selection={selected}
        clearSelection={() => { setSelected(null); }}
        clearLabel="Show all scenes" />) : null}
    </section>);
  }
  return { ConstellationPage };
}
