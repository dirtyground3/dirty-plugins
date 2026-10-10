import { State } from "./Chart";
import { normalizeFilter } from "../domain/dashboard";
import { docsCaptureEnabled } from "../domain/filters";
import { React, api, filterBridge, hub, ui } from "../runtime";
import { statsThemeClass } from "../settings";
import type * as R from "react";
import type { FilterChooserProps, FilterDialogProps } from "../props";
import type { SavedFilter } from "../runtime";
export function DashboardFilterChooser(props: FilterChooserProps): R.ReactElement | null {
  const docsCapture = docsCaptureEnabled(window.location.search);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState("");
  const changeRef = React.useRef(props.onChange);
  changeRef.current = props.onChange;
  React.useEffect(() => {
    if (docsCapture) return;
    let active = true;
    filterBridge.activeEntity = props.entity;
    const listener = (entity: string, filter: SavedFilter) => {
      if (active && entity === props.entity) changeRef.current(normalizeFilter(filter));
    };
    filterBridge.listener = listener;
    (async () => {
      const componentName = props.entity === "performers" ? "FilteredPerformerList" : "FilteredSceneList";
      const loadableName = props.entity === "performers" ? "Performers" : "SceneList";
      await hub.native.ensureComponents(loadableName, [componentName]);
      if (active) setReady(true);
    })().catch(loadError => {
      if (active) setError(loadError.message || String(loadError));
    });
    return () => {
      active = false;
      if (filterBridge.listener === listener) {
        filterBridge.activeEntity = null;
        filterBridge.listener = null;
      }
    };
  }, [props.entity, docsCapture]);
  if (docsCapture)
    return (
      <div className="dirty-stats-dashboard-native-filter dirty-stats-capture-filter" role="note">
        Native filter results are hidden while capturing documentation.
      </div>
    );
  if (error) return <State title="Filters unavailable" detail={error} role="alert" />;
  if (!ready) return <State title={"Loading " + props.entity + " filters…"} />;
  const FilteredList =
    props.entity === "performers" ? api.components.FilteredPerformerList : api.components.FilteredSceneList;
  return (
    <div className="dirty-stats-dashboard-native-filter dirty-stats-native-filters">
      <FilteredList
        key={props.filterKey}
        view={props.entity}
        alterQuery={false}
        extraCriteria={{ dirtyStatsDashboardFilter: true }}
      />
    </div>
  );
}

export function DashboardFilterDialog(props: FilterDialogProps): R.ReactElement | null {
  return (
    <ui.Dialog
      backdropClassName={"dirty-stats-dashboard-dialog-backdrop " + statsThemeClass()}
      className="dirty-stats-dashboard-filter-dialog dirty-ui-panel"
      labelledBy={props.labelId}
      allowNativePopup={true}
      onClose={props.onClose}
    >
      <header className="dirty-stats-dashboard-dialog-header">
        <h2 id={props.labelId}>{props.title}</h2>
        <button
          type="button"
          className="dirty-ui-icon-button dirty-ui-icon-button-compact"
          onClick={props.onClose}
          aria-label="Close filter dialog"
        >
          ×
        </button>
      </header>
      {props.children}
    </ui.Dialog>
  );
}
