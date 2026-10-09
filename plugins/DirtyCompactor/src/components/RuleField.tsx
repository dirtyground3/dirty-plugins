import { React, ui } from "../runtime";
import type { ReactNode, ChangeEvent } from "react";
import type { NumericDraft, Option } from "../types";
export function field(id: string, label: string, value: NumericDraft, change: (value: string) => void, options?: Option[], help?: string, action?: ReactNode) {
  let props = { value, onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { change(event.target.value); }, className: "form-control" + (options ? " dirty-ui-select" : "") };
  let control = options ? (<select {...props}>{options.map(item => (<option key={item[0]} value={item[0]}>{item[1]}</option>))}</select>) : (<input {...Object.assign(props, { type: /-(width|height|rate)$/.test(id) ? "number" : "text", step: "any" })} />);
  return (<ui.Field id={id} label={label} help={help} action={action}>{control}</ui.Field>);
}
export function hidden(text: string) { return (<span className="sr-only">{text}</span>); }
