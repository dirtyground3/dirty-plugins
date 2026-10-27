import { React } from "../runtime";
import type { PreviewFilter, Summary as PreviewSummary } from "../types";
export function Summary(props: {
  summary: PreviewSummary;
  total: number;
  value: PreviewFilter;
  disabled?: boolean;
  onChange(value: PreviewFilter): void;
}) {
  const summary = props.summary;
  const values: [string, number, PreviewFilter][] = [
    ["All", props.total || 0, "all"],
    ["Ready", summary.ready || 0, "ready"],
    ["Moves", summary.moves || 0, "move"],
    ["Renames", summary.renames || 0, "rename"],
    ["Warnings", summary.warnings || 0, "warning"],
    ["Unchanged", summary.unchanged || 0, "unchanged"],
    ["Blocked", summary.blocked || 0, "blocked"],
  ];
  return (
    <div className="dirty-tidy-summary" role="group" aria-label="Filter preview">
      {values
        .filter(value => value[2] === "all" || value[1] > 0 || props.value === value[2])
        .map(value => {
          const active = props.value === value[2];
          return (
            <button
              aria-pressed={active}
              className={
                "dirty-tidy-summary-item dirty-ui-metric dirty-tidy-summary-" +
                value[2] +
                (active ? " dirty-tidy-summary-active" : "")
              }
              disabled={props.disabled}
              key={value[0]}
              onClick={() => props.onChange(value[2])}
              type="button"
            >
              <strong className="dirty-ui-metric-value">{String(value[1])}</strong>
              <span className="dirty-ui-metric-detail">{value[0]}</span>
            </button>
          );
        })}
    </div>
  );
}
