import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, ConstellationSelection, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createConstellation(dependencies: ViewDependencies) {
  const { useStatsSetting, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, SceneCards, aggregateConstellation, constellationScenes, React, chartLifecycle, chartOptions, dataLoader, STATS_SETTING_SPECS, charts } = dependencies;
  function ConstellationPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var maxState = useStatsSetting("constellationMaxPerformers"), maxPerformers = maxState[0], setMaxPerformers = maxState[1];
    var sharedState = useStatsSetting("constellationMinShared"), minShared = sharedState[0], setMinShared = sharedState[1];
    var selectionState = React.useState<ConstellationSelection | null>(null), selected = selectionState[0], setSelected = selectionState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateConstellation(scenes, maxPerformers, minShared); }, [scenes, maxPerformers, minShared]);
    var matching = React.useMemo(function () { return constellationScenes(scenes, selected); }, [scenes, selected]);
    React.useEffect(function () { setSelected(null); }, [queryKey, maxPerformers, minShared]);
    pageData.useLoad({
      query: "query DirtyStatsConstellation($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id performers{id name gender}}}}",
      variables: function (page) { return sceneVariables(props.filter, page); },
      entity: "scenes"
    }, [queryKey, refresh]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current || !stats.nodes.length) return;
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        },
        configure: function (chart) {
          chart.setOption(chartOptions.constellationOption(stats));
          chart.on("click", function (event) {
            if (event.componentType !== "series") return;
            var choice = event.dataType === "edge" ? { type: "pair", ids: [event.data.source, event.data.target], label: event.data.sourceName + " + " + event.data.targetName, key: "pair:" + event.data.id } : { type: "performer", ids: [event.data.id], label: event.data.name, key: "performer:" + event.data.id };
            setSelected(function (current) { return current && current.key === choice.key ? null : choice; });
          });
          setChartError("");
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    React.useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
      if (!selected) return;
      var dataType = selected.type === "pair" ? "edge" : "node";
      var dataIndex = dataType === "edge" ? stats.links.findIndex(function (link) { return "pair:" + link.id === selected!.key; }) : stats.nodes.findIndex(function (item) { return "performer:" + item.id === selected!.key; });
      if (dataIndex >= 0) chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataType: dataType, dataIndex: dataIndex });
    }, [selected, stats, chartTheme]);
    var selectionTitle = !selected ? "Scenes" : selected.type === "pair" ? "Scenes shared by " + selected.label : "Scenes with " + selected.label;
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Building constellation..." : stats.totalScenes + " matching scenes · " + stats.totalPerformers + " performers · " + stats.nodes.length + " shown · " + stats.links.length + " connections", loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error} role="alert" title="Could not build the constellation" />) : null}

      {!loading && !error && stats.nodes.length ? (<section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Cast constellation">

        <div className="dirty-stats-map-controls">

          <label className="dirty-stats-date-basis">

            {"Maximum performers"}

            <select
              className="form-control form-control-sm dirty-ui-select"
              value={maxPerformers}
              onChange={function (event) { setMaxPerformers(Number(event.target.value)); }}>

              {STATS_SETTING_SPECS.constellationMaxPerformers.options.map(function (value) {
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
              onChange={function (event) { setMinShared(Number(event.target.value)); }}>

              {STATS_SETTING_SPECS.constellationMinShared.options.map(function (value) {
                return (<option key={value} value={value}>

                  {value}

                </option>);
              })}

            </select>

          </label>

          {selected ? (<button className="btn btn-secondary dirty-ui-button" onClick={function () { setSelected(null); }}>

            {"Show all scenes"}

          </button>) : null}

          {exportButton(chartRef, "DirtyStats-cast-constellation.png", Boolean(chartError))}

        </div>

        {chartImage(node, "dirty-stats-constellation-chart", "Network of performers connected by matching scenes. Larger performers appear in more scenes; thicker lines represent more shared scenes.")}

      </section>) : null}

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !stats.nodes.length ? (<StatsState title="No performers occur in the matching scenes." />) : null}

      {!loading && !error && stats.nodes.length ? (<p>

        {"Click a performer to show their scenes, or click a connection to show shared scenes. Click the same item again to clear it. Drag performers to rearrange the graph; scroll to zoom and drag the background to pan."}

      </p>) : null}

      {!loading && !error ? (<SceneCards
        scenes={matching}
        filter={props.filter}
        title={selectionTitle}
        selection={selected}
        clearSelection={function () { setSelected(null); }}
        clearLabel="Show all scenes" />) : null}

    </section>);
  }
  return { ConstellationPage };
}
