import { React, ui } from "../runtime";
import { bytes } from "../domain/rules";
import type { WorkflowRecord } from "../types";
export function RunHistory({ history, onSelect }: { history: WorkflowRecord[]; onSelect(id: string): void }) {
  if (!history.length) return null;
  const last = history[0];
  return (
    <details className="dirty-compactor-history">
      <summary>
        {"Run history · last " +
          new Date((last.created || 0) * 1000).toLocaleDateString() +
          " · " +
          bytes(last.actualSavings) +
          " reclaimed"}
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
                {(item.automatic ? "Automatic" : "Manual") +
                  " · " +
                  item.status +
                  " · " +
                  bytes(item.actualSavings) +
                  " reclaimed"}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
