/*! DirtyStats bundles parts of Apache ECharts 5.6.0 (Apache-2.0, with d3-derived
 * layout code under BSD-3-Clause), ZRender 5.6.1 (BSD-3-Clause) and tslib 2.3.0
 * (0BSD). See vendor/ECHARTS-LICENSE, vendor/ECHARTS-NOTICE,
 * vendor/ECHARTS-LICENSE-d3, vendor/ZRENDER-LICENSE and vendor/TSLIB-LICENSE. */
import { init, registerMap, use } from "echarts/core";
import { BarChart, GraphChart, LineChart, MapChart, PieChart, ScatterChart, TreemapChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartEngine } from "./runtime";

// Compiled as its own file (assets/dirtyStatsCharts.js) that runtime.loadCharts() imports
// when a Stats page opens, so other Stash pages never load the chart library or the map.
// Only the series, components and renderer the Stats views configure. This
// registers into the bundle's private ECharts registry; it touches no host API.
use([
  BarChart,
  GraphChart,
  LineChart,
  MapChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
  CanvasRenderer,
]);

export const charts = { init, registerMap } as unknown as ChartEngine;
export { default as world } from "../vendor/world.js";
