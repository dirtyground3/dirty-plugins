import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createRatings(dependencies: ViewDependencies) {
  const { useStatsSetting, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, performerVariables, PerformerCards, SceneCards, sceneRating, aggregateRatings, React, chartLifecycle, chartOptions, dataLoader, STATS_SETTING_SPECS, charts, growth } = dependencies;
  function RatingPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var performerMode = Boolean(props.performerMode), entity = performerMode ? "performers" : "scenes", title = performerMode ? "Performer ratings" : "Scene ratings";
    var variables = performerMode ? performerVariables : sceneVariables;
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error, setError = pageData.setError;
    var selectionState = React.useState<string | null>(null), selected = selectionState[0], setSelected = selectionState[1];
    var roundingState = useStatsSetting(performerMode ? "performerRatingRounding" : "sceneRatingRounding"), rounding = roundingState[0], setRounding = roundingState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    var queryKey = JSON.stringify(variables(props.filter, 1));
    pageData.useLoad({
      query: performerMode ? "query DirtyStatsPerformerRatings($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id rating100}}}" : "query DirtyStatsRatings($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100}}}",
      variables: function (page) { return variables(props.filter, page); },
      entity: entity as "performers" | "scenes",
      failureLabel: "The " + entity + " list changed while loading. Refresh to try again.",
      onStart: function () { setSelected(null); }
    }, [queryKey, refresh, performerMode]);
    var stats = React.useMemo(function () { return aggregateRatings(scenes, rounding); }, [scenes, rounding]);
    var matching = React.useMemo(function () { return selected == null ? scenes : scenes.filter(function (scene) { return sceneRating(scene, rounding) === selected; }); }, [scenes, selected, rounding]);
    chartLifecycle.useChart(function () {
      if (loading || error || !node.current || !stats.total) return;
      return {
        node: node.current,
        chartRef: chartRef,
        beforeInit: function () {
          if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        },
        configure: function (chart) {
          chart.setOption(chartOptions.ratingOption(stats, entity));
          chart.on("click", function (event) { if (event.componentType === "series") setSelected(function (current) { return current === event.name ? null : event.name; }); });
        },
        onError: function (err) { setError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: stats.rows.map(function (row) { return Object.assign({}, row, { selected: row.name === selected }); }) }] }); }, [selected, stats, loading, error, chartTheme]);
    return (<section className="dirty-stats-content">

      {pageToolbar(loading ? "Loading " + entity + "..." : stats.total + " matching " + entity, loading, function () { setRefresh(refresh + 1); })}

      {error ? (<StatsState detail={error} role="alert" title={"Could not load " + entity} />) : null}

      {!loading && !error && !stats.total ? (<StatsState title={"No " + entity + " match these filters."} />) : null}

      {!loading && !error && stats.total ? (<section className="dirty-stats-map-panel dirty-ui-panel" aria-label={title}>

        <div className="dirty-stats-map-controls">

          {selected != null ? (<button className="btn btn-secondary dirty-ui-button" onClick={function () { setSelected(null); }}>

            {"Show all ratings"}

          </button>) : null}

          <label className="dirty-stats-date-basis">

            {"Rating rounding"}

            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={rounding}
              onChange={function (event) { setRounding(Number(event.target.value)); setSelected(null); }}>

              {STATS_SETTING_SPECS.sceneRatingRounding.options.map(function (value) {
                return (<option key={String(value)} value={value}>

                  {value === 0 ? "Exact" : value}

                </option>);
              })}

            </select>

          </label>

          {exportButton(chartRef, performerMode ? "DirtyStats-performer-ratings.png" : "DirtyStats-scene-ratings.png")}

        </div>

        {chartImage(node, "dirty-stats-growth-chart", "Pie chart of distinct " + entity + " by rating out of ten, including unrated " + entity + ".")}

      </section>) : null}

      {!loading && !error ? (<React.Fragment>

        {selected != null ? (<p role="status">

          {selected === "Unrated" ? "Unrated " + entity : title + ": " + selected + "/10"}

        </p>) : null}

        {performerMode ? (<PerformerCards performers={matching} filter={props.filter} />) : (<SceneCards scenes={matching} filter={props.filter} />)}

      </React.Fragment>) : null}

    </section>);
  }
  return { RatingPage };
}
