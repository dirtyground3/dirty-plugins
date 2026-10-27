import { React, ui } from "../runtime";
import { useWorkflow } from "../useWorkflow";
import { FolderStrategy } from "./FolderStrategy";
import { FilenameStrategy } from "./FilenameStrategy";
import { PreviewPanel } from "./PreviewPanel";
import { Confirmation } from "./Confirmation";
import { TagUpdate } from "./TagUpdate";
import type { SettingsProps } from "../types";
export function Settings(props: SettingsProps) {
  const workflow = useWorkflow(props);
  const { draft, busy, status, error, destroyed } = workflow.state;
  const dirty = workflow.dirty(),
    trigger = draft.automationMode !== "manual",
    approved = Boolean(draft.approvedStrategyHash);
  if (destroyed) return null;
  return (
    <div className="dirty-tidy">
      <div className="dirty-ui-toolbar">
        <h3>Strategy</h3>
        {trigger && (
          <ui.Badge
            className={approved ? "dirty-tidy-approved" : "dirty-tidy-unapproved"}
            title={
              approved
                ? "Approved for the current strategy, including future scenes."
                : "Preview the strategy and approve it when you run it."
            }
          >
            {approved ? "Approved" : "Needs approval"}
          </ui.Badge>
        )}
        <ui.SaveStatus state={dirty ? "pending" : "saved"} message={dirty ? "Unsaved changes" : "Saved"} />
        <span className="dirty-ui-spacer" />
        <ui.Button disabled={Boolean(busy) || !dirty} busy={busy === "save"} onClick={workflow.saveStrategy}>
          Save
        </ui.Button>
        <ui.Button
          tone="primary"
          busy={busy === "preview"}
          disabled={Boolean(busy) || (!draft.moveEnabled && !draft.renameEnabled)}
          onClick={workflow.generatePreview}
        >
          Preview
        </ui.Button>
      </div>
      {error && (
        <div className="dirty-tidy-message dirty-ui-text-error" role="alert">
          {error}
        </div>
      )}
      {status && (
        <div className="dirty-tidy-message" role="status">
          {status}
        </div>
      )}
      <div className="dirty-ui-row-list">
        <FolderStrategy workflow={workflow} trigger={props.triggers?.move} />
        <FilenameStrategy workflow={workflow} trigger={props.triggers?.rename} />
        <TagUpdate workflow={workflow} trigger={props.triggers?.tags} />
      </div>
      <PreviewPanel workflow={workflow} />
      <Confirmation workflow={workflow} />
    </div>
  );
}
