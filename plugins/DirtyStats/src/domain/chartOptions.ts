import type { ChartEvent, StatsChartOptionDependencies, StatsConstellationLink, StatsConstellationNode, StatsCountRatingPoint, StatsQualityPoint, StatsRepeatRow, StatsScatterPoint, StatsStudioPoint, StatsTagDatum } from "../types";

/** @param {StatsChartOptionDependencies} dependencies */
export function createBuilders(dependencies: StatsChartOptionDependencies) {
  const {
    themeColor, formatBytes, constellationLayout, scatterSeriesData, scatterGuideLines, countRatingLabel, countRatingSeriesData,
    repeatOffenderSeriesData, qualityEfficiencySeriesData, studioSeriesData,
  } = dependencies;
  /** @param {{nodes: StatsConstellationNode[], links: StatsConstellationLink[]}} stats */
  function constellationOption(stats: { nodes: StatsConstellationNode[], links: StatsConstellationLink[] }) {
    const largest = Math.max.apply(null, stats.nodes.map(item => item.value));
    const layout = constellationLayout(stats.nodes.length);
    const categoryMap = new Map();
    stats.nodes.forEach(item => { if (!categoryMap.has(item.gender)) categoryMap.set(item.gender, { name: item.genderLabel, itemStyle: { color: item.genderColor } }); });
    const categories = Array.from(categoryMap.values()), categoryIndexes = new Map(Array.from(categoryMap.keys()).map((key, index) => [key, index]));
    return {
      backgroundColor: themeColor("background"), legend: { type: "scroll", top: 8, left: 10, right: 10, selectedMode: false, data: categories.map(category => category.name), textStyle: { color: themeColor("text"), fontSize: 10 }, itemWidth: 11, itemHeight: 11, pageTextStyle: { color: themeColor("text") } }, tooltip: {
        trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => {
          if (p.dataType === "edge") return p.data.sourceName + " + " + p.data.targetName + "\n" + p.data.value + " shared scene" + (p.data.value === 1 ? "" : "s");
          return p.data.name + "\n" + p.data.genderLabel + "\n" + p.data.value + " matching scene" + (p.data.value === 1 ? "" : "s") + "\n" + p.data.collaborators + " displayed collaborator" + (p.data.collaborators === 1 ? "" : "s");
        }
      }, series: [{ type: "graph", layout: "force", top: 40, left: 12, right: 12, bottom: 12, zoom: layout.zoom, roam: true, draggable: true, selectedMode: "single", categories, data: stats.nodes.map((item, index) => Object.assign({}, item, { category: categoryIndexes.get(item.gender), symbolSize: layout.symbolMin + layout.symbolRange * Math.sqrt(item.value / largest), itemStyle: { borderColor: "#d8fffb", borderWidth: 1 }, label: { show: index < layout.labelLimit } })), links: stats.links.map(link => Object.assign({}, link, { lineStyle: { width: 1 + Math.log(link.value) / Math.log(2), opacity: layout.edgeOpacity + Math.min(.42, link.value / 22), color: themeColor("secondary"), curveness: .06 } })), force: { initLayout: "circular", repulsion: layout.repulsion, gravity: layout.gravity, edgeLength: layout.edgeLength, friction: .6, layoutAnimation: true }, label: { position: "right", color: themeColor("text"), fontSize: 11, formatter: "{b}" }, emphasis: { focus: "adjacency", label: { show: true }, itemStyle: { borderColor: "#fff", borderWidth: 2 }, lineStyle: { opacity: .9, color: themeColor("accent") } } }]
    };
  }

  /** @param {{included: number, points: number[][]}} stats @param {string} grouping */
  function growthOption(stats: { included: number, points: number[][] }, grouping: string) {
    return {
      backgroundColor: themeColor("background"), useUTC: true, grid: { left: 12, right: 20, top: 22, bottom: 60, containLabel: true },
      tooltip: { trigger: "axis", renderMode: "richText", formatter: (items: ChartEvent[]) => items.map(item => { const point = item.value; return new Date(point[0]).toISOString().slice(0, item.seriesName === "Forecast" ? 10 : grouping === "year" ? 4 : grouping === "month" ? 7 : 10) + " (UTC)\n" + formatBytes(point[1]) + (item.seriesName === "Forecast" ? " forecast" : " cumulative"); }).join("\n") },
      xAxis: { type: "time", axisLabel: { color: themeColor("muted"), hideOverlap: true }, axisLine: { lineStyle: { color: themeColor("border") } } },
      yAxis: { type: "value", min: 0, axisLabel: { color: themeColor("muted"), formatter: formatBytes }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      dataZoom: [{ type: "inside" }, { type: "slider", bottom: 8, height: 18, borderColor: themeColor("secondary"), textStyle: { color: themeColor("muted") } }],
      series: [{ name: "Cumulative size", type: "line", step: "end", showSymbol: stats.included === 1, lineStyle: { color: themeColor("primary"), width: 2 }, itemStyle: { color: themeColor("primary") }, areaStyle: { color: themeColor("primary"), opacity: .15 }, data: stats.points }]
    };
  }

  /** @param {{rows: Array<{age: number, count: number}>}} stats */
  function ageOption(stats: { rows: Array<{ age: number, count: number }> }) {
    return {
      backgroundColor: themeColor("background"), grid: { left: 48, right: 20, top: 22, bottom: 55, containLabel: true },
      tooltip: { trigger: "axis", renderMode: "richText", axisPointer: { type: "shadow" }, formatter: (items: ChartEvent[]) => "Age " + items[0].name + " years\n" + items[0].value + " distinct performers" },
      xAxis: { type: "category", name: "Age (years)", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: themeColor("muted") }, data: stats.rows.map(row => String(row.age)), axisLabel: { color: themeColor("muted"), hideOverlap: true }, axisLine: { lineStyle: { color: themeColor("border") } } },
      yAxis: { type: "value", name: "Distinct performers", nameLocation: "middle", nameGap: 35, min: 0, minInterval: 1, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      dataZoom: [{ type: "inside" }],
      series: [{ name: "Distinct performers", type: "bar", barCategoryGap: "5%", itemStyle: { color: themeColor("primary") }, data: stats.rows.map(row => row.count) }]
    };
  }

  /** @param {{rows: Array<{name: string, value: number}>}} stats @param {string} entity */
  function ratingOption(stats: { rows: Array<{ name: string, value: number }> }, entity: string) {
    return {
      backgroundColor: themeColor("background"), tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => (p.name === "Unrated" ? p.name : "Rating " + p.name + "/10") + "\n" + p.value + " " + entity + " (" + p.percent + "%)" },
      legend: { type: "scroll", bottom: 8, textStyle: { color: themeColor("text"), fontSize: 11 }, itemWidth: 12, itemHeight: 12, pageTextStyle: { color: themeColor("text") } },
      series: [{ type: "pie", radius: [0, "72%"], center: ["50%", "46%"], selectedMode: "single", label: { show: false }, labelLine: { show: false }, itemStyle: { borderColor: themeColor("background"), borderWidth: 2 }, data: stats.rows }]
    };
  }

  /** @param {{points: StatsScatterPoint[]}} stats @param {string | null} selected @param {number} maxScenes @param {number} minRating */
  function scatterOption(stats: { points: StatsScatterPoint[] }, selected: string | null, maxScenes: number, minRating: number) {
    return {
      backgroundColor: themeColor("background"), grid: { left: 12, right: 24, top: 22, bottom: 60, containLabel: true },
      tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => p.data.name + "\nRating " + p.value[0] + "/10\n" + p.value[1] + " scene" + (p.value[1] === 1 ? "" : "s") },
      xAxis: { type: "value", name: "Rating (out of 10)", nameLocation: "middle", nameGap: 28, min: 0, max: 10, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, axisLine: { lineStyle: { color: themeColor("border") } }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      yAxis: { type: "value", name: "Scenes", nameLocation: "middle", nameGap: 45, min: 0, minInterval: 1, max: (value: { max: number }) => maxScenes > 0 ? Math.max(value.max, maxScenes) : value.max, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      series: [{
        type: "scatter", symbolSize: 9, progressive: 4000, data: scatterSeriesData(stats, selected),
        markLine: {
          silent: true, symbol: "none", label: { color: themeColor("text"), fontSize: 10 }, lineStyle: { color: themeColor("accent"), type: "dashed" }, data: scatterGuideLines(minRating, maxScenes).filter(guide => guide.active).map(guide => guide.axis === "x" ? { xAxis: guide.value, label: { formatter: "Rating " + guide.value + "+" } } : { yAxis: guide.value, label: { formatter: guide.value + " scenes" } })
        }
      }]
    };
  }

  /** @param {{points: StatsCountRatingPoint[]}} stats @param {string} metric @param {string | null} selected */
  function countRatingOption(stats: { points: StatsCountRatingPoint[] }, metric: string, selected: string | null) {
    return {
      backgroundColor: themeColor("background"), grid: { left: 12, right: 24, top: 22, bottom: 60, containLabel: true },
      tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => p.data.title + "\nScene rating " + p.value[0] + "/10\n" + p.value[1] + " " + countRatingLabel(metric).toLowerCase() },
      xAxis: { type: "value", name: "Scene rating (out of 10)", nameLocation: "middle", nameGap: 28, min: 0, max: 10, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, axisLine: { lineStyle: { color: themeColor("border") } }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      yAxis: { type: "value", name: countRatingLabel(metric), nameLocation: "middle", nameGap: 45, min: 0, minInterval: 1, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      series: [{ type: "scatter", symbolSize: 9, progressive: 4000, data: countRatingSeriesData(stats, selected), emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 2 } } }]
    };
  }

  /** @param {{rows: StatsRepeatRow[], totalScenes: number}} stats @param {string | null} selected */
  function repeatOffenderOption(stats: { rows: StatsRepeatRow[], totalScenes: number }, selected: string | null) {
    return {
      backgroundColor: themeColor("background"), grid: { left: 18, right: 28, top: 24, bottom: 68, containLabel: true },
      tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => { if (!p.data || !p.data.id) return p.seriesName; return p.data.title + "\nRank " + p.data.rank + " of " + stats.totalScenes + "\n" + p.data.views + " recorded view" + (p.data.views === 1 ? "" : "s") + "\nTop " + p.value[0].toFixed(1) + "% account for " + p.value[1].toFixed(1) + "% of views"; } },
      xAxis: { type: "value", name: "Scenes, ranked by views (%)", nameLocation: "middle", nameGap: 32, min: 0, max: 100, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted"), formatter: "{value}%" }, axisLine: { lineStyle: { color: themeColor("border") } }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      yAxis: { type: "value", name: "Cumulative share of views", nameLocation: "middle", nameGap: 48, min: 0, max: 100, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted"), formatter: "{value}%" }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      dataZoom: [{ type: "inside", xAxisIndex: 0 }, { type: "slider", xAxisIndex: 0, bottom: 8, height: 18 }],
      series: [{ name: "Cumulative views", type: "line", showSymbol: stats.totalScenes <= 200, symbolSize: 5, sampling: "lttb", lineStyle: { color: themeColor("primary"), width: 3 }, itemStyle: { color: themeColor("primary") }, areaStyle: { color: themeColor("primary"), opacity: .16 }, data: repeatOffenderSeriesData(stats, selected), markArea: { silent: true, label: { show: true, color: themeColor("text"), formatter: "Top 5%" }, itemStyle: { color: themeColor("accent"), opacity: .10 }, data: [[{ xAxis: 0 }, { xAxis: 5 }]] } }, { name: "Equal distribution", type: "line", showSymbol: false, silent: true, lineStyle: { color: themeColor("border"), type: "dashed", width: 1 }, data: [[0, 0], [100, 100]] }]
    };
  }

  /** @param {{points: StatsQualityPoint[]}} stats @param {(params: any) => string} tooltip */
  function qualityEfficiencyOption(stats: { points: StatsQualityPoint[] }, tooltip: (params: any) => string) {
    return {
      backgroundColor: themeColor("background"), grid: { left: 12, right: 24, top: 22, bottom: 60, containLabel: true },
      tooltip: { trigger: "item", renderMode: "richText", formatter: tooltip },
      xAxis: { type: "value", name: "Storage efficiency (playable minutes per GiB)", nameLocation: "middle", nameGap: 32, min: 0, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, axisLine: { lineStyle: { color: themeColor("border") } }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      yAxis: { type: "value", name: "Scene rating (out of 10)", nameLocation: "middle", nameGap: 45, min: 0, max: 10, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      series: [{ name: "Scenes", type: "scatter", progressive: 4000, data: qualityEfficiencySeriesData(stats) }]
    };
  }

  /** @param {StatsStudioPoint[]} points @param {number} maxBytes @param {string | null} selected */
  function studioOption(points: StatsStudioPoint[], maxBytes: number, selected: string | null) {
    return {
      backgroundColor: themeColor("background"), grid: { left: 12, right: 24, top: 22, bottom: 60, containLabel: true },
      tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => p.data.name + "\n" + p.value[0] + " scene" + (p.value[0] === 1 ? "" : "s") + "\nAverage rating " + p.value[1].toFixed(1) + "/10\n" + formatBytes(p.data.bytes) + (p.data.unrated ? "\n" + p.data.unrated + " unrated" : "") },
      xAxis: { type: "value", name: "Scenes", nameLocation: "middle", nameGap: 28, min: 0, minInterval: 1, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, axisLine: { lineStyle: { color: themeColor("border") } }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      yAxis: { type: "value", name: "Average rating (out of 10)", nameLocation: "middle", nameGap: 45, min: 0, max: 10, nameTextStyle: { color: themeColor("muted") }, axisLabel: { color: themeColor("muted") }, splitLine: { lineStyle: { color: themeColor("grid") } } },
      series: [{ type: "scatter", data: studioSeriesData(points, maxBytes, selected), emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 2 } } }]
    };
  }

  /** @param {StatsTagDatum[]} data @param {string} metric */
  function tagDnaOption(data: StatsTagDatum[], metric: string) {
    return {
      backgroundColor: themeColor("background"), tooltip: {
        trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => {
          const line = metric === "play_count" ? "Views per scene " + p.data.playsPerScene.toFixed(1) + "\n" + p.data.plays + " total views" : p.data.rating == null ? "No rated scenes" : "Average rating " + p.data.rating.toFixed(1) + "/10\n" + p.data.rated + " rated" + (p.data.unrated ? ", " + p.data.unrated + " unrated" : "");
          return p.data.name + "\n" + p.data.value + " scene" + (p.data.value === 1 ? "" : "s") + "\n" + line;
        }
      }, series: [{ type: "treemap", roam: true, nodeClick: false, breadcrumb: { show: false }, top: 4, right: 4, bottom: 4, left: 4, squareRatio: 1.1, visualMin: 0, label: { show: true, color: "#fff", textBorderColor: "rgba(0,0,0,.5)", textBorderWidth: 2, overflow: "truncate", formatter: (p: ChartEvent) => p.name + "\n" + p.value }, emphasis: { label: { show: true }, itemStyle: { borderColor: "#fff", borderWidth: 3 } }, data }]
    };
  }
  return {
    constellationOption,
    growthOption,
    ageOption,
    ratingOption,
    scatterOption,
    countRatingOption,
    repeatOffenderOption,
    qualityEfficiencyOption,
    studioOption,
    tagDnaOption
  };
}