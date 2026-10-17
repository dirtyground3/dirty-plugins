import { PerformerCards } from "./Cards";
import { StatsState, chartImage, exportButton, pageToolbar } from "./Primitives";
import { aggregatePerformerSceneRatings, performerVariables } from "../domain/analytics";
import { performerSceneRatingOption, performerSceneRatingSeriesData } from "../domain/chartOptions";
import { useChart } from "../domain/charts";
import { PERFORMER_SCENE_RATINGS_QUERY, usePageData } from "../domain/data";
import { React } from "../runtime";
import { useChartTheme } from "../settings";
import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformerWithSceneRatings } from "../types";

export function PerformerSceneRatingsPage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = usePageData<StatsPerformerWithSceneRatings>();
  const { rows: performers, loading, error } = pageData;
  const [chartError, setChartError] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const node = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<ChartInstance | null>(null);
  const queryKey = JSON.stringify(performerVariables(props.filter, 1));
  const stats = React.useMemo(() => aggregatePerformerSceneRatings(performers), [performers]);
  React.useEffect(() => {
    setSelected(null);
  }, [queryKey, refresh]);
  pageData.useLoad(
    {
      query: PERFORMER_SCENE_RATINGS_QUERY,
      variables: page => {
        const variables = performerVariables(props.filter, page);
        return { ...variables, filter: { ...variables.filter, per_page: 100, sort: "id", direction: "ASC" } };
      },
      entity: "performers",
    },
    [queryKey, refresh],
  );
  useChart(() => {
    if (loading || error || !node.current || !stats.points.length) return;
    return {
      node: node.current,
      chartRef,
      configure: chart => {
        chart.on("click", event => {
          if (event.componentType === "series" && event.data?.id)
            setSelected(current => (current === event.data.id ? null : event.data.id));
        });
        chart.setOption(performerSceneRatingOption(stats, selected));
        setChartError("");
      },
      onError: err => setChartError(err.message),
    };
  }, [stats, loading, error, chartTheme]);
  React.useEffect(() => {
    chartRef.current?.setOption({ series: [{ data: performerSceneRatingSeriesData(stats, selected) }] });
  }, [selected, stats, loading, error, chartTheme]);
  const matching = React.useMemo(
    () => (selected == null ? stats.points : stats.points.filter(point => point.id === selected)),
    [stats, selected],
  );
  return (
    <section className="dirty-stats-content">
      {pageToolbar(
        loading ? "Loading performers..." : stats.points.length + " performers with rated scenes",
        loading,
        () => {
          setRefresh(refresh + 1);
        },
      )}
      {error ? (
        <StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load performers" />
      ) : null}
      {!loading && !error && stats.points.length ? (
        <section
          className="dirty-stats-map-panel dirty-ui-panel"
          aria-label="Performer rating versus average scene rating"
        >
          <div className="dirty-stats-map-controls">
            {selected != null ? (
              <button className="btn btn-secondary dirty-ui-button" onClick={() => setSelected(null)}>
                Show all performers
              </button>
            ) : null}
            {exportButton(chartRef, "DirtyStats-performer-vs-scene-rating.png", Boolean(chartError))}
          </div>
          {chartImage(
            node,
            "dirty-stats-growth-chart",
            "Scatter plot of performer rating versus average rating of their rated scenes, both out of ten.",
          )}
        </section>
      ) : null}
      {chartError ? <StatsState detail={chartError} role="alert" title="Chart unavailable" /> : null}
      {!loading && !error && !stats.points.length ? (
        <StatsState title="No performers with both a rating and rated scenes match these filters." />
      ) : null}
      <p>
        Each dot is a distinct performer: performer rating on the x-axis and the average rating of their scenes on the
        y-axis, both out of ten. The average includes all rated scenes featuring that performer; unrated scenes are
        excluded. The dotted diagonal marks equal ratings: performers above it have a higher scene average than their
        own rating; performers below it have a lower scene average. Click a dot to show that performer below, or click
        it again to clear the selection.
      </p>
      {!loading && !error && (stats.missingRating || stats.missingScenes) ? (
        <p role="status">
          {stats.missingRating +
            " performers without a rating and " +
            stats.missingScenes +
            " without rated scenes were omitted."}
        </p>
      ) : null}
      {!loading && !error ? (
        <PerformerCards
          performers={matching}
          filter={props.filter}
          title={selected == null ? "Performers" : "Selected performer"}
          selection={selected}
          clearSelection={() => setSelected(null)}
          clearLabel="Show all performers"
        />
      ) : null}
    </section>
  );
}
