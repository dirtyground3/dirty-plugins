import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createTags(dependencies: ViewDependencies) {
  const { useStatsSetting, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, SceneCards, aggregateTagDna, tagDnaMetricLabel, tagDnaSeriesData, tagDnaScenes, React, chartLifecycle, chartOptions, dataLoader, STATS_SETTING_SPECS, charts, growth } = dependencies;
  function TagDnaPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var selectionState = React.useState<string | null>(null), selected = selectionState[0], setSelected = selectionState[1];
    var metricState = useStatsSetting("tagDnaColorMetric"), metric = metricState[0], setMetric = metricState[1];
    var limitState = useStatsSetting("tagDnaMaxTags"), maxTags = limitState[0], setMaxTags = limitState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateTagDna(scenes); }, [scenes]);
    var data = React.useMemo(function () { return tagDnaSeriesData(stats, metric, maxTags, selected); }, [stats, metric, maxTags, selected, chartTheme]);
    var selectedTag = React.useMemo(function () { return selected == null ? null : stats.rows.find(function (row) { return row.id === selected; }); }, [stats, selected]);
    var matching = React.useMemo(function () { return tagDnaScenes(scenes, selected); }, [scenes, selected]);
    React.useEffect(function () { setSelected(null); }, [queryKey]);
    React.useEffect(function () { if (selected != null && !data.some(function (item) { return item.id === selected; })) setSelected(null); }, [selected, data]);
    pageData.useLoad({
      query: "query DirtyStatsTagDna($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100 play_count tags{id name}}}}",
      variables: function (page) { return sceneVariables(props.filter, page); },
      entity: "scenes"
    }, [queryKey, refresh]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current || !data.length) return;
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        },
        configure: function (chart) {
          chart.on("click", function (event) { if (event.componentType === "series" && event.data && event.data.id) setSelected(function (current) { return current === event.data.id ? null : event.data.id; }); });
          chart.setOption(chartOptions.tagDnaOption(data, metric), true);
          setChartError("");
        },
        onError: function (err) { setChartError(err.message); }
      };
    }, [data, metric, loading, error, chartTheme]);
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Loading scene tags..." : stats.tags + " tags · " + stats.taggedScenes + " tagged scenes · " + stats.untaggedScenes + " untagged", loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load scene tags" />) : null}

      {!loading && !error && data.length ? (<section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Tag DNA treemap">

        <div className="dirty-stats-map-controls">

          {selected != null ? (<button className="btn btn-secondary dirty-ui-button" onClick={function () { setSelected(null); }}>

            {"Show all scenes"}

          </button>) : null}

          <label className="dirty-stats-date-basis">

            {"Color by"}

            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={metric}
              onChange={function (event) { setMetric(event.target.value); }}>

              {STATS_SETTING_SPECS.tagDnaColorMetric.options.map(function (value) {
                return (<option key={value} value={value}>

                  {tagDnaMetricLabel(value)}

                </option>);
              })}

            </select>

          </label>

          <label className="dirty-stats-date-basis">

            {"Maximum tags"}

            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={maxTags}
              onChange={function (event) { setMaxTags(Number(event.target.value)); }}>

              {STATS_SETTING_SPECS.tagDnaMaxTags.options.map(function (value) {
                return (<option key={value} value={value}>

                  {value || "All"}

                </option>);
              })}

            </select>

          </label>

          <span
            className="dirty-stats-tag-color-key"
            title="Darker cells have a lower value; gold cells have a higher value.">

            <span>

              {"Lower"}

            </span>

            <i aria-hidden={true} />

            <span>

              {"Higher"}

            </span>

          </span>

          {exportButton(chartRef, "DirtyStats-tag-dna.png", loading || Boolean(error) || Boolean(chartError))}

        </div>

        {chartImage(node, "dirty-stats-growth-chart dirty-stats-tag-chart", "Treemap of tags sized by distinct scene count and colored by " + tagDnaMetricLabel(metric).toLowerCase() + ".")}

      </section>) : null}

      {chartError ? (<StatsState detail={chartError} role="alert" title="Chart unavailable" />) : null}

      {!loading && !error && !data.length ? (<StatsState title="No tagged scenes match these filters." />) : null}

      <p>

        {"Rectangle area represents distinct scene count. Color represents " + tagDnaMetricLabel(metric).toLowerCase() + "; gray tags have no rated scenes. Showing " + data.length + " of " + stats.tags + " tags. Click a tag to show its scenes below."}

      </p>

      {!loading && !error ? (<SceneCards
        scenes={matching}
        filter={props.filter}
        title={selectedTag ? "Scenes tagged " + selectedTag.name : "Scenes"}
        selection={selected}
        clearSelection={function () { setSelected(null); }}
        clearLabel="Show all scenes" />) : null}

    </section>);
  }
  return { TagDnaPage };
}
