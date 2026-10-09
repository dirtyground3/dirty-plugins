import { React, ui } from "../runtime";
import type { Rule } from "../types";
export interface WorkflowDialogsProps {
  confirm: boolean; removing?: Rule; readyCount: number; excluded: string[];
  actions: { resize: number; reencode: number; delete: number }; review: boolean;
  busy: boolean; dirty: boolean; onReview(value: boolean): void;
  onCloseRun(): void; onCloseRemove(): void; onStart(): void; onRemove(): void;
}
export function WorkflowDialogs(props: WorkflowDialogsProps) {
  const { confirm, removing, readyCount, excluded, actions, review, busy, dirty,
    onCloseRun, onCloseRemove, onStart, onRemove } = props;
  return <React.Fragment>
    <ui.Dialog open={confirm} ariaLabel="Confirm manual run" onClose={() => { onCloseRun(); }} className="dirty-ui-panel dirty-compactor-confirm">
      <h2>{"Run " + Math.max(0, readyCount - excluded.length) + " operations?"}</h2>
      <p>
        {"Resize " + actions.resize + " · Reencode " + actions.reencode + " · "}
        <span className={actions.delete ? "dirty-compactor-danger" : undefined}>{"Delete " + actions.delete + " scenes"}</span>
        {excluded.length ? " · " + excluded.length + " scenes excluded" : ""}
      </p>
      {actions.delete > 0 && (<p className="dirty-compactor-danger">Deleted scenes and their files are removed through Stash.</p>)}
      <ui.SettingsToggle checked={review} label="Let me check each encoded file before it replaces the original" onChange={props.onReview} />
      <p className="dirty-compactor-muted">{review ? "The run pauses after each encoded file until you accept or discard it." : "Smaller, validated outputs replace the originals automatically."}</p>
      <div className="dirty-ui-control-row">
        <ui.Button onClick={onCloseRun}>Cancel</ui.Button>
        <ui.Button tone={actions.delete ? "danger" : "primary"} disabled={Boolean(busy) || dirty} onClick={() => { onStart(); }}>Start run</ui.Button>
      </div>
    </ui.Dialog>
    <ui.Dialog open={Boolean(removing)} ariaLabel="Delete rule" onClose={() => { onCloseRemove(); }} className="dirty-ui-panel dirty-compactor-confirm">
      <h2>{"Delete rule “" + (removing?.name || "") + "”?"}</h2>
      <p>Only the rule is removed. Media files are not affected.</p>
      <div className="dirty-ui-control-row">
        <ui.Button onClick={onCloseRemove}>Cancel</ui.Button>
        <ui.Button tone="danger" onClick={onRemove}>Delete rule</ui.Button>
      </div>
    </ui.Dialog>
  </React.Fragment>;
}
