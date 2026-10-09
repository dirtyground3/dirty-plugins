import type * as R from "react";
import type { DashboardDependencies } from "../dashboardView";
import { createLifecycle } from "../domain/charts";
import type { ChartProps, StateProps } from "../props";
import type { ChartOption, DashboardWidgetModel } from "../types";
export function createDashboardChart(dependencies: DashboardDependencies) {
  const { React, algorithms, charts, world, sharedReact, StateView } = dependencies;
  function State(props: StateProps): R.ReactElement | null {
    if (StateView) return (<StateView {...props} />);
    return (<div className="dirty-stats-dashboard-state" role={props.role || "status"}>
      <strong>
        {props.title}
      </strong>
      {props.detail ? (<p>
        {props.detail}
      </p>) : null}
      {props.actions || null}
    </div>);
  }

  function Chart(props: ChartProps): R.ReactElement | null {
    const node = React.useRef<HTMLDivElement>(null);
    const [error, setError] = React.useState("");
    const lifecycle = createLifecycle({
      React, init: algorithms.initStatsChart, events: window, own: dependencies.own,
      Observer: typeof ResizeObserver === "function" ? ResizeObserver : undefined
    });
    lifecycle.useChart(() => {
      if (!node.current || !props.option) return;
      if (!charts) { setError("The bundled chart library could not be loaded."); return; }
      return {
        node: node.current,
        beforeInit: () => { if (props.map && world) charts.registerMap("dirtyStatsDashboardWorld", world); },
        configure: chart => {
          let option = props.option;
          if (props.map) option = Object.assign({}, option, { series: [Object.assign({}, option.series[0], algorithms.mapLayout(node.current, option.visualMap.show))] });
          // Replace the complete dashboard option; full views retain their own incremental updates.
          chart.setOption(option, true);
          setError("");
        },
        resize: chart => { if (props.map) chart.setOption({ series: [algorithms.mapLayout(node.current, props.option.visualMap.show)] }); },
        onError: error => { setError(error.message); }
      };
    }, [props.option, props.map]);
    return (<React.Fragment>
      {error ? (<p className="dirty-stats-dashboard-chart-error" role="alert">
        {error}
      </p>) : null}
      <div
        ref={node}
        className="dirty-stats-dashboard-chart"
        role="img"
        aria-label={props.label}
        aria-hidden={error ? "true" : undefined} />
    </React.Fragment>);
  }

  function axes(size: string, xName: string, yName: string): ChartOption {
    const detailed = size === "large";
    const muted = algorithms.themeColor("muted");
    const border = algorithms.themeColor("border");
    const grid = algorithms.themeColor("grid");
    return {
      grid: { left: detailed ? 14 : 6, right: 10, top: 12, bottom: detailed ? 42 : 18, containLabel: detailed },
      xAxis: { type: "value", name: detailed ? xName : "", nameLocation: "middle", nameGap: 28, axisLabel: { show: size !== "small", color: muted }, axisLine: { lineStyle: { color: border } }, splitLine: { show: size !== "small", lineStyle: { color: grid } } },
      yAxis: { type: "value", name: detailed ? yName : "", nameLocation: "middle", nameGap: 42, axisLabel: { show: size !== "small", color: muted }, splitLine: { show: size !== "small", lineStyle: { color: grid } } }
    };
  }

  function metric(label: string, value: string | number, detail?: string) {
    return (<sharedReact.Metric className="dirty-stats-dashboard-metric" label={label} value={value} detail={detail} />);
  }

  function widgetHeader(widget: DashboardWidgetModel, ...items: R.ReactNode[]) {
    if (widget.options.showHeader === false) return null;
    return (<div className="dirty-stats-dashboard-metrics">
      {items}
    </div>);
  }
  return { State, Chart, axes, metric, widgetHeader };
}
