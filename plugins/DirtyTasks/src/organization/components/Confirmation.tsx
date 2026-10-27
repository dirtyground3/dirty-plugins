import { React, ui } from "../runtime";
import { type Workflow } from "../workflow";
export function Confirmation({ workflow }: { workflow: Workflow }) {
  const { draft, preview, busy, confirming, approve } = workflow.state;
  const summary = preview?.summary || {},
    readyCount = summary.ready || 0,
    trigger = draft.automationMode !== "manual";
  return (
    <ui.Dialog
      open={confirming && Boolean(preview)}
      ariaLabel="Confirm organization plan"
      onClose={() => workflow.view({ confirming: false })}
      className="dirty-ui-panel dirty-tidy-confirm-dialog"
    >
      <h2>
        {readyCount
          ? "Apply " + readyCount + (readyCount === 1 ? " file operation?" : " file operations?")
          : "Approve automation?"}
      </h2>
      {readyCount > 0 && (
        <p>
          {"Move " + (summary.moves || 0) + " · Rename " + (summary.renames || 0)}
          {summary.blocked ? (
            <span className="dirty-ui-text-error">{" · " + summary.blocked + " blocked files are skipped"}</span>
          ) : (
            ""
          )}
        </p>
      )}
      <p className="dirty-tidy-help">
        {readyCount
          ? "The strategy is saved first. Files are moved through Stash; progress appears in Tasks."
          : "The strategy is saved and approved for the scheduled organization actions."}
      </p>
      {trigger && readyCount > 0 && (
        <ui.SettingsToggle
          checked={approve}
          label="Approve the scheduled organization actions"
          onChange={value => workflow.view({ approve: value })}
        />
      )}
      <div className="dirty-ui-control-row">
        <ui.Button onClick={() => workflow.view({ confirming: false })}>Cancel</ui.Button>
        {trigger && readyCount > 0 && approve && (
          <ui.Button disabled={Boolean(busy)} onClick={() => workflow.applyPlan(false)}>
            Approve without running
          </ui.Button>
        )}
        <ui.Button
          tone={readyCount ? "danger" : "primary"}
          busy={busy === "apply"}
          disabled={Boolean(busy)}
          onClick={() => workflow.applyPlan(readyCount > 0)}
        >
          {readyCount ? "Run now" : "Approve"}
        </ui.Button>
      </div>
    </ui.Dialog>
  );
}
