import type * as R from "react";
import type { DashboardDependencies } from "../dashboardView";
import type { BirthdayEntry, Capacity, ChartEvent, ChartOption, DashboardWidgetModel, ResourceState, StatsPerformer, StatsScene } from "../types";
type StatsEntity = StatsScene & StatsPerformer;
export function createDashboardCharts(dependencies: DashboardDependencies) {
  const { resourceKey, State, Chart, axes, metric, widgetHeader, PerformerCardWidget, React, algorithms, world, WIDGETS } = dependencies;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function ratingWidget(items: StatsEntity[], widget: DashboardWidgetModel, entity: string): R.ReactElement | null {
    const stats = algorithms.aggregateRatings(items, widget.options.rounding);
    const rated = stats.rows.filter(row => row.name !== "Unrated").reduce((sum, row) => sum + row.value, 0);
    const data = stats.rows.map(row => ({ name: row.name === "Unrated" ? "Unrated" : row.name + "/10", value: row.value }));
    const option: ChartOption = { backgroundColor: "transparent", color: algorithms.themePalette(), tooltip: { trigger: "item", renderMode: "richText" }, legend: { show: widget.size === "large", type: "scroll", bottom: 0, textStyle: { color: algorithms.themeColor("text") } }, series: [{ type: "pie", radius: widget.size === "small" ? ["58%", "82%"] : ["34%", "70%"], center: ["50%", widget.size === "large" ? "43%" : "50%"], label: { show: widget.size !== "small", color: algorithms.themeColor("text"), formatter: widget.size === "large" ? "{b}: {c}" : "{b}" }, data }] };
    return (<React.Fragment>
      {widgetHeader(widget, metric(entity + "s", stats.total), metric("rated", stats.total ? Math.round(rated * 100 / stats.total) + "%" : "0%"))}
      {stats.total ? (<Chart option={option} label={entity + " rating distribution"} />) : (<State title={"No " + entity + "s"} detail="The library has no data for this statistic." />)}
    </React.Fragment>);
  }

  function originWidget(performers: StatsPerformer[], widget: DashboardWidgetModel): R.ReactElement | null {
    const countries = algorithms.countryIndex(world ? world.features : []);
    const stats = algorithms.aggregate(performers, countries);
    if (!world) return (<State
      title="World map unavailable"
      detail="The bundled map data could not be loaded. Reload the Stash page."
      role="alert" />);
    const option: ChartOption = algorithms.originMapOption(stats, world.features, { map: "dirtyStatsDashboardWorld", showLegend: widget.size === "large", showNumbers: widget.size === "large" && widget.options.showNumbers, roam: widget.size === "large" });
    return (<React.Fragment>
      {widget.size !== "small" ? widgetHeader(widget, metric("performers", stats.total), metric("countries", stats.rows.length), metric("top country", stats.rows.length ? stats.rows[0].name : "—")) : null}
      <Chart option={option} map={true} label="Performer origin world map. Hover a country for its exact count." />
    </React.Fragment>);
  }

  function growthWidget(scenes: StatsScene[], capacity: Capacity | null, widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateGrowth(scenes, null, widget.options.dateBasis, widget.options.grouping);
    const daily = algorithms.aggregateGrowth(scenes, null, widget.options.dateBasis, "day");
    const forecast = algorithms.forecastGrowth(daily, capacity && capacity.total);
    const option: ChartOption = { backgroundColor: "transparent", useUTC: true, grid: { left: 8, right: 14, top: 12, bottom: widget.size === "large" ? 45 : 20, containLabel: widget.size !== "small" }, tooltip: { trigger: "axis", renderMode: "richText" }, xAxis: { type: "time", axisLabel: { show: widget.size !== "small", color: algorithms.themeColor("muted"), hideOverlap: true }, axisLine: { lineStyle: { color: algorithms.themeColor("border") } } }, yAxis: { type: "value", min: 0, axisLabel: { show: widget.size !== "small", color: algorithms.themeColor("muted"), formatter: algorithms.formatBytes }, splitLine: { show: widget.size !== "small", lineStyle: { color: algorithms.themeColor("grid") } } }, dataZoom: widget.size === "large" ? [{ type: "inside" }, { type: "slider", bottom: 5, height: 16 }] : [], series: [{ type: "line", step: "end", showSymbol: false, lineStyle: { color: algorithms.themeColor("primary"), width: 2 }, areaStyle: { color: algorithms.themeColor("primary"), opacity: .15 }, data: stats.points, markLine: { silent: true, symbol: "none", data: widget.options.showCapacity && capacity && capacity.total > 0 ? [{ yAxis: capacity.total, label: { color: algorithms.themeColor("text"), formatter: "Capacity " + algorithms.formatBytes(capacity.total) }, lineStyle: { color: algorithms.themeColor("muted"), type: "dashed" } }] : [] } }] };
    if (widget.options.showForecast && forecast.points) option.series.push({ name: "Forecast", type: "line", showSymbol: false, lineStyle: { color: algorithms.themeColor("accent"), type: "dashed", width: 2 }, data: forecast.points });
    return (<React.Fragment>
      {widgetHeader(widget, metric("library size", algorithms.formatBytes(stats.bytes)), metric("included scenes", stats.included), widget.size === "large" && widget.options.showForecast && forecast.reachedAt ? metric("capacity estimate", new Date(forecast.reachedAt).toISOString().slice(0, 10)) : stats.excluded ? metric("excluded", stats.excluded) : null)}
      {stats.points.length ? (<Chart option={option} label="Cumulative content growth" />) : (<State title="No dated content" detail="No files have usable dates and sizes." />)}
    </React.Fragment>);
  }

  function ageWidget(scenes: StatsScene[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateAges(scenes);
    const summary = [];
    if (widget.options.showPerformerCount) summary.push(metric("performers", stats.performers));
    if (widget.options.showModeAge) summary.push(metric("mode age", stats.modeAge == null ? "—" : stats.modeAge, stats.modeCount ? stats.modeCount + " performers" : ""));
    if (widget.options.showMedianAge) summary.push(metric("median age", stats.medianAge == null ? "—" : Number(stats.medianAge.toFixed(1))));
    if (widget.options.showAverageAge) summary.push(metric("average age", stats.averageAge == null ? "—" : Number(stats.averageAge.toFixed(1))));
    if (widget.size === "large") summary.push(metric("scenes", stats.scenes));
    const option: ChartOption = { backgroundColor: "transparent", grid: { left: 8, right: 8, top: 8, bottom: widget.size === "large" ? 38 : 18, containLabel: widget.size !== "small" }, tooltip: { trigger: "axis", renderMode: "richText" }, xAxis: { type: "category", name: widget.size === "large" ? "Age" : "", data: stats.rows.map(row => row.age), axisLabel: { show: widget.size !== "small", color: algorithms.themeColor("muted"), interval: "auto" }, axisLine: { lineStyle: { color: algorithms.themeColor("border") } } }, yAxis: { type: "value", name: widget.size === "large" ? "Performers" : "", minInterval: 1, axisLabel: { show: widget.size !== "small", color: algorithms.themeColor("muted") }, splitLine: { show: widget.size !== "small", lineStyle: { color: algorithms.themeColor("grid") } } }, dataZoom: widget.size === "large" ? [{ type: "inside" }] : [], series: [{ type: "bar", data: stats.rows.map(row => row.count), itemStyle: { color: algorithms.themeColor("primary") } }] };
    return (<React.Fragment>
      {summary.length ? widgetHeader(widget, ...summary) : null}
      {stats.rows.length ? (<Chart option={option} label="Performer ages at scene date" />) : (<State title="No age data" detail="Scene dates and full performer birthdates are required." />)}
    </React.Fragment>);
  }

  function scatterWidget(points: ChartOption[], widget: DashboardWidgetModel, names: string[], highlighted: number | null): R.ReactElement | null {
    const chartAxes = axes(widget.size, names[0], names[1]);
    const option: ChartOption = { backgroundColor: "transparent", grid: chartAxes.grid, xAxis: chartAxes.xAxis, yAxis: chartAxes.yAxis, tooltip: { trigger: "item", renderMode: "richText" }, series: [{ type: "scatter", symbolSize: widget.size === "small" ? 5 : 8, progressive: 4000, data: points, itemStyle: { color: algorithms.themeColor("primary"), opacity: .75 } }] };
    return (<React.Fragment>
      {widgetHeader(widget, metric("points", points.length), highlighted != null ? metric("highlighted", highlighted) : null)}
      {points.length ? (<Chart option={option} label={names[0] + " versus " + names[1]} />) : (<State title="No rated data" detail="No matching records contain the required values." />)}
    </React.Fragment>);
  }

  function performerScatterWidget(performers: StatsPerformer[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateScatter(performers, widget.options.minRating, widget.options.maxScenes);
    const points = stats.points.map(point => ({ name: point.name, value: [point.rating, point.scenes], itemStyle: { color: point.highlight ? algorithms.themeColor("accent") : algorithms.themeColor("primary") } }));
    return scatterWidget(points, widget, ["Rating", "Scenes"], stats.highlights);
  }

  function countRatingWidget(scenes: StatsScene[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateCountRating(scenes, widget.options.metric);
    const points = stats.points.map(point => ({ name: point.title, value: [point.rating, point.count] }));
    return scatterWidget(points, widget, ["Scene rating", algorithms.countRatingLabel(widget.options.metric)], null);
  }

  function repeatOffenderWidget(scenes: StatsScene[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateRepeatOffenders(scenes);
    const data = algorithms.repeatOffenderSeriesData(stats, null);
    const option: ChartOption = { backgroundColor: "transparent", grid: { left: 8, right: 12, top: 10, bottom: widget.size === "large" ? 42 : 18, containLabel: widget.size !== "small" }, tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => { if (!p.data || !p.data.id) return p.seriesName; return p.data.title + "\n" + p.data.views + " views\nTop " + p.value[0].toFixed(1) + "% account for " + p.value[1].toFixed(1) + "% of views"; } }, xAxis: { type: "value", name: widget.size === "large" ? "Scenes ranked by views (%)" : "", min: 0, max: 100, axisLabel: { show: widget.size !== "small", color: algorithms.themeColor("muted"), formatter: "{value}%" }, axisLine: { lineStyle: { color: algorithms.themeColor("border") } }, splitLine: { show: widget.size !== "small", lineStyle: { color: algorithms.themeColor("grid") } } }, yAxis: { type: "value", name: widget.size === "large" ? "Cumulative views (%)" : "", min: 0, max: 100, axisLabel: { show: widget.size !== "small", color: algorithms.themeColor("muted"), formatter: "{value}%" }, splitLine: { show: widget.size !== "small", lineStyle: { color: algorithms.themeColor("grid") } } }, series: [{ name: "Cumulative views", type: "line", showSymbol: false, sampling: "lttb", lineStyle: { color: algorithms.themeColor("primary"), width: 3 }, areaStyle: { color: algorithms.themeColor("primary"), opacity: .16 }, data, markArea: { silent: true, label: { show: widget.size === "large", color: algorithms.themeColor("text"), formatter: "Top 5%" }, itemStyle: { color: algorithms.themeColor("accent"), opacity: .10 }, data: [[{ xAxis: 0 }, { xAxis: 5 }]] } }, { name: "Equal distribution", type: "line", showSymbol: false, silent: true, lineStyle: { color: algorithms.themeColor("border"), type: "dashed", width: 1 }, data: [[0, 0], [100, 100]] }] };
    const share = Math.round(stats.topShare * 10) / 10;
    return (<React.Fragment>
      {widgetHeader(widget, metric("top 5% view share", stats.totalViews ? share.toFixed(1) + "%" : "—"), metric("recorded views", stats.totalViews), widget.size === "large" ? metric("viewed scenes", stats.viewedScenes + " / " + stats.totalScenes) : null)}
      {stats.totalViews ? (<Chart option={option} label="Cumulative share of views by scene rank" />) : (<State
        title="No recorded views"
        detail={stats.totalScenes ? "Play some scenes to reveal viewing concentration." : "No scenes match these filters."} />)}
    </React.Fragment>);
  }

  function qualityEfficiencyWidget(scenes: StatsScene[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateQualityEfficiency(scenes);
    const chartAxes = axes(widget.size, "Minutes per GiB", "Scene rating"); chartAxes.yAxis.max = 10;
    const bestEfficiency = stats.points.reduce((best, point) => Math.max(best, point.efficiency), 0);
    const option: ChartOption = {
      backgroundColor: "transparent", grid: chartAxes.grid, xAxis: chartAxes.xAxis, yAxis: chartAxes.yAxis,
      tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => p.data.title + "\nRating " + p.value[1].toFixed(1) + "/10\n" + p.value[0].toFixed(1) + " min/GiB\n" + algorithms.formatBytes(p.data.bytes) },
      series: [{ name: "Scenes", type: "scatter", progressive: 4000, data: algorithms.qualityEfficiencySeriesData(stats) }]
    };
    return (<React.Fragment>
      {widgetHeader(widget, metric("comparable scenes", stats.points.length), metric("best efficiency", bestEfficiency ? bestEfficiency.toFixed(1) + " min/GiB" : "—"))}
      {stats.points.length ? (<Chart option={option} label="Scene quality versus storage efficiency; bubble area represents file size" />) : (<State title="No comparable scenes" detail="A rating plus file size and duration are required." />)}
    </React.Fragment>);
  }

  function studioWidget(scenes: StatsScene[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateStudios(scenes);
    const points = stats.points.filter(point => point.rating != null && point.scenes >= widget.options.minScenes);
    const maxBytes = Math.max.apply(null, [1].concat(points.map(point => point.bytes)));
    const data = points.map(point => ({ name: point.name, bytes: point.bytes, value: [point.scenes, Math.round(point.rating! * 10) / 10], symbolSize: 8 + 28 * Math.sqrt(point.bytes / maxBytes) }));
    const chartAxes = axes(widget.size, "Scenes", "Average rating"); chartAxes.yAxis.max = 10;
    const option: ChartOption = { backgroundColor: "transparent", grid: chartAxes.grid, xAxis: chartAxes.xAxis, yAxis: chartAxes.yAxis, tooltip: { trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => p.name + "\n" + p.value[0] + " scenes\nRating " + p.value[1] + "/10\n" + algorithms.formatBytes(p.data.bytes) }, series: [{ type: "scatter", data, label: { show: widget.size === "large" && points.length <= 20, formatter: "{b}", color: algorithms.themeColor("text"), position: "right" }, itemStyle: { color: algorithms.themeColor("primary"), opacity: .8 } }] };
    return (<React.Fragment>
      {widgetHeader(widget, metric("studios", points.length), metric("scene storage", algorithms.formatBytes(stats.totalBytes)))}
      {data.length ? (<Chart option={option} label="Studio scene count versus average rating" />) : (<State title="No rated studios" detail="No studios meet this widget's minimum scene count." />)}
    </React.Fragment>);
  }

  function tagDnaWidget(scenes: StatsScene[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateTagDna(scenes);
    const data = algorithms.tagDnaSeriesData(stats, widget.options.metric, widget.options.maxTags, null);
    const option: ChartOption = {
      backgroundColor: "transparent", tooltip: {
        trigger: "item", renderMode: "richText", formatter: (p: ChartEvent) => {
          const metric = widget.options.metric === "play_count" ? "Views per scene " + p.data.playsPerScene.toFixed(1) : p.data.rating == null ? "No rated scenes" : "Average rating " + p.data.rating.toFixed(1) + "/10";
          return p.name + "\n" + p.value + " scene" + (p.value === 1 ? "" : "s") + "\n" + metric;
        }
      }, series: [{ type: "treemap", roam: widget.size === "large", nodeClick: false, breadcrumb: { show: false }, top: 2, right: 2, bottom: 2, left: 2, squareRatio: 1.1, label: { show: true, color: "#fff", textBorderColor: "rgba(0,0,0,.5)", textBorderWidth: 2, overflow: "truncate", formatter: widget.size === "small" ? "{b}" : "{b}\n{c}" }, emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 3 } }, data }]
    };
    return (<React.Fragment>
      {widgetHeader(widget, metric("tags", stats.tags), metric("tagged scenes", stats.taggedScenes), widget.size === "large" ? metric("untagged", stats.untaggedScenes) : null)}
      {data.length ? (<Chart
        option={option}
        label={"Tag DNA treemap sized by scene count and colored by " + algorithms.tagDnaMetricLabel(widget.options.metric).toLowerCase()} />) : (<State title="No tagged scenes" detail="No matching scenes contain tags." />)}
    </React.Fragment>);
  }

  function constellationWidget(scenes: StatsScene[], widget: DashboardWidgetModel): R.ReactElement | null {
    const configuredLimit = Number(widget.options.maxPerformers);
    const limit = configuredLimit === 0 ? 0 : widget.size === "small" ? Math.min(30, configuredLimit) : widget.size === "medium" ? Math.min(60, configuredLimit) : configuredLimit;
    const stats = algorithms.aggregateConstellation(scenes, limit, widget.options.minShared);
    const largest = Math.max.apply(null, [1].concat(stats.nodes.map(node => node.value)));
    const option: ChartOption = { backgroundColor: "transparent", tooltip: { trigger: "item", renderMode: "richText" }, series: [{ type: "graph", layout: "force", roam: widget.size === "large", draggable: widget.size === "large", data: stats.nodes.map((node, index) => ({ id: node.id, name: node.name, value: node.value, symbolSize: 7 + 24 * Math.sqrt(node.value / largest), itemStyle: { color: node.genderColor }, label: { show: widget.size === "large" && index < 15, color: algorithms.themeColor("text"), position: "right" } })), links: stats.links.map(link => ({ source: link.source, target: link.target, value: link.value, lineStyle: { color: algorithms.themeColor("secondary"), opacity: .25, width: 1 + Math.log(link.value) / Math.log(2) } })), force: { initLayout: "circular", repulsion: widget.size === "small" ? 70 : 150, edgeLength: widget.size === "small" ? 35 : 70, gravity: .05, layoutAnimation: true }, emphasis: { focus: "adjacency" } }] };
    return (<React.Fragment>
      {widgetHeader(widget, metric("performers", stats.totalPerformers), metric("connections", stats.links.length), metric("scenes", stats.totalScenes))}
      {stats.nodes.length ? (<Chart option={option} label="Cast constellation network" />) : (<State title="No cast connections" detail="No performer connections meet this widget's threshold." />)}
    </React.Fragment>);
  }

  function monthCalendar(entries: BirthdayEntry[], year: number, month: number): R.ReactElement | null {
    const counts: Record<number, number> = {}, days = new Date(Date.UTC(year, month, 0)).getUTCDate(), start = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(), cells = [];
    entries.forEach(entry => { if (entry.month === month) counts[entry.day] = (counts[entry.day] || 0) + 1; });
    for (let blank = 0;blank < start;blank += 1) cells.push((<span key={"b" + blank} className="dirty-stats-dashboard-calendar-blank" />));
    for (let day = 1;day <= days;day += 1) cells.push((<span
      key={day}
      className={"dirty-stats-dashboard-calendar-day" + (counts[day] ? " has-birthday" : "")}
      title={counts[day] ? counts[day] + " birthday" + (counts[day] === 1 ? "" : "s") : ""}>
      {day}
      {counts[day] > 1 ? (<small>
        {counts[day]}
      </small>) : null}
    </span>));
    return (<section className="dirty-stats-dashboard-calendar-month" aria-label={MONTHS[month - 1] + " birthdays"}>
      <h4>
        {MONTHS[month - 1]}
      </h4>
      <div className="dirty-stats-dashboard-calendar-grid">
        {cells}
      </div>
    </section>);
  }

  function birthdayWidget(performers: StatsPerformer[], widget: DashboardWidgetModel): R.ReactElement | null {
    const stats = algorithms.aggregateBirthdays(performers);
    const upcoming = stats.entries.slice().sort((left, right) => left.daysUntil - right.daysUntil || left.name.localeCompare(right.name)).slice(0, widget.options.upcomingCount);
    const now = new Date(), year = now.getUTCFullYear();
    if (widget.size === "small") return (<React.Fragment>
      {widgetHeader(widget, metric("birthdays", stats.valid), metric("next 30 days", stats.upcoming))}
      <ol className="dirty-stats-dashboard-upcoming">
        {upcoming.slice(0, 3).map(entry => {
          return (<li key={entry.id} className={entry.deceased ? "is-deceased" : ""}>
            <strong>
              {entry.name}
            </strong>
            <span>
              {algorithms.birthdayDayLabel(entry.month, entry.day) + (entry.daysUntil === 0 ? " · today" : " · " + entry.daysUntil + " day" + (entry.daysUntil === 1 ? "" : "s")) + (entry.deceased ? " · in memoriam" : "")}
            </span>
          </li>);
        })}
      </ol>
    </React.Fragment>);
    const months = widget.size === "medium" ? [now.getUTCMonth() + 1] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return (<React.Fragment>
      {widgetHeader(widget, metric("birthdays", stats.valid), metric("next 30 days", stats.upcoming), stats.today ? metric("today", stats.today) : null)}
      <ol className="dirty-stats-dashboard-upcoming">
        {upcoming.map(entry => {
          return (<li key={entry.id} className={entry.deceased ? "is-deceased" : ""}>
            <strong>
              {entry.name}
            </strong>
            <span>
              {algorithms.birthdayDayLabel(entry.month, entry.day) + (entry.daysUntil === 0 ? " · today" : " · " + entry.daysUntil + " day" + (entry.daysUntil === 1 ? "" : "s")) + (entry.deceased ? " · in memoriam" : "")}
            </span>
          </li>);
        })}
      </ol>
      <div className="dirty-stats-dashboard-calendars">
        {months.map(month => monthCalendar(stats.entries, year, month))}
      </div>
    </React.Fragment>);
  }

  function renderWidget(widget: DashboardWidgetModel, resources: Record<string, ResourceState>): R.ReactElement | null {
    const resource = resources[resourceKey(widget)];
    if (!resource || resource.loading) return (<State title={"Loading " + WIDGETS[widget.statistic].label.toLowerCase() + "…"} />);
    if (resource.error) return (<State title="Could not load this widget" detail={resource.error} role="alert" />);
    const rows = resource.rows || [];
    if (widget.statistic === "performerCards") return (<PerformerCardWidget widget={widget} rows={rows} />);
    if (widget.statistic === "origin") return originWidget(rows, widget);
    if (widget.statistic === "growth") return growthWidget(rows, resource.capacity, widget);
    if (widget.statistic === "ages") return ageWidget(rows, widget);
    if (widget.statistic === "ratings") return ratingWidget(rows, widget, "scene");
    if (widget.statistic === "performerRatings") return ratingWidget(rows, widget, "performer");
    if (widget.statistic === "performerScatter") return performerScatterWidget(rows, widget);
    if (widget.statistic === "countRating") return countRatingWidget(rows, widget);
    if (widget.statistic === "repeatOffenders") return repeatOffenderWidget(rows, widget);
    if (widget.statistic === "qualityEfficiency") return qualityEfficiencyWidget(rows, widget);
    if (widget.statistic === "studios") return studioWidget(rows, widget);
    if (widget.statistic === "tags") return tagDnaWidget(rows, widget);
    if (widget.statistic === "constellation") return constellationWidget(rows, widget);
    return birthdayWidget(rows, widget);
  }
  return { ratingWidget, originWidget, growthWidget, ageWidget, scatterWidget, performerScatterWidget, countRatingWidget, repeatOffenderWidget, qualityEfficiencyWidget, studioWidget, tagDnaWidget, constellationWidget, monthCalendar, birthdayWidget, renderWidget };
}
