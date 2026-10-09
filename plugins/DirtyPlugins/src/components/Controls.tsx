import { PluginApi, React } from "../runtime";
import type { PaginationProps, SharedProps } from "../types";
export function Glyph(props: SharedProps) {
  if (PluginApi.libraries.ReactFontAwesome?.FontAwesomeIcon && props.icon) {
    return (React.createElement(PluginApi.libraries.ReactFontAwesome!.FontAwesomeIcon, { "icon": props.icon }));
  }
  return (<span
    aria-hidden="true">
    {props.fallback}
  </span>);
}

export function IconButton(props: SharedProps) {
  var className = "dirty-ui-icon-button" +
    (props.compact ? " dirty-ui-icon-button-compact" : "") +
    (props.tone === "danger" ? " dirty-ui-icon-button-danger" : "") +
    (props.tone === "primary" ? " dirty-ui-icon-button-primary" : "") +
    (props.className ? " " + props.className : "");
  return (<button
    type="button"
    className={className}
    aria-label={props.ariaLabel}
    title={props.ariaLabel}
    disabled={Boolean(props.disabled || props.busy)}
    aria-busy={props.busy ? "true" : undefined}
    aria-pressed={props.pressed == null ? undefined : Boolean(props.pressed)}
    ref={props.buttonRef}
    onClick={props.onClick}>
    <Glyph
      icon={props.icon}
      fallback={props.fallback}>

    </Glyph>
  </button>);
}

export function Button(props: SharedProps) {
  var tone = /^(primary|secondary|danger|light|dark|quiet)$/.test(props.tone || "")
    ? props.tone : "secondary";
  var className = "btn " + (tone === "quiet" ? "dirty-ui-control-quiet" : "btn-" + tone) +
    " dirty-ui-button dirty-ui-control" +
    (props.compact ? " dirty-ui-control-compact" : "") +
    (props.className ? " " + props.className : "");
  return (<button
    type={props.type || "button"}
    className={className}
    disabled={Boolean(props.disabled || props.busy)}
    aria-label={props.ariaLabel}
    aria-busy={props.busy ? "true" : undefined}
    aria-pressed={props.pressed == null ? undefined : Boolean(props.pressed)}
    ref={props.buttonRef}
    onClick={props.onClick}
    title={props.title}>
    {props.children}
  </button>);
}

export function Field(props: SharedProps) {
  var descriptionId = props.id + "-help";
  var errorId = props.id + "-error";
  var control = props.children;
  if (React.isValidElement<Record<string, unknown>>(control)) {
    var existing = control.props["aria-describedby"];
    var describedBy = [existing, props.help && descriptionId, props.error && errorId]
      .filter(Boolean).join(" ") || undefined;
    control = React.cloneElement(control, {
      id: props.id,
      "aria-describedby": describedBy,
      "aria-invalid": props.error ? "true" : control.props["aria-invalid"],
    });
  }
  return (<div
    className={"dirty-ui-field" + (props.className ? " " + props.className : "")}
    id={props.containerId}>
    <label
      htmlFor={props.id}>
      {props.label}
    </label>
    {props.action ? (<div
      className="dirty-ui-field-control">
      {control}
      {props.action}
    </div>) : control}
    {props.help && (<p
      className="dirty-ui-field-help"
      id={descriptionId}>
      {props.help}
    </p>)}
    {props.error && (<p
      className="dirty-ui-field-error"
      id={errorId}>
      {props.error}
    </p>)}
  </div>);
}

export function SaveStatus(props: SharedProps) {
  if (!props.message) return null;
  var state = props.state || "saved";
  return (<span
    className={"dirty-ui-save-status" + (props.className ? " " + props.className : "")}
    data-state={state}
    role={state === "error" ? "alert" : "status"}
    aria-live={state === "error" ? "assertive" : "polite"}>
    {props.message}
  </span>);
}

export function Badge(props: SharedProps) {
  return (<span
    className={"dirty-ui-badge" + (props.className ? " " + props.className : "")}
    title={props.title}>
    {props.children}
  </span>);
}

export function Metric(props: SharedProps) {
  return (<div
    className={"dirty-ui-metric" + (props.className ? " " + props.className : "")}>
    <span
      className="dirty-ui-metric-label">
      {props.label}
    </span>
    <strong
      className="dirty-ui-metric-value">
      {props.value}
    </strong>
    {props.detail && (<span
      className="dirty-ui-metric-detail">
      {props.detail}
    </span>)}
  </div>);
}

export function StateView(props: SharedProps) {
  var className = "dirty-ui-state" +
    (props.className ? " " + props.className : "");
  return (<div
    className={className}
    role={props.role}
    aria-live={props.ariaLive}>
    <div
      className="dirty-ui-state-panel">
      <div
        className="dirty-ui-state-title">
        {props.title}
      </div>
      {props.detail && (<div
        className="dirty-ui-state-detail">
        {props.detail}
      </div>)}
      {props.actions && (<div
        className="dirty-ui-state-actions">
        {props.actions}
      </div>)}
    </div>
  </div>);
}

export function Pagination(props: PaginationProps) {
  if (props.totalPages <= 1) return null;
  return (<nav
    aria-label={props.ariaLabel || "Pages"}
    className={"dirty-ui-pagination" + (props.className ? " " + props.className : "")}>
    <Button
      compact={true}
      disabled={props.page <= 1}
      onClick={function() { props.onPageChange(props.page - 1); }}>
      {"Previous"}
    </Button>
    <span
      className="dirty-ui-pagination-summary">
      {props.summary || "Page " + props.page + " of " + props.totalPages}
    </span>
    <Button
      compact={true}
      disabled={props.page >= props.totalPages}
      onClick={function() { props.onPageChange(props.page + 1); }}>
      {"Next"}
    </Button>
  </nav>);
}
