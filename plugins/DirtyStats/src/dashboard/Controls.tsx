import { MAX_CARD_COUNT, WIDGETS, filterSummary } from "../domain/dashboard";
import { React, ui } from "../runtime";
import type * as R from "react";
import type { CheckProps, FilterControlProps, NumberProps, SelectProps, WidgetOptionsProps } from "../props";
import type { SettingValue } from "../types";
let controlId = 0;
export function SelectControl(props: SelectProps): R.ReactElement | null {
  const id = React.useRef<string | null>(null);
  if (!id.current) id.current = "dirty-stats-dashboard-control-" + ++controlId;
  return (
    <ui.Field
      id={id.current!}
      label={props.label}
      className={"dirty-stats-dashboard-field" + (props.className ? " " + props.className : "")}
    >
      <select
        className="form-control form-control-sm dirty-ui-select"
        value={String(props.value)}
        onChange={event => {
          props.onChange(event.target.value);
        }}
      >
        {props.values.map(value => {
          return (
            <option key={String(value)} value={String(value)}>
              {props.labels && props.labels[String(value)] != null ? props.labels[String(value)] : String(value)}
            </option>
          );
        })}
      </select>
    </ui.Field>
  );
}

export function NumberControl(props: NumberProps): R.ReactElement | null {
  const id = React.useRef<string | null>(null);
  if (!id.current) id.current = "dirty-stats-dashboard-control-" + ++controlId;
  const [text, setText] = React.useState(String(props.value));
  const [invalid, setInvalid] = React.useState(false);
  React.useEffect(() => {
    setText(String(props.value));
    setInvalid(false);
  }, [props.value]);
  function validCount(raw: string) {
    const count = Number(raw);
    return raw !== "" && Number.isInteger(count) && count >= props.min && count <= props.max;
  }
  function change(raw: string) {
    setText(raw);
    if (validCount(raw)) {
      setInvalid(false);
      props.onChange(Number(raw));
    } else setInvalid(true);
  }
  return (
    <ui.Field
      id={id.current!}
      label={props.label}
      error={invalid ? props.invalidLabel : undefined}
      className={"dirty-stats-dashboard-field" + (props.className ? " " + props.className : "")}
    >
      <input
        type="number"
        className="form-control form-control-sm"
        id={id.current!}
        min={props.min}
        max={props.max}
        step={1}
        inputMode="numeric"
        value={text}
        onChange={event => {
          change(event.target.value);
        }}
        onBlur={() => {
          setText(String(props.value));
          setInvalid(false);
        }}
      />
    </ui.Field>
  );
}

export function CheckControl(props: CheckProps): R.ReactElement | null {
  return (
    <ui.SettingsToggle
      className="dirty-stats-dashboard-check"
      checked={props.value}
      label={props.label}
      onChange={props.onChange}
    />
  );
}

export function FilterControl(props: FilterControlProps): R.ReactElement | null {
  const id = React.useRef<string | null>(null);
  if (!id.current) id.current = "dirty-stats-dashboard-control-" + ++controlId;
  return (
    <ui.Field
      id={id.current!}
      label={filterSummary(props.filter, props.entity)}
      className="dirty-stats-dashboard-field dirty-stats-dashboard-filter-setting"
    >
      <button
        type="button"
        className="btn btn-secondary dirty-ui-button"
        aria-label={"Change filters: " + filterSummary(props.filter, props.entity)}
        onClick={props.onChange}
      >
        Change filters
      </button>
    </ui.Field>
  );
}

export function WidgetOptions(props: WidgetOptionsProps): R.ReactElement | null {
  return (
    <React.Fragment>
      {props.kind === "fields" ? null : (
        <CheckControl
          label="Show header"
          value={props.widget.options.showHeader}
          onChange={value => {
            props.onChange(Object.assign({}, props.widget.options, { showHeader: value }));
          }}
        />
      )}
      {StatisticWidgetOptions(props)}
    </React.Fragment>
  );
}

export function StatisticWidgetOptions(props: WidgetOptionsProps): R.ReactElement | null {
  const widget = props.widget,
    options = widget.options;
  function set(name: string, value: SettingValue) {
    const next = Object.assign({}, options);
    next[name] = value;
    props.onChange(next);
  }
  function field<P extends SelectProps | NumberProps>(Component: R.ComponentType<P>, controlProps: P) {
    return props.kind === "toggles" ? null : <Component {...controlProps} />;
  }
  function check(controlProps: CheckProps) {
    return props.kind === "fields" ? null : <CheckControl {...controlProps} />;
  }
  if (widget.statistic === "origin")
    return (
      <React.Fragment>
        {widget.size === "large"
          ? check({
              label: "Show map numbers",
              value: options.showNumbers,
              onChange: value => {
                set("showNumbers", value);
              },
            })
          : null}
      </React.Fragment>
    );
  if (widget.statistic === "growth")
    return (
      <React.Fragment>
        {field(SelectControl, {
          label: "Date basis",
          value: options.dateBasis,
          values: WIDGETS.growth.choices.dateBasis as SettingValue[],
          labels: { created_at: "Created at", mod_time: "File modified", scene_date: "Scene date" },
          onChange: value => {
            set("dateBasis", value);
          },
        })}
        {field(SelectControl, {
          label: "Group by",
          value: options.grouping,
          values: WIDGETS.growth.choices.grouping as SettingValue[],
          onChange: value => {
            set("grouping", value);
          },
        })}
        {check({
          label: "Show capacity",
          value: options.showCapacity,
          onChange: value => {
            set("showCapacity", value);
          },
        })}
        {check({
          label: "Show forecast",
          value: options.showForecast,
          onChange: value => {
            set("showForecast", value);
          },
        })}
      </React.Fragment>
    );
  if (widget.statistic === "ages")
    return (
      <React.Fragment>
        {check({
          label: "Show performer count",
          value: options.showPerformerCount,
          onChange: value => {
            set("showPerformerCount", value);
          },
        })}
        {check({
          label: "Show mode age",
          value: options.showModeAge,
          onChange: value => {
            set("showModeAge", value);
          },
        })}
        {check({
          label: "Show median age",
          value: options.showMedianAge,
          onChange: value => {
            set("showMedianAge", value);
          },
        })}
        {check({
          label: "Show average age",
          value: options.showAverageAge,
          onChange: value => {
            set("showAverageAge", value);
          },
        })}
      </React.Fragment>
    );
  if (widget.statistic === "ratings" || widget.statistic === "performerRatings")
    return field(SelectControl, {
      label: "Rating rounding",
      value: options.rounding,
      values: WIDGETS[widget.statistic].choices.rounding as SettingValue[],
      labels: { 0: "Exact", 0.5: "0.5", 1: "1" },
      onChange: value => {
        set("rounding", Number(value));
      },
    });
  if (widget.statistic === "performerScatter")
    return (
      <React.Fragment>
        {field(SelectControl, {
          label: "Minimum rating",
          value: options.minRating,
          values: WIDGETS.performerScatter.choices.minRating as SettingValue[],
          labels: { 0: "Any" },
          onChange: value => {
            set("minRating", Number(value));
          },
        })}
        {field(SelectControl, {
          label: "Maximum scenes",
          value: options.maxScenes,
          values: WIDGETS.performerScatter.choices.maxScenes as SettingValue[],
          labels: { 0: "Any" },
          onChange: value => {
            set("maxScenes", Number(value));
          },
        })}
      </React.Fragment>
    );
  if (widget.statistic === "performerCards")
    return field(NumberControl, {
      label: "Cards to display",
      value: options.cardCount,
      min: 1,
      max: MAX_CARD_COUNT,
      invalidLabel: "Enter a whole number from 1 to " + MAX_CARD_COUNT + ".",
      onChange: value => {
        set("cardCount", value);
      },
    });
  if (widget.statistic === "countRating")
    return field(SelectControl, {
      label: "Count",
      value: options.metric,
      values: WIDGETS.countRating.choices.metric as SettingValue[],
      labels: { play_count: "View count", o_counter: "O count" },
      onChange: value => {
        set("metric", value);
      },
    });
  if (widget.statistic === "studios")
    return field(SelectControl, {
      label: "Minimum scenes",
      value: options.minScenes,
      values: WIDGETS.studios.choices.minScenes as SettingValue[],
      onChange: value => {
        set("minScenes", Number(value));
      },
    });
  if (widget.statistic === "tags")
    return (
      <React.Fragment>
        {field(SelectControl, {
          label: "Color by",
          value: options.metric,
          values: WIDGETS.tags.choices.metric as SettingValue[],
          labels: { rating: "Average rating", play_count: "Views per scene" },
          onChange: value => {
            set("metric", value);
          },
        })}
        {field(SelectControl, {
          label: "Maximum tags",
          value: options.maxTags,
          values: WIDGETS.tags.choices.maxTags as SettingValue[],
          labels: { 0: "All" },
          onChange: value => {
            set("maxTags", Number(value));
          },
        })}
      </React.Fragment>
    );
  if (widget.statistic === "constellation")
    return (
      <React.Fragment>
        {field(SelectControl, {
          label: "Maximum performers",
          value: options.maxPerformers,
          values: WIDGETS.constellation.choices.maxPerformers as SettingValue[],
          labels: { 0: "All" },
          onChange: value => {
            set("maxPerformers", Number(value));
          },
        })}
        {field(SelectControl, {
          label: "Minimum shared scenes",
          value: options.minShared,
          values: WIDGETS.constellation.choices.minShared as SettingValue[],
          onChange: value => {
            set("minShared", Number(value));
          },
        })}
      </React.Fragment>
    );
  if (widget.statistic === "birthdays")
    return field(SelectControl, {
      label: "Upcoming performers",
      value: options.upcomingCount,
      values: WIDGETS.birthdays.choices.upcomingCount as SettingValue[],
      onChange: value => {
        set("upcomingCount", Number(value));
      },
    });
  return props.kind === "toggles" ? null : (
    <span className="dirty-stats-dashboard-no-options">This statistic has no additional widget options.</span>
  );
}
