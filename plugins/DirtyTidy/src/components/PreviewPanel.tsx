import { React, ui } from "../runtime";
import { previewSlice } from "../domain/preview";
import { TRIGGER_LABELS, type Workflow } from "../workflow";
import { PreviewTable } from "./PreviewTable";
import { Summary } from "./Summary";
export function PreviewPanel({ workflow }: { workflow: Workflow }) {
  const { preview, draft, busy, previewFilter, previewPage, showFiles } = workflow.state;
  const page = React.useMemo(() => previewSlice(preview, previewFilter, previewPage), [preview, previewFilter, previewPage]);
  if (!preview) return null;
  const summary = preview.summary || {}, readyCount = summary.ready || 0, trigger = TRIGGER_LABELS[draft.automationMode];
  return <ui.SettingsSection className="dirty-tidy-preview" title="Preview"
    description={workflow.dirty() ? "Uses unsaved changes; they're saved when you run. Nothing has changed yet." : "Nothing has changed yet."}>
    <Summary disabled={Boolean(busy)} onChange={workflow.changePreviewFilter} summary={summary} total={preview.total} value={previewFilter} />
    <div className="dirty-ui-control-row dirty-tidy-preview-actions">
      <ui.Button tone="quiet" pressed={showFiles} onClick={() => workflow.view({ showFiles: !showFiles })}>{showFiles ? "Hide files" : "Show files"}</ui.Button>
      <span className="dirty-ui-spacer" /><ui.Button tone="quiet" onClick={workflow.discard}>Discard</ui.Button>
      <ui.Button tone="primary" disabled={Boolean(busy) || (!readyCount && !trigger)} onClick={workflow.openConfirmation}>
        {readyCount ? "Run " + readyCount + (readyCount === 1 ? " operation…" : " operations…") : trigger ? "Approve automation…" : "Nothing to run"}
      </ui.Button>
    </div>
    {showFiles && <React.Fragment><PreviewTable operations={page.visible} />
      {page.pages > 1 && <ui.Pagination className="dirty-tidy-pagination" ariaLabel="Preview pages" page={previewPage} totalPages={page.pages}
        onPageChange={value => workflow.view({ previewPage: value })} summary={"Page " + previewPage + " of " + page.pages + " · " + page.total + " matching"} />}
    </React.Fragment>}
  </ui.SettingsSection>;
}
