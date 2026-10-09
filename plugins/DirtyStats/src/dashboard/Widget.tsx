import type * as R from "react";
import type { DashboardDependencies } from "../dashboardView";
import type { DashboardWidgetProps } from "../props";
export function createDashboardWidget(dependencies: DashboardDependencies) {
  const { widgetTitle, widgetHeightUnits, renderWidget, SelectControl, FilterControl, WidgetOptions, hub, React, Link, SIZES, SIZE_LABELS, WIDGETS } = dependencies;
  function DashboardWidget(props: DashboardWidgetProps): R.ReactElement | null {
    const widget = props.widget, definition = WIDGETS[widget.statistic];
    const title = widgetTitle(widget);
    const compact = widget.size !== "large" && !props.editing;
    return (<article
      className={"dirty-stats-dashboard-widget dirty-stats-dashboard-widget-" + widget.size + " dirty-stats-dashboard-height-" + widgetHeightUnits(widget) + (compact ? " is-compact" : "") + (props.dragging ? " is-dragging" : "")}
      data-statistic={widget.statistic}
      data-widget-index={props.index}
      aria-grabbed={props.dragging ? "true" : undefined}>
      <header className={"dirty-stats-dashboard-widget-header" + (compact ? " is-compact" : "")}>
        <div className="dirty-stats-dashboard-widget-title">
          {props.editing ?
            (<input
              type="text"
              className="dirty-stats-dashboard-title-input"
              value={widget.title || ""}
              placeholder={definition.label}
              maxLength={100}
              aria-label={definition.label + " widget title"}
              onChange={event => { props.onTitle(event.target.value); }} />) :
            (<h2 title={title}>
              {title}
            </h2>)}
        </div>
        <div className="dirty-stats-dashboard-widget-actions">
          {props.editing || widget.statistic === "performerCards" ? null : (<Link
            className="dirty-stats-dashboard-open-link"
            to={hub.captureUrl(definition.route)}
            title={"Open " + definition.label + " full view"}
            aria-label={"Open " + definition.label + " full view"}>
            <span aria-hidden={true}>
              ↗
            </span>
          </Link>)}
          {props.editing ? (<React.Fragment>
            <button
              type="button"
              className="dirty-ui-icon-button dirty-ui-icon-button-compact dirty-stats-dashboard-drag-handle"
              title="Drag to reorder; arrow keys also move this widget"
              aria-label={"Reorder " + title + "; use arrow keys or drag"}
              onPointerDown={props.onDragStart}
              onKeyDown={props.onDragKeyDown}>
              <span aria-hidden={true}>
                ⠿
              </span>
            </button>
            <button
              type="button"
              className="dirty-ui-icon-button dirty-ui-icon-button-compact dirty-ui-icon-button-danger dirty-stats-dashboard-remove"
              title="Remove widget"
              aria-label={"Remove " + title + " widget"}
              onClick={props.onRemove}>
              <span aria-hidden={true}>
                ×
              </span>
            </button>
          </React.Fragment>) : null}
        </div>
      </header>
      {props.editing ? (<div className="dirty-stats-dashboard-editor" role="group" aria-label={definition.label + " widget settings"}>
        <div className="dirty-stats-dashboard-fields">
          <SelectControl label="Size" value={widget.size} values={SIZES} labels={SIZE_LABELS} onChange={props.onSize} />
          <FilterControl filter={widget.filter} entity={definition.entity} onChange={props.onFilter} />
          <WidgetOptions widget={widget} kind="fields" onChange={props.onOptions} />
        </div>
        <div className="dirty-stats-dashboard-toggles">
          <WidgetOptions widget={widget} kind="toggles" onChange={props.onOptions} />
        </div>
      </div>) : null}
      <div className="dirty-stats-dashboard-widget-body">
        {renderWidget(widget, props.resources)}
      </div>
    </article>);
  }
  return { DashboardWidget };
}
