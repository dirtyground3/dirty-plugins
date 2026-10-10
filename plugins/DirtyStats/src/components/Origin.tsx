import { PerformerCards } from "./Cards";
import { StatsState, chartImage, exportButton, refreshButton } from "./Primitives";
import {
  aggregate,
  countries,
  countryPerformers,
  mapLayout,
  originMapOption,
  performerVariables,
} from "../domain/analytics";
import { React, charts, world } from "../runtime";
import { themeColor, useChartTheme, useStatsSetting } from "../settings";
import * as chartLifecycle from "../domain/charts";
import * as dataLoader from "../domain/data";
import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
let originMapRegistered = false;
export function StatsPage(props: PageProps): R.ReactElement | null {
  const chartTheme = useChartTheme();
  const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(),
    performers = pageData.rows,
    loading = pageData.loading,
    error = pageData.error;
  const [chartError, setChartError] = React.useState("");
  const [selectedCountry, setSelectedCountry] = React.useState("");
  const queryKey = JSON.stringify(performerVariables(props.filter, 1));
  const criteriaVariables = performerVariables(props.filter, 1);
  criteriaVariables.filter.sort = "id";
  criteriaVariables.filter.direction = "ASC";
  const criteriaKey = JSON.stringify(criteriaVariables);
  const [refresh, setRefresh] = React.useState(0);
  const [labels, setLabels] = useStatsSetting("showMapNumbers");
  const chartNode = React.useRef(null),
    chartRef = React.useRef<ChartInstance | null>(null);
  const stats = React.useMemo(() => aggregate(performers, countries), [performers]);
  React.useEffect(() => {
    setSelectedCountry("");
  }, [criteriaKey]);
  pageData.useLoad(
    {
      query:
        "query DirtyStatsPerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id country}}}",
      variables: page => performerVariables(props.filter, page),
      entity: "performers",
    },
    [refresh, queryKey],
  );
  chartLifecycle.useChart(() => {
    if (loading || error || !chartNode.current) return;
    if (!charts || !world) {
      setChartError("The bundled chart or map data could not be loaded. Reload the Stash page.");
      return;
    }
    return {
      node: chartNode.current,
      chartRef,
      beforeInit: () => {
        if (!originMapRegistered) {
          charts.registerMap("dirtyStatsWorld", world);
          originMapRegistered = true;
        }
      },
      configure: chart => {
        chart.on("click", event => {
          if (event.componentType === "series" && event.name)
            setSelectedCountry(current => (current === event.name ? "" : event.name));
        });
        setChartError("");
      },
      resize: chart => {
        chart.setOption({ series: [mapLayout(chartNode.current, true)] });
      },
      onError: err => {
        setChartError(err.message);
      },
    };
  }, [loading, error]);
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const option = originMapOption(stats, world.features, {
      map: "dirtyStatsWorld",
      showLegend: true,
      showNumbers: labels,
      roam: true,
      selectable: true,
      selectedCountry,
      backgroundColor: themeColor("background"),
    });
    Object.assign(option.series[0], mapLayout(chartNode.current, true));
    chart.setOption(option);
  }, [stats, labels, loading, error, selectedCountry, chartTheme]);
  return (
    <section className="dirty-stats-content">
      <div className="dirty-stats-toolbar">
        <span className="dirty-stats-summary" role="status">
          {loading
            ? "Loading performers..."
            : stats.total +
              " performers \u00b7 " +
              stats.rows.length +
              " countries \u00b7 " +
              stats.missing +
              " missing or unrecognized country"}
        </span>
        <div className="dirty-stats-actions">
          {refreshButton(loading, () => {
            setRefresh(refresh + 1);
          })}
        </div>
      </div>
      {error ? (
        <StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load performers" />
      ) : null}
      {!loading && !error ? (
        <React.Fragment>
          {chartError ? <StatsState detail={chartError} role="alert" title="Map unavailable" /> : null}
          {!stats.total ? <StatsState title="No performers match these filters." /> : null}
          <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Performer origin world map">
            <div className="dirty-stats-map-controls">
              <label className="dirty-stats-numbers">
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={event => {
                    setLabels(event.target.checked);
                  }}
                />
                {" Show numbers"}
              </label>
              {exportButton(chartRef, "DirtyStats-performer-origin.png", Boolean(chartError))}
            </div>
            {chartImage(
              chartNode,
              "dirty-stats-chart",
              "Eckert IV world map of performer counts. Hover a country for its count.",
            )}
          </section>
          <p>Click a country to filter performers. Hover for counts; scroll to zoom and drag to pan.</p>
          <PerformerCards
            performers={countryPerformers(performers, selectedCountry)}
            country={selectedCountry}
            filter={props.filter}
            clearCountry={() => {
              setSelectedCountry("");
            }}
          />
        </React.Fragment>
      ) : null}
    </section>
  );
}
