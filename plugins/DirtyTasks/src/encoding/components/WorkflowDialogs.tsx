import { React, ui } from "../runtime";
import type { Rule } from "../types";
export interface WorkflowDialogsProps {
  confirm: boolean;
  removing?: Rule;
  readyCount: number;
  excluded: string[];
  actions: { resize: number; reencode: number };
  busy: boolean;
  dirty: boolean;
  onCloseRun(): void;
  onCloseRemove(): void;
  onStart(): void;
  onRemove(): void;
}
export function WorkflowDialogs(props: WorkflowDialogsProps) {
  return (
    <React.Fragment>
      <ui.Dialog
        open={props.confirm}
        ariaLabel="Confirm manual run"
        onClose={props.onCloseRun}
        className="dirty-ui-panel dirty-compactor-confirm"
      >
        <h2>Create encoded versions?</h2>
        <p>{"Preview: " + props.readyCount + " ready files."}</p>
        <p>
          {"Resize " +
            props.actions.resize +
            " · Reencode " +
            props.actions.reencode +
            (props.excluded.length ? " · " + props.excluded.length + " scenes excluded" : "")}
        </p>
        <p>
          Validated outputs are added to the same scenes. Both files stay on disk; originals remain the primary files.
        </p>
        <div className="dirty-ui-control-row">
          <ui.Button onClick={props.onCloseRun}>Cancel</ui.Button>
          <ui.Button tone="primary" disabled={props.busy || props.dirty} onClick={props.onStart}>
            Start run
          </ui.Button>
        </div>
      </ui.Dialog>
      <ui.Dialog
        open={Boolean(props.removing)}
        ariaLabel="Delete rule"
        onClose={props.onCloseRemove}
        className="dirty-ui-panel dirty-compactor-confirm"
      >
        <h2>{"Delete rule: " + (props.removing?.name || "") + "?"}</h2>
        <p>Only the rule is removed. Media files are not affected.</p>
        <div className="dirty-ui-control-row">
          <ui.Button onClick={props.onCloseRemove}>Cancel</ui.Button>
          <ui.Button tone="danger" onClick={props.onRemove}>
            Delete rule
          </ui.Button>
        </div>
      </ui.Dialog>
    </React.Fragment>
  );
}
