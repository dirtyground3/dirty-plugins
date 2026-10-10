import { mapLayout } from "../domain/analytics";
import { React, charts, ui, world } from "../runtime";
import { themeColor } from "../settings";
import type * as R from "react";
import { useChart } from "../domain/charts";
import type { ChartProps, StateProps } from "../props";
import type { ChartOption, DashboardWidgetModel } from "../types";
export function State(props: StateProps): R.ReactElement | null {
  if (ui.StateView) return <ui.StateView {...props} />;
  return (
    <div className="dirty-stats-dashboard-state" role={props.role || "status"}>
      <strong>{props.title}</strong>
      {props.detail ? <p>{props.detail}</p> : null}
      {props.actions || null}
    </div>
  );
}

export function Chart(props: ChartProps): R.ReactElement | null {
  const node = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState("");
  useChart(() => {
    if (!node.current || !props.option) return;
    if (!charts) {
      setError("The bundled chart library could not be loaded.");
      return;
    }
    return {
      node: node.current,
      beforeInit: () => {
        if (props.map && world) charts.registerMap("dirtyStatsDashboardWorld", world);
      },
      configure: chart => {
        let option = props.option;
        if (props.map)
          option = Object.assign({}, option, {
            series: [Object.assign({}, option.series[0], mapLayout(node.current, option.visualMap.show))],
          });
        // Replace the complete dashboard option; full views retain their own incremental updates.
        chart.setOption(option, true);
        setError("");
      },
      resize: chart => {
        if (props.map) chart.setOption({ series: [mapLayout(node.current, props.option.visualMap.show)] });
      },
      onError: error => {
        setError(error.message);
      },
    };
  }, [props.option, props.map]);
  return (
    <React.Fragment>
      {error ? (
        <p className="dirty-stats-dashboard-chart-error" role="alert">
          {error}
        </p>
      ) : null}
      <div
        ref={node}
        className="dirty-stats-dashboard-chart"
        role="img"
        aria-label={props.label}
        aria-hidden={error ? "true" : undefined}
      />
    </React.Fragment>
  );
}

export function axes(size: string, xName: string, yName: string): ChartOption {
  const detailed = size === "large";
  const muted = themeColor("muted");
  const border = themeColor("border");
  const grid = themeColor("grid");
  return {
    grid: { left: detailed ? 14 : 6, right: 10, top: 12, bottom: detailed ? 42 : 18, containLabel: detailed },
    xAxis: {
      type: "value",
      name: detailed ? xName : "",
      nameLocation: "middle",
      nameGap: 28,
      axisLabel: { show: size !== "small", color: muted },
      axisLine: { lineStyle: { color: border } },
      splitLine: { show: size !== "small", lineStyle: { color: grid } },
    },
    yAxis: {
      type: "value",
      name: detailed ? yName : "",
      nameLocation: "middle",
      nameGap: 42,
      axisLabel: { show: size !== "small", color: muted },
      splitLine: { show: size !== "small", lineStyle: { color: grid } },
    },
  };
}

export function metric(label: string, value: string | number, detail?: string) {
  return <ui.Metric className="dirty-stats-dashboard-metric" label={label} value={value} detail={detail} />;
}

export function widgetHeader(widget: DashboardWidgetModel, ...items: R.ReactNode[]) {
  if (widget.options.showHeader === false) return null;
  return <div className="dirty-stats-dashboard-metrics">{items}</div>;
}
