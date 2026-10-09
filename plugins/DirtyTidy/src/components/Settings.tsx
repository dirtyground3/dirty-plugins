import { React, ui } from "../runtime";
import { AUTOMATION_HELP, TRIGGER_LABELS } from "../workflow";
import { useWorkflow } from "../useWorkflow";
import { FolderStrategy } from "./FolderStrategy";
import { FilenameStrategy } from "./FilenameStrategy";
import { PreviewPanel } from "./PreviewPanel";
import { Confirmation } from "./Confirmation";
import type { AutomationMode, Lifetime, SettingsProps } from "../types";
export function Settings(props: SettingsProps & { lifetime: Lifetime }) {
  const workflow = useWorkflow(props, props.lifetime);
  const { draft, busy, status, error, destroyed } = workflow.state;
  const dirty = workflow.dirty(), trigger = TRIGGER_LABELS[draft.automationMode], approved = Boolean(draft.approvedStrategyHash);
  if (destroyed) return null;
  return <div className="dirty-tidy"><div className="dirty-ui-toolbar"><h3>Strategy</h3>
    <select aria-label="DirtyTidy automation mode" className="form-control dirty-ui-select dirty-tidy-automation" disabled={Boolean(busy)}
      onChange={event => workflow.changed({ automationMode: event.target.value as AutomationMode }, false)} title={AUTOMATION_HELP} value={draft.automationMode}>
      <option value="manual">Manual only</option><option value="scan">Run after Scan</option><option value="generate">Run after Generate</option>
    </select>
    {trigger && <ui.Badge className={approved ? "dirty-tidy-approved" : "dirty-tidy-unapproved"}
      title={approved ? "Approved for the current strategy, including future scenes." : "Preview the strategy and approve it when you run it."}>
      {approved ? "Approved" : "Needs approval"}</ui.Badge>}
    <ui.SaveStatus state={dirty ? "pending" : "saved"} message={dirty ? "Unsaved changes" : "Saved"} /><span className="dirty-ui-spacer" />
    <ui.Button disabled={Boolean(busy) || !dirty} busy={busy === "save"} onClick={workflow.saveStrategy}>Save</ui.Button>
    <ui.Button tone="primary" busy={busy === "preview"} disabled={Boolean(busy) || (!draft.moveEnabled && !draft.renameEnabled)} onClick={workflow.generatePreview}>Preview</ui.Button>
  </div>
    {error && <div className="dirty-tidy-message dirty-ui-text-error" role="alert">{error}</div>}
    {status && <div className="dirty-tidy-message" role="status">{status}</div>}
    <div className="dirty-ui-row-list"><FolderStrategy workflow={workflow} /><FilenameStrategy workflow={workflow} /></div>
    <PreviewPanel workflow={workflow} /><Confirmation workflow={workflow} />
  </div>;
}
