import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createQuality(dependencies: ViewDependencies) {
  const { useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, SceneCards, aggregateQualityEfficiency, React, chartLifecycle, chartOptions, dataLoader, charts, formatBytes } = dependencies;
  function QualityEfficiencyPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var selectionState = React.useState<string | null>(null), selected = selectionState[0], setSelected = selectionState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateQualityEfficiency(scenes); }, [scenes]);
    React.useEffect(function () { setSelected(null); }, [queryKey]);
    pageData.useLoad({
      query: "query DirtyStatsQualityEfficiency($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id title rating100 files{id size duration}}}}",
      variables: function (page) { return sceneVariables(props.filter, page); },
      entity: "scenes"
    }, [queryKey, refresh]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current || !stats.points.length) return;
      function tooltip(p: import("../types").ChartEvent) {
        return p.data.title + "\nRating " + p.value[1].toFixed(1) + "/10\n" + p.value[0].toFixed(1) + " min/GiB\n" + Math.round(p.data.duration / 60) + " min in " + formatBytes(p.data.bytes);
      }
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        },
        configure: function (chart) {
          chart.on("click", function (event) { if (event.componentType === "series" && event.data && event.data.id) setSelected(function (current) { return current === event.data.id ? null : event.data.id; }); });
          chart.setOption(chartOptions.qualityEfficiencyOption(stats, tooltip));
          setChartError("");
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    var matching = React.useMemo(function () {
      var eligible = new Set(stats.points.map(function (point) { return point.id; }));
      return scenes.filter(function (scene) { return eligible.has(String(scene.id)) && (selected == null || String(scene.id) === selected); });
    }, [scenes, selected, stats]);
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Calculating efficiency..." : stats.points.length + " comparable scenes", loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scenes" />) : null}

      {!loading && !error && stats.points.length ? (<section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Scene quality and storage efficiency">

        <div className="dirty-stats-map-controls">

          {selected != null ? (<button className="btn btn-secondary dirty-ui-button" onClick={function () { setSelected(null); }}>

            {"Show all scenes"}

          </button>) : null}

          {exportButton(chartRef, "DirtyStats-quality-efficiency.png", loading || Boolean(error) || Boolean(chartError))}

        </div>

        {chartImage(node, "dirty-stats-growth-chart", "Bubble plot of scene storage efficiency versus rating. Bubble area represents total file size.")}

      </section>) : null}

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !stats.points.length ? (<StatsState
        title="No comparable scenes match these filters."
        detail="A scene needs a rating plus file size and duration." />) : null}

      <p>

        {"Each bubble is a scene. Farther right means more playable minutes per GiB; higher means a better rating; bubble area represents its total file size. Click a bubble to show that scene below."}

      </p>

      {!loading && !error && (stats.missingRating || stats.missingFileData) ? (<p role="status">

        {stats.missingRating + " scenes without a rating and " + stats.missingFileData + " without usable file size and duration were omitted."}

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
  return { QualityEfficiencyPage };
}
