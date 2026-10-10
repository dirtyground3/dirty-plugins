import { PerformerCards } from "./Cards";
import { useAgePerformerFilter } from "./Filters";
import { StatsState, chartImage, exportButton, pageToolbar } from "./Primitives";
import { aggregateAges, performersAtAge } from "../domain/ages";
import { filterAgeScenes, performerVariables, sceneVariables } from "../domain/analytics";
import { React } from "../runtime";
import { themeColor, useChartTheme } from "../settings";
import * as chartLifecycle from "../domain/charts";
import * as chartOptions from "../domain/chartOptions";
import * as dataLoader from "../domain/data";
import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
export function AgePage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(),
    scenes = pageData.rows,
    sceneLoading = pageData.loading,
    error = pageData.error;
  const [chartError, setChartError] = React.useState("");
  const [refresh, setRefresh] = React.useState(0);
  const node = React.useRef<HTMLDivElement>(null),
    chartRef = React.useRef<ChartInstance | null>(null);
  const queryKey = JSON.stringify(sceneVariables(props.filter, 1));
  const performerModel = useAgePerformerFilter();
  const [matchingIds, setMatchingIds] = React.useState<string[] | null>(null);
  const [matchingLoading, setMatchingLoading] = React.useState(false);
  const [matchingError, setMatchingError] = React.useState("");
  const performerKey = JSON.stringify(performerModel ? performerVariables(performerModel!, 1) : null);
  const loading = sceneLoading || matchingLoading;
  dataLoader.usePageLoad<StatsPerformer>(
    {
      query:
        "query DirtyStatsAgePerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id}}}",
      variables: page => {
        const variables = performerVariables(performerModel!, page);
        variables.filter.sort = "id";
        variables.filter.direction = "ASC";
        return variables;
      },
      collection: response => {
        const batch = response.findPerformers;
        return { count: batch!.count, rows: batch!.performers };
      },
      failureLabel: "The performer list changed while loading. Try Refresh.",
      enabled: Boolean(performerModel),
      onDisabled: () => {
        setMatchingIds(null);
      },
      onError: () => {
        setMatchingIds([]);
      },
      setLoading: setMatchingLoading,
      setError: setMatchingError,
      publish: result => {
        setMatchingIds(result.map(performer => performer.id));
      },
    },
    [performerKey, refresh],
  );
  const matchingScenes = React.useMemo(() => filterAgeScenes(scenes, matchingIds), [scenes, matchingIds]);
  const [selectedAge, setSelectedAge] = React.useState<number | null>(null);
  React.useEffect(() => {
    setSelectedAge(null);
  }, [queryKey, performerKey]);
  const selectedPerformers = React.useMemo(
    () => performersAtAge(matchingScenes, selectedAge),
    [matchingScenes, selectedAge],
  );
  const stats = React.useMemo(() => aggregateAges(matchingScenes), [matchingScenes]);
  pageData.useLoad(
    {
      query:
        "query DirtyStatsAges($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id date performers{id birthdate}}}}",
      variables: page => sceneVariables(props.filter, page),
      entity: "scenes",
    },
    [queryKey, refresh],
  );
  chartLifecycle.useChart(() => {
    if (loading || error || !node.current) return;
    return {
      node: node.current,
      chartRef,
      configure: chart => {
        chart.on("click", event => {
          if (event.componentType === "series" && Number.isFinite(Number(event.name)))
            setSelectedAge(Number(event.name));
        });
        chart.setOption(chartOptions.ageOption(stats));
        setChartError("");
      },
      onError: err => {
        setChartError(err.message);
      },
    };
  }, [stats, loading, error, chartTheme]);
  React.useEffect(() => {
    if (chartRef.current)
      chartRef.current.setOption({
        series: [
          {
            data: stats.rows.map(row => ({
              value: row.count,
              itemStyle: { color: selectedAge === row.age ? themeColor("accent") : themeColor("primary") },
            })),
          },
        ],
      });
  }, [selectedAge, stats, loading, error, chartTheme]);
  return (
    <section className="dirty-stats-content">
      {pageToolbar(
        loading
          ? "Loading scene ages..."
          : stats.performers + " distinct performers across " + stats.scenes + " matching scenes",
        loading,
        () => {
          setRefresh(refresh + 1);
        },
      )}
      {matchingError ? (
        <StatsState detail={"Performer filters: " + matchingError} role="alert" title="Performer filter error" />
      ) : null}
      {error ? <StatsState detail={error} role="alert" title="Could not load scene ages" /> : null}
      <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Performer age histogram">
        <div className="dirty-stats-map-controls">
          {exportButton(chartRef, "DirtyStats-age-at-scene.png", loading || Boolean(error) || Boolean(chartError))}
        </div>
        {!loading && !error
          ? chartImage(
              node,
              "dirty-stats-growth-chart dirty-stats-age-chart",
              "Histogram of age in completed years at scene date versus distinct performer count.",
            )
          : null}
      </section>
      {chartError ? <StatsState detail={chartError} role="alert" title="Chart unavailable" /> : null}
      {!loading && !error && !stats.rows.length ? (
        <StatsState title="No performers with valid birthdates and scene dates match these filters." />
      ) : null}
      <p>
        Click an age bar to show its performers below. Each bar counts distinct performers at that age on matching scene
        dates. Repeated scenes at the same age count once; a performer may appear in several age bars.
      </p>
      {!loading && !error && (stats.missingSceneDates || stats.missingBirthdates) ? (
        <p role="status">
          {stats.missingSceneDates +
            " scenes without valid full dates and " +
            stats.missingBirthdates +
            " performer appearances without usable birthdates were excluded."}
        </p>
      ) : null}
      {!loading && !error ? (
        <PerformerCards
          performers={selectedPerformers}
          title={selectedAge == null ? "Performers" : "Performers aged " + selectedAge}
          selection={selectedAge}
          clearSelection={() => {
            setSelectedAge(null);
          }}
          clearLabel="Show all ages"
        />
      ) : null}
    </section>
  );
}
