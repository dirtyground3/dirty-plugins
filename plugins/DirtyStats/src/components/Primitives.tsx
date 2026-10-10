import { React, hub, ui } from "../runtime";
import {
  getSaveStatus,
  getSaveStatusRevision,
  scheduleStatsSettingsSave,
  subscribeSaveStatus,
  themeColor,
} from "../settings";
import type * as R from "react";
import type { StateProps } from "../props";
import type { ChartInstance } from "../types";
export function StatsSaveStatus(): R.ReactElement | null {
  const [, setRevision] = React.useState(getSaveStatusRevision());
  React.useEffect(() => {
    const listener = () => {
      setRevision(getSaveStatusRevision());
    };
    const unsubscribe = subscribeSaveStatus(listener);
    return () => {
      unsubscribe();
    };
  }, [setRevision]);
  if (!getSaveStatus().message) return null;
  return (
    <div className="dirty-stats-save-feedback">
      <hub.react.SaveStatus {...getSaveStatus()} />
      {getSaveStatus().state === "error" ? (
        <hub.react.Button compact={true} onClick={scheduleStatsSettingsSave}>
          Retry
        </hub.react.Button>
      ) : null}
    </div>
  );
}

// The hub always provides ui.StateView (the runtime check requires it).
export function StatsState(props: StateProps): R.ReactElement | null {
  return (
    <ui.StateView
      actions={props.actions}
      className={props.className}
      detail={props.detail}
      role={props.role}
      title={props.title}
    />
  );
}

export function download(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function refreshButton(loading: boolean, refresh: () => void) {
  return (
    <button className="btn btn-secondary dirty-ui-button" disabled={loading} onClick={refresh}>
      Refresh
    </button>
  );
}

export function pageToolbar(summary: string, loading: boolean, refresh: () => void) {
  return (
    <div className="dirty-stats-toolbar">
      <span className="dirty-stats-summary" role="status">
        {summary}
      </span>
      {refreshButton(loading, refresh)}
    </div>
  );
}

export function exportButton(chartRef: R.MutableRefObject<ChartInstance | null>, filename: string, disabled?: boolean) {
  return (
    <button
      className="btn btn-secondary dirty-ui-button dirty-stats-export"
      disabled={disabled}
      onClick={() => {
        if (chartRef.current)
          download(
            chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: themeColor("background") }),
            filename,
          );
      }}
    >
      Export PNG
    </button>
  );
}

export function chartImage(node: R.RefObject<HTMLDivElement>, className: string, label: string) {
  return <div ref={node} className={className} role="img" aria-label={label} />;
}
