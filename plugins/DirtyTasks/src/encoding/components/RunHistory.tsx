import { React, ui } from "../runtime";
import { createdFiles } from "../domain/rules";
import type { WorkflowRecord } from "../types";
function outcome(run: WorkflowRecord): string {
  return run.addedBytes
    ? " · " +
        createdFiles(run.addedBytes, run.originalBytes || 0, (run.counts && run.counts.completed) || 1).toLowerCase()
    : "";
}
export function RunHistory({ history, onSelect }: { history: WorkflowRecord[]; onSelect(id: string): void }) {
  if (!history.length) return null;
  const last = history[0];
  return (
    <details className="dirty-compactor-history">
      <summary>
        {"Run history · last " + new Date((last.created || 0) * 1000).toLocaleDateString() + outcome(last)}
      </summary>
      <ul>
        {history.map(item => {
          return (
            <li key={item.id}>
              <ui.Button
                tone="quiet"
                compact
                onClick={() => {
                  onSelect(item.id);
                }}
              >
                {new Date((item.created || 0) * 1000).toLocaleString()}
              </ui.Button>
              <span className="dirty-compactor-muted">
                {(item.automatic ? "Automatic" : "Manual") + " · " + item.status + outcome(item)}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
