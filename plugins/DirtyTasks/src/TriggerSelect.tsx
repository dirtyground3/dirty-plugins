import { React } from "../../DirtyPlugins/src/shared/host";
import { RUN_MODES, WEEKDAYS, normalizeSchedule, type RunMode, type Schedule } from "./execution";
export function TriggerSelect({
  label,
  value,
  schedule,
  disabled,
  onChange,
  onSchedule,
}: {
  label: string;
  value: RunMode;
  schedule?: Schedule;
  disabled: boolean;
  onChange(value: RunMode): void;
  onSchedule?(value: Schedule): void;
}) {
  const [time, setTime] = React.useState(schedule?.time || "");
  React.useEffect(() => setTime(schedule?.time || ""), [schedule?.time]);
  const days = schedule?.days || [];
  const update = (next: Schedule) => {
    const valid = normalizeSchedule(next);
    if (valid) onSchedule?.(valid);
  };
  return (
    <span className="dirty-tasks-trigger-group">
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
      {value === "schedule" && schedule && (
        <span className="dirty-tasks-schedule" role="group" aria-label={label + " schedule"}>
          <input
            type="time"
            required
            aria-label={label + " time"}
            className="form-control dirty-tasks-schedule-time"
            value={time}
            disabled={disabled}
            aria-invalid={normalizeSchedule({ time, days }) ? undefined : "true"}
            onChange={event => {
              setTime(event.target.value);
              update({ time: event.target.value, days });
            }}
          />
          {WEEKDAYS.map((name, day) => {
            const selected = days.includes(day);
            return (
              <button
                key={name}
                type="button"
                className="dirty-tasks-schedule-day"
                aria-label={label + " on " + name}
                aria-pressed={selected}
                title={selected && days.length === 1 ? "Keep at least one day" : name}
                disabled={disabled || (selected && days.length === 1)}
                onClick={() =>
                  update({ time: schedule.time, days: selected ? days.filter(item => item !== day) : [...days, day] })
                }
              >
                {name.slice(0, 2)}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
