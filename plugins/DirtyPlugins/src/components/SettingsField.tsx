import { React } from "../runtime";
import type { FieldDefinition } from "../settings";
import type { SharedProps } from "../types";
import { Field } from "./Controls";

export interface SettingsFieldProps extends Pick<SharedProps, "className" | "action" | "error" | "disabled"> {
  definition: FieldDefinition;
  value: unknown;
  onChange(value: string | boolean): void;
}
/** Native controls preserve raw values; validation and capture masking are local. */
export function SettingsField({ definition: field, value, onChange, ...props }: SettingsFieldProps) {
  const control = field.kind === "checkbox"
    ? <input id={field.id} type="checkbox" disabled={props.disabled} checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
    : field.kind === "select"
      ? <select id={field.id} className="form-control dirty-ui-select" disabled={props.disabled}
        value={String(value == null ? "" : value)} onChange={event => onChange(event.target.value)}>
        {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      : <input id={field.id} className="form-control" disabled={props.disabled} type={field.kind}
        min={field.min} max={field.max} step={field.step} value={value == null ? "" : value as string | number | readonly string[]}
        onChange={event => onChange(event.target.value)} />;
  return <Field id={field.id} containerId={field.containerId} className={props.className}
    label={field.label} help={field.help} error={props.error} action={props.action}>{control}</Field>;
}
