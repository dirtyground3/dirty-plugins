import { React, ui } from "../runtime";
import { bytes, timeLeft } from "../domain/rules";
import { OperationTable } from "./OperationTable";
import type { ReactNode } from "react";
import type { WorkflowRecord } from "../types";
export interface ResultsProps {
  kind: "preview" | "run";
  record: WorkflowRecord;
  title: string;
  description: string;
  onPage(page: number): void;
  capture: boolean;
  excluded?: string[];
  onExclude?(id: string, remove: boolean): void;
  actions?: ReactNode;
}
export function Results(props: ResultsProps) {
  const { useState } = React;
  let record = props.record,
    counts = record.counts || {};
  const [showFiles, setShowFiles] = useState(false);
  let skipped = (counts.blocked || 0) + (counts.unchanged || 0) + (counts.manual || 0);
  let metrics =
    props.kind === "preview"
      ? [
          ["Ready", (counts.ready || 0) + (counts.ready === 1 ? " file" : " files")],
          ["Estimated savings", bytes(record.estimatedSavings)],
          ["Skipped", String(skipped)],
        ]
      : [
          ["Done", (counts.completed || 0) + " of " + record.total],
          [
            (record.libraryBytesRemoved || 0) > 0 ? "Reclaimed · removed" : "Reclaimed",
            bytes(record.actualSavings) +
              ((record.libraryBytesRemoved || 0) > 0 ? " · " + bytes(record.libraryBytesRemoved) : ""),
          ],
          ["Failed", String(counts.failed || 0)],
        ];
  return (
    <ui.SettingsSection className="dirty-compactor-results" title={props.title} description={props.description}>
      {record.error && <ui.StateView title="Planning failed" detail={record.error} />}
      {record.progress && (
        <div className="dirty-compactor-progress" role="status">
          <span>{record.progress.stage}</span>
          <progress max="1" value={record.progress.progress} />
          <span>
            {Math.round(record.progress.progress * 100) +
              "%" +
              (record.progress.eta != null
                ? " · " + timeLeft(record.progress.eta)
                : props.kind === "preview"
                  ? " · estimating time left…"
                  : "")}
          </span>
        </div>
      )}
      {record.status !== "planning" && (
        <div className="dirty-compactor-metrics">
          {metrics.map(item => (
            <ui.Metric key={item[0]} label={item[0]} value={item[1]} />
          ))}
        </div>
      )}
      {props.kind === "preview" && skipped > 0 && (
        <div className="dirty-compactor-skipped">
          <span>{"Why " + skipped + (skipped === 1 ? " file was" : " files were") + " skipped"}</span>
          <ul>
            {(record.skipReasons || []).slice(0, 5).map(item => (
              <li key={item[0]}>
                <strong>{String(item[1])}</strong>
                {" " + item[0]}
              </li>
            ))}
          </ul>
          {(record.skipReasons || []).length > 5 && (
            <span className="dirty-compactor-muted">Show files for the rest.</span>
          )}
        </div>
      )}
      {(record.libraryBytesRemoved || 0) > 0 && (
        <p className="dirty-compactor-muted">Deleted files may stay on disk depending on Stash's trash settings.</p>
      )}
      <div className="dirty-ui-control-row dirty-compactor-results-actions">
        {record.total > 0 && (
          <ui.Button
            tone="quiet"
            pressed={showFiles}
            onClick={() => {
              setShowFiles(!showFiles);
            }}
          >
            {showFiles ? "Hide files" : "Show files"}
          </ui.Button>
        )}
        <span className="dirty-ui-spacer" />
        {props.actions}
      </div>
      {showFiles && (
        <OperationTable
          record={record}
          capture={props.capture}
          excluded={props.excluded}
          onExclude={props.onExclude}
          onPage={props.onPage}
        />
      )}
    </ui.SettingsSection>
  );
}
