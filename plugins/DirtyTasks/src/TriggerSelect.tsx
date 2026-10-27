import { React } from "../../DirtyPlugins/src/shared/host";
import { RUN_MODES, type RunMode } from "./execution";
export function TriggerSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: RunMode;
  disabled: boolean;
  onChange(value: RunMode): void;
}) {
  return (
    <select
      aria-label={label + " trigger"}
      className="form-control dirty-ui-select dirty-tasks-trigger"
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value as RunMode)}
    >
      {RUN_MODES.map(item => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}
