import type * as R from "react";
import type { StateProps } from "../props";
import type { ChartInstance } from "../types";
import type { ViewDependencies } from "../view";
export function createPrimitives(dependencies: ViewDependencies) {
  const { themeColor, scheduleStatsSettingsSave, hub, React, StateView, getSaveStatusRevision, getSaveStatus, subscribeSaveStatus } = dependencies;
  function StatsSaveStatus(): R.ReactElement | null {
    const [, setRevision] = React.useState(getSaveStatusRevision());
    React.useEffect(() => {
      const listener = () => { setRevision(getSaveStatusRevision()); };
      const unsubscribe = subscribeSaveStatus(listener);
      return () => { unsubscribe(); };
    }, [setRevision]);
    if (!getSaveStatus().message) return null;
    return (<div className="dirty-stats-save-feedback">
      <hub.react.SaveStatus {...getSaveStatus()} />
      {getSaveStatus().state === "error" ? (<hub.react.Button compact={true} onClick={scheduleStatsSettingsSave}>
        Retry
      </hub.react.Button>) : null}
    </div>);
  }

  // The hub always provides StateView (the runtime check requires it).
  function StatsState(props: StateProps): R.ReactElement | null {
    return (<StateView
      actions={props.actions}
      className={props.className}
      detail={props.detail}
      role={props.role}
      title={props.title} />);
  }

  function download(url: string, filename: string) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function refreshButton(loading: boolean, refresh: () => void) {
    return (<button className="btn btn-secondary dirty-ui-button" disabled={loading} onClick={refresh}>
      Refresh
    </button>);
  }

  function pageToolbar(summary: string, loading: boolean, refresh: () => void) {
    return (<div className="dirty-stats-toolbar">
      <span className="dirty-stats-summary" role="status">
        {summary}
      </span>
      {refreshButton(loading, refresh)}
    </div>);
  }

  function exportButton(chartRef: R.MutableRefObject<ChartInstance | null>, filename: string, disabled?: boolean) {
    return (<button
      className="btn btn-secondary dirty-ui-button dirty-stats-export"
      disabled={disabled}
      onClick={() => {
        if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: themeColor("background") }), filename);
      }}>
      Export PNG
    </button>);
  }

  function chartImage(node: R.RefObject<HTMLDivElement>, className: string, label: string) {
    return (<div ref={node} className={className} role="img" aria-label={label} />);
  }
  return { StatsSaveStatus, StatsState, download, refreshButton, pageToolbar, exportButton, chartImage };
}
