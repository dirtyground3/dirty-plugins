import { PluginApi, React } from "../runtime";
import type { PaginationProps, SharedProps } from "../types";
import { withClass } from "../shared/values";

export function Glyph(props: SharedProps) {
  const FontAwesomeIcon = PluginApi.libraries.ReactFontAwesome?.FontAwesomeIcon;
  if (FontAwesomeIcon && props.icon) return <FontAwesomeIcon icon={props.icon} />;
  return <span aria-hidden="true">{props.fallback}</span>;
}

export function IconButton(props: SharedProps) {
  const className = withClass(
    "dirty-ui-icon-button" +
      (props.compact ? " dirty-ui-icon-button-compact" : "") +
      (props.tone === "danger" ? " dirty-ui-icon-button-danger" : "") +
      (props.tone === "primary" ? " dirty-ui-icon-button-primary" : ""),
    props.className,
  );
  return (
    <button
      type="button"
      className={className}
      aria-label={props.ariaLabel}
      title={props.ariaLabel}
      disabled={Boolean(props.disabled || props.busy)}
      aria-busy={props.busy ? "true" : undefined}
      aria-pressed={props.pressed == null ? undefined : Boolean(props.pressed)}
      ref={props.buttonRef}
      onClick={props.onClick}
    >
      <Glyph icon={props.icon} fallback={props.fallback} />
    </button>
  );
}

export function Button(props: SharedProps) {
  const tone = /^(primary|secondary|danger|light|dark|quiet)$/.test(props.tone || "") ? props.tone : "secondary";
  const className = withClass(
    "btn " +
      (tone === "quiet" ? "dirty-ui-control-quiet" : "btn-" + tone) +
      " dirty-ui-button dirty-ui-control" +
      (props.compact ? " dirty-ui-control-compact" : ""),
    props.className,
  );
  return (
    <button
      type={props.type || "button"}
      className={className}
      disabled={Boolean(props.disabled || props.busy)}
      aria-label={props.ariaLabel}
      aria-busy={props.busy ? "true" : undefined}
      aria-pressed={props.pressed == null ? undefined : Boolean(props.pressed)}
      ref={props.buttonRef}
      onClick={props.onClick}
      title={props.title}
    >
      {props.children}
    </button>
  );
}

export function Field(props: SharedProps) {
  const descriptionId = props.id + "-help",
    errorId = props.id + "-error";
  let control = props.children;
  if (React.isValidElement<Record<string, unknown>>(control)) {
    const describedBy =
      [control.props["aria-describedby"], props.help && descriptionId, props.error && errorId]
        .filter(Boolean)
        .join(" ") || undefined;
    control = React.cloneElement(control, {
      id: props.id,
      "aria-describedby": describedBy,
      "aria-invalid": props.error ? "true" : control.props["aria-invalid"],
    });
  }
  return (
    <div className={withClass("dirty-ui-field", props.className)} id={props.containerId}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.action ? (
        <div className="dirty-ui-field-control">
          {control}
          {props.action}
        </div>
      ) : (
        control
      )}
      {props.help && (
        <p className="dirty-ui-field-help" id={descriptionId}>
          {props.help}
        </p>
      )}
      {props.error && (
        <p className="dirty-ui-field-error" id={errorId}>
          {props.error}
        </p>
      )}
    </div>
  );
}

export function SaveStatus(props: SharedProps) {
  if (!props.message) return null;
  const state = props.state || "saved";
  return (
    <span
      className={withClass("dirty-ui-save-status", props.className)}
      data-state={state}
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
    >
      {props.message}
    </span>
  );
}

export function Badge(props: SharedProps) {
  return (
    <span className={withClass("dirty-ui-badge", props.className)} title={props.title}>
      {props.children}
    </span>
  );
}

export function Metric(props: SharedProps) {
  return (
    <div className={withClass("dirty-ui-metric", props.className)}>
      <span className="dirty-ui-metric-label">{props.label}</span>
      <strong className="dirty-ui-metric-value">{props.value}</strong>
      {props.detail && <span className="dirty-ui-metric-detail">{props.detail}</span>}
    </div>
  );
}

export function StateView(props: SharedProps) {
  return (
    <div className={withClass("dirty-ui-state", props.className)} role={props.role} aria-live={props.ariaLive}>
      <div className="dirty-ui-state-panel">
        <div className="dirty-ui-state-title">{props.title}</div>
        {props.detail && <div className="dirty-ui-state-detail">{props.detail}</div>}
        {props.actions && <div className="dirty-ui-state-actions">{props.actions}</div>}
      </div>
    </div>
  );
}

export function Pagination(props: PaginationProps) {
  if (props.totalPages <= 1) return null;
  return (
    <nav aria-label={props.ariaLabel || "Pages"} className={withClass("dirty-ui-pagination", props.className)}>
      <Button compact={true} disabled={props.page <= 1} onClick={() => props.onPageChange(props.page - 1)}>
        Previous
      </Button>
      <span className="dirty-ui-pagination-summary">
        {props.summary || "Page " + props.page + " of " + props.totalPages}
      </span>
      <Button
        compact={true}
        disabled={props.page >= props.totalPages}
        onClick={() => props.onPageChange(props.page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
