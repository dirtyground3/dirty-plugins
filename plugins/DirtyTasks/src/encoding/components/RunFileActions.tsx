import { React, ui } from "../runtime";
import type { Act, FileActionMode, WorkflowRecord } from "../types";

export function RunFileActions({ record, busy, onAction }: { record: WorkflowRecord; busy: boolean; onAction: Act }) {
  const [confirm, setConfirm] = React.useState(false);
  const [retry, setRetry] = React.useState(false);
  const action = record.fileAction;
  const pending = action?.status === "queued" || action?.status === "running";
  const available = record.fileActions;
  function start(mode: FileActionMode, recover = false) {
    if (mode === "deleteOriginals") {
      setRetry(recover);
      setConfirm(true);
    } else {
      onAction(mode, { id: record.id, retry: recover });
    }
  }
  return (
    <div className="dirty-compactor-file-actions">
      <div className="dirty-ui-control-row">
        <ui.Button disabled={busy || pending || !available?.makePrimary} onClick={() => start("makePrimary")}>
          Make all new files primary
        </ui.Button>
        <ui.Button
          tone="danger"
          disabled={busy || pending || !available?.deleteOriginals}
          onClick={() => start("deleteOriginals")}
        >
          Delete all old files…
        </ui.Button>
        {pending && (
          <ui.ActionMenu
            ariaLabel="File action recovery"
            items={[
              {
                label: "Recover interrupted file action",
                disabled: busy,
                onSelect: () => start(action.mode, true),
              },
            ]}
          />
        )}
      </div>
      {available?.error && <p role="status">{available.error}</p>}
      <p className="dirty-compactor-muted">
        Applies to successful encodes in this job, across all pages. Each scene keeps one primary file; files already
        primary are skipped.
      </p>
      {action && (
        <div role="status" aria-live="polite">
          <p>
            {(action.mode === "makePrimary" ? "Make primary" : "Delete old files") +
              ": " +
              action.status +
              " · " +
              action.changed +
              " changed · " +
              action.skipped +
              " skipped · " +
              action.failed +
              " failed"}
          </p>
          {action.reasons.length > 0 && (
            <ul>
              {action.reasons.map(([reason, count]) => (
                <li key={reason}>{count + " · " + reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ui.Dialog
        open={confirm}
        ariaLabel="Delete this job's original files"
        onClose={() => setConfirm(false)}
        className="dirty-ui-panel dirty-compactor-confirm"
      >
        <h2>Delete all old files from this job?</h2>
        <p>
          Deletes originals with successful encodes from Stash and disk, using Stash’s configured trash setting. Each
          replacement is checked first. Shared or changed files are skipped.
        </p>
        <p>If an old file is still primary, its new version is made primary before deletion.</p>
        <div className="dirty-ui-control-row">
          <ui.Button onClick={() => setConfirm(false)}>Keep old files</ui.Button>
          <ui.Button
            tone="danger"
            disabled={busy || (!retry && !available?.deleteOriginals)}
            onClick={() => {
              setConfirm(false);
              onAction("deleteOriginals", { id: record.id, confirmed: true, retry });
            }}
          >
            Delete old files
          </ui.Button>
        </div>
      </ui.Dialog>
    </div>
  );
}
