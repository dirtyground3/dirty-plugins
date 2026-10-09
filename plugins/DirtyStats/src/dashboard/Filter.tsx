import type * as R from "react";
import type { DashboardDependencies } from "../dashboardView";
import type { FilterChooserProps, FilterDialogProps } from "../props";
import type { SavedFilter } from "../runtime";
export function createDashboardFilter(dependencies: DashboardDependencies) {
  const { normalizeFilter, State, api, hub, React, algorithms, sharedReact, filterBridge } = dependencies;
  function DashboardFilterChooser(props: FilterChooserProps): R.ReactElement | null {
    var docsCapture = algorithms.docsCaptureEnabled(window.location.search);
    var readyState = React.useState(false), ready = readyState[0], setReady = readyState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var changeRef = React.useRef(props.onChange);
    changeRef.current = props.onChange;
    React.useEffect(function () {
      if (docsCapture) return;
      var active = true;
      filterBridge.activeEntity = props.entity;
      const listener = function (entity: string, filter: SavedFilter) {
        if (active && entity === props.entity) changeRef.current(normalizeFilter(filter));
      };
      filterBridge.listener = listener;
      (async function () {
        var componentName = props.entity === "performers" ? "FilteredPerformerList" : "FilteredSceneList";
        var loadableName = props.entity === "performers" ? "Performers" : "SceneList";
        await hub.native.ensureComponents(loadableName, [componentName]);
        if (active) setReady(true);
      })().catch(function (loadError) { if (active) setError(loadError.message || String(loadError)); });
      return function () {
        active = false;
        if (filterBridge.listener === listener) { filterBridge.activeEntity = null; filterBridge.listener = null; }
      };
    }, [props.entity, docsCapture]);
    if (docsCapture) return (<div className="dirty-stats-dashboard-native-filter dirty-stats-capture-filter" role="note">

      {"Native filter results are hidden while capturing documentation."}

    </div>);
    if (error) return (<State title="Filters unavailable" detail={error} role="alert" />);
    if (!ready) return (<State title={"Loading " + props.entity + " filters…"} />);
    var FilteredList = props.entity === "performers" ? api.components.FilteredPerformerList : api.components.FilteredSceneList;
    return (<div className="dirty-stats-dashboard-native-filter dirty-stats-native-filters">

      <FilteredList
        key={props.filterKey}
        view={props.entity}
        alterQuery={false}
        extraCriteria={{ dirtyStatsDashboardFilter: true }} />

    </div>);
  }

  function DashboardFilterDialog(props: FilterDialogProps): R.ReactElement | null {
    return (<sharedReact.Dialog
      backdropClassName={"dirty-stats-dashboard-dialog-backdrop " + algorithms.statsThemeClass()}
      className="dirty-stats-dashboard-filter-dialog dirty-ui-panel"
      labelledBy={props.labelId}
      allowNativePopup={true}
      onClose={props.onClose}>

      <header className="dirty-stats-dashboard-dialog-header">

        <h2 id={props.labelId}>

          {props.title}

        </h2>

        <button
          type="button"
          className="dirty-ui-icon-button dirty-ui-icon-button-compact"
          onClick={props.onClose}
          aria-label="Close filter dialog">

          {"×"}

        </button>

      </header>

      {props.children}

    </sharedReact.Dialog>);
  }
  return { DashboardFilterChooser, DashboardFilterDialog };
}
