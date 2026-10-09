import { React, DirtyPlugins } from "../runtime";
import type { Operation } from "../types";
export function PreviewNotes({ operation }: { operation: Operation }) {
  const warnings = operation.warnings || [], blockedScenes = operation.blocked_scenes || [];
  if (DirtyPlugins.captureEnabled(window.location.search)) return warnings.length || blockedScenes.length ? <span>Details hidden for documentation</span> : null;
  return <div className="dirty-tidy-notes">{warnings.map((warning, index) => <div key={"warning-" + index}>{warning}</div>)}
    {blockedScenes.length > 0 && <div className="dirty-tidy-blocked-scenes"><span>{blockedScenes.length === 1 ? "Blocked scene: " : "Blocked scenes: "}</span>
      {blockedScenes.map((scene, index) => <React.Fragment key={scene.id}>{index > 0 && ", "}
        <a href={"/scenes/" + encodeURIComponent(scene.id)} title={"Open scene " + scene.id}>{scene.title || ("Scene " + scene.id)}</a>
      </React.Fragment>)}
    </div>}
  </div>;
}
export function PreviewTable({ operations }: { operations: Operation[] }) {
  const docsCapture = DirtyPlugins.captureEnabled(window.location.search);
  if (!operations.length) return <p className="dirty-tidy-empty">No operations match this filter.</p>;
  return <div className="dirty-tidy-preview-table-wrap dirty-ui-table-wrap"><table className="table table-sm dirty-tidy-preview-table dirty-ui-table">
    <thead><tr><th>Status</th><th>Current path</th><th>Proposed path</th><th>Notes</th></tr></thead>
    <tbody>{operations.map(operation => <tr key={operation.file_id} className={"dirty-tidy-row-" + operation.status}>
      <td><span className="badge dirty-ui-badge dirty-tidy-status">{operation.status}</span></td>
      <td className="dirty-tidy-path">{docsCapture ? "Path hidden" : operation.source_path}</td>
      <td className="dirty-tidy-path">{docsCapture ? "Path hidden" : operation.destination_path}</td>
      <td><PreviewNotes operation={operation} /></td>
    </tr>)}</tbody>
  </table></div>;
}
