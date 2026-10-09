import type { ChartInstance, StatsChartDependencies, StatsChartDescriptor, StatsDataDependencies } from "../types";


/**
 * Native ECharts events belong to the chart and are released by dispose().
 * The adapter owns browser listeners, observers and the export reference.
 * @param {StatsChartDescriptor} descriptor
 * @param {StatsChartDependencies} dependencies
 */
export function mountChart(descriptor: StatsChartDescriptor, dependencies: StatsChartDependencies) {
  let chart: ChartInstance | null = null, observer: ResizeObserver | null = null, disposed = false;
  let unown: (() => void) | undefined;
  function resize() {
    if (!chart || chart.isDisposed()) return;
    chart.resize();
    if (descriptor.resize) descriptor.resize(chart);
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    unown?.();
    if (observer) observer.disconnect();
    dependencies.events.removeEventListener("resize", resize);
    try {
      if (chart && descriptor.beforeDispose) descriptor.beforeDispose(chart);
    } finally {
      try { if (chart) chart.dispose(); }
      finally { if (descriptor.chartRef) descriptor.chartRef.current = null; }
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
  if (!disposed) unown = dependencies.own?.(cleanup);
  return cleanup;
}


/** @param {StatsChartDependencies & {React: StatsDataDependencies['React']}} dependencies */
export function createLifecycle(dependencies: StatsChartDependencies & { React: StatsDataDependencies['React'] }) {
  /** @param {() => StatsChartDescriptor | undefined} describe @param {unknown[]} keys */
  function useChart(describe: () => StatsChartDescriptor | undefined, keys: unknown[]) {
    dependencies.React.useEffect(() => {
      const descriptor = describe();
      if (descriptor) return mountChart(descriptor, dependencies);
    }, keys);
  }
  return { useChart };
}
