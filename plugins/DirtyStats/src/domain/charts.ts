import { charts, React } from "../runtime";
import { themeColor } from "../settings";
import type { ChartInstance, ChartOption, StatsChartDependencies, StatsChartDescriptor } from "../types";

/**
 * Native ECharts events belong to the chart and are released by dispose().
 * The adapter owns browser listeners, observers and the export reference.
 * @param {StatsChartDescriptor} descriptor
 * @param {StatsChartDependencies} dependencies
 */
export function mountChart(descriptor: StatsChartDescriptor, dependencies: StatsChartDependencies) {
  let chart: ChartInstance | null = null,
    observer: ResizeObserver | null = null,
    disposed = false;
  function resize() {
    if (!chart || chart.isDisposed()) return;
    chart.resize();
    if (descriptor.resize) descriptor.resize(chart);
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    if (observer) observer.disconnect();
    dependencies.events.removeEventListener("resize", resize);
    try {
      if (chart && descriptor.beforeDispose) descriptor.beforeDispose(chart);
    } finally {
      try {
        if (chart) chart.dispose();
      } finally {
        if (descriptor.chartRef) descriptor.chartRef.current = null;
      }
    }
  }
  try {
    if (descriptor.beforeInit) descriptor.beforeInit();
    chart = dependencies.init(descriptor.node, { renderer: "canvas" });
    if (descriptor.chartRef) descriptor.chartRef.current = chart;
    descriptor.configure(chart);
    if (dependencies.Observer) {
      observer = new dependencies.Observer(resize);
      observer.observe(descriptor.node);
    }
    dependencies.events.addEventListener("resize", resize);
  } catch (error) {
    cleanup();
    // Keep the original host error, including errors from another JS realm.
    descriptor.onError(error as Error);
  }
  return cleanup;
}

/** ECharts with reduced motion honored and exports on the current theme background. */
export function initStatsChart(node: HTMLElement, options?: ChartOption) {
  if (!charts) throw new Error("The chart library is not loaded. Reload the Stash page.");
  const chart = charts.init(node, null, options || { renderer: "canvas" }),
    setOption = chart.setOption.bind(chart),
    getDataURL = chart.getDataURL.bind(chart);
  chart.setOption = (option, replace) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) option.animation = false;
    setOption(option, replace);
  };
  chart.getDataURL = options => getDataURL({ ...options, backgroundColor: themeColor("background") });
  return chart;
}

/** @param {() => StatsChartDescriptor | undefined} describe @param {unknown[]} keys */
export function useChart(describe: () => StatsChartDescriptor | undefined, keys: unknown[]) {
  React.useEffect(() => {
    const descriptor = describe();
    if (descriptor)
      return mountChart(descriptor, {
        init: initStatsChart,
        events: window,
        Observer: typeof ResizeObserver === "function" ? ResizeObserver : undefined,
      });
  }, keys);
}
