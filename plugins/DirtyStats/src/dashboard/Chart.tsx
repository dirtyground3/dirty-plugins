import { mapLayout } from "../domain/analytics";
import { React, charts, ui, world } from "../runtime";
import { themeColor } from "../settings";
import type * as R from "react";
import { useChart } from "../domain/charts";
import type { ChartProps, StateProps } from "../props";
import type { ChartInstance, ChartOption, DashboardWidgetModel } from "../types";
let dashboardMapRegistered = false;
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
  const chartRef = React.useRef<ChartInstance | null>(null);
  const current = React.useRef(props);
  current.current = props;
  const [error, setError] = React.useState("");
  useChart(() => {
    if (!node.current || !props.option) return;
    if (!charts) {
      setError("The bundled chart library could not be loaded.");
      return;
    }
    return {
      node: node.current,
      chartRef,
      configure: () => {},
      resize: chart => {
        const latest = current.current;
        if (latest.map) chart.setOption({ series: [mapLayout(node.current, latest.option.visualMap.show)] });
      },
      onError: error => {
        setError(error.message);
      },
    };
  }, []);
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !props.option) return;
    try {
      if (props.map && charts && world && !dashboardMapRegistered) {
        charts.registerMap("dirtyStatsDashboardWorld", world);
        dashboardMapRegistered = true;
      }
      const previous = chart.getOption() || {};
      let option = props.option;
      if (option.dataZoom && previous.dataZoom)
        option = {
          ...option,
          dataZoom: option.dataZoom.map((zoom: ChartOption, index: number) => {
            const saved = previous.dataZoom[index];
            return saved ? { ...zoom, start: saved.start, end: saved.end } : zoom;
          }),
        };
      if (props.map) {
        const series = option.series[0],
          saved = previous.series?.[0];
        option = {
          ...option,
          series: [
            {
              ...series,
              ...mapLayout(node.current, option.visualMap.show),
              ...(series.roam && saved?.roam ? { center: saved.center, zoom: saved.zoom } : {}),
            },
          ],
        };
      }
      chart.setOption(option, true);
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
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
