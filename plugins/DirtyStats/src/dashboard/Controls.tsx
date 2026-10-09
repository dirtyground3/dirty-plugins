import type * as R from "react";
import type { DashboardDependencies } from "../dashboardView";
import type { CheckProps, FilterControlProps, NumberProps, SelectProps, WidgetOptionsProps } from "../props";
export function createDashboardControls(dependencies: DashboardDependencies) {
  const { filterSummary, React, Field, Toggle, MAX_CARD_COUNT, WIDGETS } = dependencies;
  var controlId = 0;
  function SelectControl(props: SelectProps): R.ReactElement | null {
    var id = React.useRef<string | null>(null);
    if (!id.current) id.current = "dirty-stats-dashboard-control-" + (++controlId);
    return (<Field
      id={id.current!}
      label={props.label}
      className={"dirty-stats-dashboard-field" + (props.className ? " " + props.className : "")}>

      <select
        className="form-control form-control-sm dirty-ui-select"
        value={String(props.value)}
        onChange={function (event) { props.onChange(event.target.value); }}>

        {props.values.map(function (value) {
          return (<option key={String(value)} value={String(value)}>

            {props.labels && props.labels[String(value)] != null ? props.labels[String(value)] : String(value)}

          </option>);
        })}

      </select>

    </Field>);
  }

  function NumberControl(props: NumberProps): R.ReactElement | null {
    var id = React.useRef<string | null>(null);
    if (!id.current) id.current = "dirty-stats-dashboard-control-" + (++controlId);
    var textState = React.useState(String(props.value)), text = textState[0], setText = textState[1];
    var invalidState = React.useState(false), invalid = invalidState[0], setInvalid = invalidState[1];
    React.useEffect(function () { setText(String(props.value)); setInvalid(false); }, [props.value]);
    function validCount(raw: string) {
      var count = Number(raw);
      return raw !== "" && Number.isInteger(count) && count >= props.min && count <= props.max;
    }
    function change(raw: string) {
      setText(raw);
      if (validCount(raw)) { setInvalid(false); props.onChange(Number(raw)); }
      else setInvalid(true);
    }
    return (<Field
      id={id.current!}
      label={props.label}
      error={invalid ? props.invalidLabel : undefined}
      className={"dirty-stats-dashboard-field" + (props.className ? " " + props.className : "")}>

      <input
        type="number"
        className="form-control form-control-sm"
        id={id.current!}
        min={props.min}
        max={props.max}
        step={1}
        inputMode="numeric"
        value={text}
        onChange={function (event) { change(event.target.value); }}
        onBlur={function () { setText(String(props.value)); setInvalid(false); }} />

    </Field>);
  }

  function CheckControl(props: CheckProps): R.ReactElement | null {
    return (<Toggle
      className="dirty-stats-dashboard-check"
      checked={props.value}
      label={props.label}
      onChange={props.onChange} />);
  }

  function FilterControl(props: FilterControlProps): R.ReactElement | null {
    var id = React.useRef<string | null>(null);
    if (!id.current) id.current = "dirty-stats-dashboard-control-" + (++controlId);
    return (<Field
      id={id.current!}
      label={filterSummary(props.filter, props.entity)}
      className="dirty-stats-dashboard-field dirty-stats-dashboard-filter-setting">

      <button
        type="button"
        className="btn btn-secondary dirty-ui-button"
        aria-label={"Change filters: " + filterSummary(props.filter, props.entity)}
        onClick={props.onChange}>

        {"Change filters"}

      </button>

    </Field>);
  }

  function WidgetOptions(props: WidgetOptionsProps): R.ReactElement | null {
    return (<React.Fragment>

      {props.kind === "fields" ? null : (<CheckControl label="Show header" value={props.widget.options.showHeader} onChange={function (value) {
        props.onChange(Object.assign({}, props.widget.options, { showHeader: value }));
      }} />)}

      {StatisticWidgetOptions(props)}

    </React.Fragment>);
  }

  function StatisticWidgetOptions(props: WidgetOptionsProps): R.ReactElement | null {
    var widget = props.widget, options = widget.options;
    function set(name: string, value: import("../types").SettingValue) { var next = Object.assign({}, options); next[name] = value; props.onChange(next); }
    function field<P extends SelectProps | NumberProps>(Component: R.ComponentType<P>, controlProps: P) { return props.kind === "toggles" ? null : (<Component {...controlProps} />); }
    function check(controlProps: CheckProps) { return props.kind === "fields" ? null : (<CheckControl {...controlProps} />); }
    if (widget.statistic === "origin") return (<React.Fragment>

      {widget.size === "large" ? check({ label: "Show map numbers", value: options.showNumbers, onChange: function (value) { set("showNumbers", value); } }) : null}

    </React.Fragment>);
    if (widget.statistic === "growth") return (<React.Fragment>

      {field(SelectControl, { label: "Date basis", value: options.dateBasis, values: WIDGETS.growth.choices.dateBasis as import("../types").SettingValue[], labels: { created_at: "Created at", mod_time: "File modified", scene_date: "Scene date" }, onChange: function (value) { set("dateBasis", value); } })}

      {field(SelectControl, { label: "Group by", value: options.grouping, values: WIDGETS.growth.choices.grouping as import("../types").SettingValue[], onChange: function (value) { set("grouping", value); } })}

      {check({ label: "Show capacity", value: options.showCapacity, onChange: function (value) { set("showCapacity", value); } })}

      {check({ label: "Show forecast", value: options.showForecast, onChange: function (value) { set("showForecast", value); } })}

    </React.Fragment>);
    if (widget.statistic === "ages") return (<React.Fragment>

      {check({ label: "Show performer count", value: options.showPerformerCount, onChange: function (value) { set("showPerformerCount", value); } })}

      {check({ label: "Show mode age", value: options.showModeAge, onChange: function (value) { set("showModeAge", value); } })}

      {check({ label: "Show median age", value: options.showMedianAge, onChange: function (value) { set("showMedianAge", value); } })}

      {check({ label: "Show average age", value: options.showAverageAge, onChange: function (value) { set("showAverageAge", value); } })}

    </React.Fragment>);
    if (widget.statistic === "ratings" || widget.statistic === "performerRatings") return field(SelectControl, { label: "Rating rounding", value: options.rounding, values: WIDGETS[widget.statistic].choices.rounding as import("../types").SettingValue[], labels: { 0: "Exact", 0.5: "0.5", 1: "1" }, onChange: function (value) { set("rounding", Number(value)); } });
    if (widget.statistic === "performerScatter") return (<React.Fragment>

      {field(SelectControl, { label: "Minimum rating", value: options.minRating, values: WIDGETS.performerScatter.choices.minRating as import("../types").SettingValue[], labels: { 0: "Any" }, onChange: function (value) { set("minRating", Number(value)); } })}

      {field(SelectControl, { label: "Maximum scenes", value: options.maxScenes, values: WIDGETS.performerScatter.choices.maxScenes as import("../types").SettingValue[], labels: { 0: "Any" }, onChange: function (value) { set("maxScenes", Number(value)); } })}

    </React.Fragment>);
    if (widget.statistic === "performerCards") return field(NumberControl, { label: "Cards to display", value: options.cardCount, min: 1, max: MAX_CARD_COUNT, invalidLabel: "Enter a whole number from 1 to " + MAX_CARD_COUNT + ".", onChange: function (value) { set("cardCount", value); } });
    if (widget.statistic === "countRating") return field(SelectControl, { label: "Count", value: options.metric, values: WIDGETS.countRating.choices.metric as import("../types").SettingValue[], labels: { play_count: "View count", o_counter: "O count" }, onChange: function (value) { set("metric", value); } });
    if (widget.statistic === "studios") return field(SelectControl, { label: "Minimum scenes", value: options.minScenes, values: WIDGETS.studios.choices.minScenes as import("../types").SettingValue[], onChange: function (value) { set("minScenes", Number(value)); } });
    if (widget.statistic === "tags") return (<React.Fragment>

      {field(SelectControl, { label: "Color by", value: options.metric, values: WIDGETS.tags.choices.metric as import("../types").SettingValue[], labels: { rating: "Average rating", play_count: "Views per scene" }, onChange: function (value) { set("metric", value); } })}

      {field(SelectControl, { label: "Maximum tags", value: options.maxTags, values: WIDGETS.tags.choices.maxTags as import("../types").SettingValue[], labels: { 0: "All" }, onChange: function (value) { set("maxTags", Number(value)); } })}

    </React.Fragment>);
    if (widget.statistic === "constellation") return (<React.Fragment>

      {field(SelectControl, { label: "Maximum performers", value: options.maxPerformers, values: WIDGETS.constellation.choices.maxPerformers as import("../types").SettingValue[], labels: { 0: "All" }, onChange: function (value) { set("maxPerformers", Number(value)); } })}

      {field(SelectControl, { label: "Minimum shared scenes", value: options.minShared, values: WIDGETS.constellation.choices.minShared as import("../types").SettingValue[], onChange: function (value) { set("minShared", Number(value)); } })}

    </React.Fragment>);
    if (widget.statistic === "birthdays") return field(SelectControl, { label: "Upcoming performers", value: options.upcomingCount, values: WIDGETS.birthdays.choices.upcomingCount as import("../types").SettingValue[], onChange: function (value) { set("upcomingCount", Number(value)); } });
    return props.kind === "toggles" ? null : (<span className="dirty-stats-dashboard-no-options">

      {"This statistic has no additional widget options."}

    </span>);
  }
  return { SelectControl, NumberControl, CheckControl, FilterControl, WidgetOptions, StatisticWidgetOptions };
}
