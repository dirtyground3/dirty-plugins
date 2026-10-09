import type * as R from "react";
import type { PageProps } from "../props";
import type { ChartInstance, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createOrigin(dependencies: ViewDependencies) {
  const { themeColor, useStatsSetting, useChartTheme, StatsState, aggregate, refreshButton, exportButton, chartImage, mapLayout, originMapOption, performerVariables, countryPerformers, PerformerCards, React, chartLifecycle, dataLoader, charts, world, countries } = dependencies;
  function StatsPage(props: PageProps): R.ReactElement | null {
    var chartTheme = useChartTheme();
    var pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), performers = pageData.rows, loading = pageData.loading, error = pageData.error;
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var countryState = React.useState(""), selectedCountry = countryState[0], setSelectedCountry = countryState[1];
    var queryKey = JSON.stringify(performerVariables(props.filter, 1));
    var criteriaVariables = performerVariables(props.filter, 1);
    criteriaVariables.filter.sort = "id"; criteriaVariables.filter.direction = "ASC";
    var criteriaKey = JSON.stringify(criteriaVariables);
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var labelState = useStatsSetting("showMapNumbers"), labels = labelState[0], setLabels = labelState[1];
    var chartNode = React.useRef(null), chartRef = React.useRef<ChartInstance | null>(null);
    var stats = React.useMemo(function () { return aggregate(performers, countries); }, [performers]);
    React.useEffect(function () { setSelectedCountry(""); }, [criteriaKey]);
    pageData.useLoad({
      query: "query DirtyStatsPerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id country}}}",
      variables: function (page) { return performerVariables(props.filter, page); },
      entity: "performers"
    }, [refresh, queryKey]);
    chartLifecycle.useChart(function () {
      if (loading || error || !chartNode.current) return;
      if (!charts || !world) { setChartError("The bundled chart or map data could not be loaded. Reload the Stash page."); return; }
      return {
        node: chartNode.current,
        chartRef: chartRef,
        beforeInit: function () {
          charts.registerMap("dirtyStatsWorld", world);
        },
        configure: function (chart) {
          chart.on("click", function (event) { if (event.componentType === "series" && event.name) setSelectedCountry(function (current) { return current === event.name ? "" : event.name; }); });
          setChartError("");
        },
        resize: function (chart) { chart.setOption({ series: [mapLayout(chartNode.current, true)] }); },
        onError: function (err) { setChartError(err.message); }
      };
    }, [loading, error, chartTheme]);
    React.useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      var option = originMapOption(stats, world.features, { map: "dirtyStatsWorld", showLegend: true, showNumbers: labels, roam: true, selectable: true, selectedCountry: selectedCountry, backgroundColor: themeColor("background") });
      Object.assign(option.series[0], mapLayout(chartNode.current, true));
      chart.setOption(option, true);
    }, [stats, labels, loading, error, selectedCountry, chartTheme]);
    return (<section className="dirty-stats-content">

      <div className="dirty-stats-toolbar">

        <span className="dirty-stats-summary" role="status">

          {loading ? "Loading performers..." : stats.total + " performers \u00b7 " + stats.rows.length + " countries \u00b7 " + stats.missing + " missing or unrecognized country"}

        </span>

        <div className="dirty-stats-actions">

          {refreshButton(loading, function () { setRefresh(refresh + 1); })}

        </div>

      </div>

      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load performers" />) : null}

      {!loading && !error ? (<React.Fragment>

        {chartError ? (<StatsState detail={chartError} role="alert" title="Map unavailable" />) : null}

        {!stats.total ? (<StatsState title="No performers match these filters." />) : null}

        <section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Performer origin world map">

          <div className="dirty-stats-map-controls">

            <label className="dirty-stats-numbers">

              <input type="checkbox" checked={labels} onChange={function (event) { setLabels(event.target.checked); }} />

              {" Show numbers"}

            </label>

            {exportButton(chartRef, "DirtyStats-performer-origin.png", Boolean(chartError))}

          </div>

          {chartImage(chartNode, "dirty-stats-chart", "Eckert IV world map of performer counts. Hover a country for its count.")}

        </section>

        <p>

          {"Click a country to filter performers. Hover for counts; scroll to zoom and drag to pan."}

        </p>

        <PerformerCards
          performers={countryPerformers(performers, selectedCountry)}
          country={selectedCountry}
          filter={props.filter}
          clearCountry={function () { setSelectedCountry(""); }} />

      </React.Fragment>) : null}

    </section>);
  }
  return { StatsPage };
}
