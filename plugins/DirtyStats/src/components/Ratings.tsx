import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createRatings(dependencies: ViewDependencies) {
  const { useStatsSetting, useChartTheme, StatsState, pageToolbar, exportButton, chartImage, sceneVariables, performerVariables, PerformerCards, SceneCards, sceneRating, aggregateRatings, React, chartLifecycle, chartOptions, dataLoader, STATS_SETTING_SPECS } = dependencies;
  function RatingPage(props: PageProps): R.ReactElement | null {
    const chartTheme = useChartTheme();
    const performerMode = Boolean(props.performerMode), entity = performerMode ? "performers" : "scenes", title = performerMode ? "Performer ratings" : "Scene ratings";
    const variables = performerMode ? performerVariables : sceneVariables;
    const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), scenes = pageData.rows, loading = pageData.loading, error = pageData.error, setError = pageData.setError;
    const [selected, setSelected] = React.useState<string | null>(null);
    const [rounding, setRounding] = useStatsSetting(performerMode ? "performerRatingRounding" : "sceneRatingRounding");
    const [refresh, setRefresh] = React.useState(0);
    const node = React.useRef<HTMLDivElement>(null), chartRef = React.useRef<ChartInstance | null>(null);
    const queryKey = JSON.stringify(variables(props.filter, 1));
    pageData.useLoad({
      query: performerMode ? "query DirtyStatsPerformerRatings($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id rating100}}}" : "query DirtyStatsRatings($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100}}}",
      variables: page => variables(props.filter, page),
      entity: entity as "performers" | "scenes",
      failureLabel: "The " + entity + " list changed while loading. Refresh to try again.",
      onStart: () => { setSelected(null); }
    }, [queryKey, refresh, performerMode]);
    const stats = React.useMemo(() => aggregateRatings(scenes, rounding), [scenes, rounding]);
    const matching = React.useMemo(() => selected == null ? scenes : scenes.filter(scene => sceneRating(scene, rounding) === selected), [scenes, selected, rounding]);
    chartLifecycle.useChart(() => {
      if (loading || error || !node.current || !stats.total) return;
      return {
        node: node.current,
        chartRef,
        configure: chart => {
          chart.setOption(chartOptions.ratingOption(stats, entity));
          chart.on("click", event => { if (event.componentType === "series") setSelected(current => current === event.name ? null : event.name); });
        },
        onError: err => { setError(err.message); }
      };
    }, [stats, loading, error, chartTheme]);
    React.useEffect(() => { if (chartRef.current) chartRef.current.setOption({ series: [{ data: stats.rows.map(row => Object.assign({}, row, { selected: row.name === selected })) }] }); }, [selected, stats, loading, error, chartTheme]);
    return (<section className="dirty-stats-content">
      {pageToolbar(loading ? "Loading " + entity + "..." : stats.total + " matching " + entity, loading, () => { setRefresh(refresh + 1); })}
      {error ? (<StatsState detail={error} role="alert" title={"Could not load " + entity} />) : null}
      {!loading && !error && !stats.total ? (<StatsState title={"No " + entity + " match these filters."} />) : null}
      {!loading && !error && stats.total ? (<section className="dirty-stats-map-panel dirty-ui-panel" aria-label={title}>
        <div className="dirty-stats-map-controls">
          {selected != null ? (<button className="btn btn-secondary dirty-ui-button" onClick={() => { setSelected(null); }}>
            Show all ratings
          </button>) : null}
          <label className="dirty-stats-date-basis">
            {"Rating rounding"}
            <select
              className="form-control dirty-ui-select dirty-stats-statistic"
              value={rounding}
              onChange={event => { setRounding(Number(event.target.value)); setSelected(null); }}>
              {STATS_SETTING_SPECS.sceneRatingRounding.options.map(value => {
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
