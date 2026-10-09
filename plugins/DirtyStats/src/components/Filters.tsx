import type * as R from "react";
import type { FilterCaptureProps, SelectorProps } from "../props";
import type { SavedFilter } from "../runtime";
import type { ViewDependencies } from "../view";
export function createFilters(dependencies: ViewDependencies) {
  const { statsThemeClass, nativeFilterQuery, restoredPerformerFilter, serializeDashboardFilter, performerVariables, getStatsSettingExtra, setStatsSettingExtra, api, hub, React, ageRoute, performerFilterEvent, STATISTIC_ROUTES, STATISTIC_LABELS, STATISTIC_ORDER, filterBridge } = dependencies;
  var agePerformerFilter: import("../runtime").StatsFilter | null = null;
  function StatisticSelector(props: SelectorProps): R.ReactElement | null {
    var history = api.libraries.ReactRouterDOM.useHistory();
    return (<hub.react.StatisticSelector
      id="dirty-stats-statistic"
      className="dirty-stats-selector"
      value={props.value}
      options={STATISTIC_ORDER.map(function (key) { return { value: key, label: STATISTIC_LABELS[key] }; })}
      onSelect={function (value) { if (STATISTIC_ROUTES[value]) history.push(hub.captureUrl(STATISTIC_ROUTES[value])); }} />);
  }

  function FilterStatisticSelector(props: SelectorProps & { page: R.RefObject<HTMLElement> }): R.ReactElement | null {
    var state = React.useState<Element | null>(null), toolbar = state[0], setToolbar = state[1];
    React.useEffect(function () {
      var root = props.page.current;
      if (!root) return;
      function findToolbar() { setToolbar(root!.querySelector(".filtered-list-toolbar")); }
      findToolbar();
      var observer = new MutationObserver(findToolbar);
      observer.observe(root, { childList: true, subtree: true });
      return function () { observer.disconnect(); };
    }, [props.value]);
    var selector = (<div className="dirty-stats-filter-statistic">

      <StatisticSelector value={props.value} />

      {props.value === "ages" ? (<AgePerformerControls />) : null}

    </div>);
    return toolbar && props.page.current && props.page.current.contains(toolbar) ? api.ReactDOM.createPortal(selector, toolbar) : selector;
  }

  function useAgePerformerFilter() {
    var state = React.useState(function () { return agePerformerFilter || restoredPerformerFilter(); }), model = state[0], setModel = state[1];
    React.useEffect(function () {
      function changed() { setModel(agePerformerFilter || restoredPerformerFilter()); }
      window.addEventListener(performerFilterEvent, changed); changed();
      return function () { window.removeEventListener(performerFilterEvent, changed); };
    }, []);
    return model;
  }

  function PerformerFilterCapture(props: FilterCaptureProps): R.ReactElement | null {
    var key = JSON.stringify(performerVariables(props.filter, 1));
    var location = api.libraries.ReactRouterDOM.useLocation();
    var query = nativeFilterQuery(props.filter.makeQueryParameters?.());
    React.useEffect(function () {
      // Native lists first render their defaults, then hydrate from the URL.
      // Save only the hydrated model so opening the dialog preserves its filters.
      if (nativeFilterQuery(location.search) !== query) return;
      agePerformerFilter = props.filter;
      var saved = getStatsSettingExtra<SavedFilter | null>("agePerformerFilter", null);
      if (!saved || nativeFilterQuery(saved.query) !== query) setStatsSettingExtra("agePerformerFilter", serializeDashboardFilter(props.filter));
      window.dispatchEvent(new Event(performerFilterEvent));
    }, [key, location.search, query]);
    return null;
  }

  function DashboardFilterCapture(props: FilterCaptureProps): R.ReactElement | null {
    var value = serializeDashboardFilter(props.filter);
    var key = JSON.stringify(value);
    React.useEffect(function () {
      if (typeof filterBridge.listener === "function") filterBridge.listener(props.entity!, value);
    }, [props.entity, key]);
    return null;
  }

  function AgePerformerControls(): R.ReactElement | null {
    var state = React.useState(false), open = state[0], setOpen = state[1];
    var model = useAgePerformerFilter(), close = React.useRef<HTMLButtonElement>(null), trigger = React.useRef<HTMLButtonElement>(null);
    var count = model ? model.count() + (model.makeFindFilter().q ? 1 : 0) : 0;
    return (<React.Fragment>

      <button
        ref={trigger}
        type="button"
        className="btn btn-secondary dirty-ui-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={function () { setOpen(true); }}>

        {"Performer filters" + (count ? " (" + count + ")" : "")}

      </button>

      <hub.react.Dialog
        open={open}
        id="dirty-stats-performer-dialog"
        backdropClassName={"dirty-stats-performer-overlay " + statsThemeClass()}
        backdrop={(<div className="dirty-stats-performer-backdrop" onClick={function () { setOpen(false); }} />)}
        className="dirty-stats-performer-dialog dirty-stats-page dirty-stats-native-filters"
        ariaLabel="Performer filters"
        initialFocusRef={close}
        openerRef={trigger}
        allowNativePopup={true}
        onClose={function () { setOpen(false); }}>

        <div className="dirty-stats-toolbar">

          <h2 className="h5">

            {"Performer filters"}

          </h2>

          <button
            ref={close}
            type="button"
            className="btn btn-secondary dirty-ui-button"
            onClick={function () { setOpen(false); }}>

            {"Done"}

          </button>

        </div>

        <p>

          {"Choose which performers contribute to the age histogram and cards. Scene filters remain active. Changes apply immediately."}

        </p>

        {open ? (<api.libraries.ReactRouterDOM.MemoryRouter
          initialEntries={[{ pathname: ageRoute, search: "?" + nativeFilterQuery((getStatsSettingExtra<Partial<SavedFilter>>("agePerformerFilter", {}) || {}).query || "") }]}>

          <api.components.FilteredPerformerList alterQuery={true} extraCriteria={{ dirtyStatsAgeFilters: true }} />

        </api.libraries.ReactRouterDOM.MemoryRouter>) : null}

      </hub.react.Dialog>

    </React.Fragment>);
  }
  return { StatisticSelector, FilterStatisticSelector, useAgePerformerFilter, PerformerFilterCapture, DashboardFilterCapture, AgePerformerControls };
}
