import { React, ui } from "../runtime";
import type { ReactNode } from "react";
export interface StrategyRowProps {
  title: string;
  detail: string;
  enabled: boolean;
  open: boolean;
  children?: ReactNode;
  trigger?: ReactNode;
  onEnabled(value: boolean): void;
  onToggle(): void;
}
export function StrategyRow(props: StrategyRowProps) {
  return (
    <div className={"dirty-ui-row" + (props.open ? " is-open" : "") + (props.enabled ? "" : " is-off")}>
      <div className="dirty-ui-row-main">
        <ui.SettingsToggle
          checked={props.enabled}
          label={<span className="sr-only">{props.title}</span>}
          onChange={props.onEnabled}
        />
        <button type="button" className="dirty-ui-row-summary" aria-expanded={props.open} onClick={props.onToggle}>
          <span className="dirty-ui-row-title">{props.title}</span>
          <span className="dirty-ui-row-detail dirty-tidy-template">{props.enabled ? props.detail : "Off"}</span>
        </button>
        {props.trigger}
      </div>
      {props.open && <div className="dirty-ui-row-editor">{props.children}</div>}
    </div>
  );
}
