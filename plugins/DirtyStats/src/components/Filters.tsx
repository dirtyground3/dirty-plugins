import type * as R from "react";
import type { FilterCaptureProps, SelectorProps } from "../props";
import type { SavedFilter, StatsFilter } from "../runtime";
import type { ViewDependencies } from "../view";
export function createFilters(dependencies: ViewDependencies) {
  const { statsThemeClass, nativeFilterQuery, restoredPerformerFilter, serializeDashboardFilter, performerVariables, getStatsSettingExtra, setStatsSettingExtra, api, hub, React, ageRoute, performerFilterEvent, STATISTIC_ROUTES, STATISTIC_LABELS, STATISTIC_ORDER, filterBridge } = dependencies;
  let agePerformerFilter: StatsFilter | null = null;
  function StatisticSelector(props: SelectorProps): R.ReactElement | null {
    const history = api.libraries.ReactRouterDOM.useHistory();
    return (<hub.react.StatisticSelector
      id="dirty-stats-statistic"
      className="dirty-stats-selector"
      value={props.value}
      options={STATISTIC_ORDER.map(key => ({ value: key, label: STATISTIC_LABELS[key] }))}
      onSelect={value => { if (STATISTIC_ROUTES[value]) history.push(hub.captureUrl(STATISTIC_ROUTES[value])); }} />);
  }

  function FilterStatisticSelector(props: SelectorProps & { page: R.RefObject<HTMLElement> }): R.ReactElement | null {
    const [toolbar, setToolbar] = React.useState<Element | null>(null);
    React.useEffect(() => {
      const root = props.page.current;
      if (!root) return;
      function findToolbar() { setToolbar(root!.querySelector(".filtered-list-toolbar")); }
      findToolbar();
      const observer = new MutationObserver(findToolbar);
      observer.observe(root, { childList: true, subtree: true });
      return () => { observer.disconnect(); };
    }, [props.value]);
    const selector = (<div className="dirty-stats-filter-statistic">
      <StatisticSelector value={props.value} />
      {props.value === "ages" ? (<AgePerformerControls />) : null}
    </div>);
    return toolbar && props.page.current && props.page.current.contains(toolbar) ? api.ReactDOM.createPortal(selector, toolbar) : selector;
  }

  function useAgePerformerFilter() {
    const [model, setModel] = React.useState(() => agePerformerFilter || restoredPerformerFilter());
    React.useEffect(() => {
      function changed() { setModel(agePerformerFilter || restoredPerformerFilter()); }
      window.addEventListener(performerFilterEvent, changed); changed();
      return () => { window.removeEventListener(performerFilterEvent, changed); };
    }, []);
    return model;
  }

  function PerformerFilterCapture(props: FilterCaptureProps): R.ReactElement | null {
    const key = JSON.stringify(performerVariables(props.filter, 1));
    const location = api.libraries.ReactRouterDOM.useLocation();
    const query = nativeFilterQuery(props.filter.makeQueryParameters?.());
    React.useEffect(() => {
      // Native lists first render their defaults, then hydrate from the URL.
      // Save only the hydrated model so opening the dialog preserves its filters.
      if (nativeFilterQuery(location.search) !== query) return;
      agePerformerFilter = props.filter;
      const saved = getStatsSettingExtra<SavedFilter | null>("agePerformerFilter", null);
      if (!saved || nativeFilterQuery(saved.query) !== query) setStatsSettingExtra("agePerformerFilter", serializeDashboardFilter(props.filter));
      window.dispatchEvent(new Event(performerFilterEvent));
    }, [key, location.search, query]);
    return null;
  }

  function DashboardFilterCapture(props: FilterCaptureProps): R.ReactElement | null {
    const value = serializeDashboardFilter(props.filter);
    const key = JSON.stringify(value);
    React.useEffect(() => {
      if (typeof filterBridge.listener === "function") filterBridge.listener(props.entity!, value);
    }, [props.entity, key]);
    return null;
  }

  function AgePerformerControls(): R.ReactElement | null {
    const [open, setOpen] = React.useState(false);
    const model = useAgePerformerFilter(), close = React.useRef<HTMLButtonElement>(null), trigger = React.useRef<HTMLButtonElement>(null);
    const count = model ? model.count() + (model.makeFindFilter().q ? 1 : 0) : 0;
    return (<React.Fragment>
      <button
        ref={trigger}
        type="button"
        className="btn btn-secondary dirty-ui-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true); }}>
        {"Performer filters" + (count ? " (" + count + ")" : "")}
      </button>
      <hub.react.Dialog
        open={open}
        id="dirty-stats-performer-dialog"
        backdropClassName={"dirty-stats-performer-overlay " + statsThemeClass()}
        backdrop={(<div className="dirty-stats-performer-backdrop" onClick={() => { setOpen(false); }} />)}
        className="dirty-stats-performer-dialog dirty-stats-page dirty-stats-native-filters"
        ariaLabel="Performer filters"
        initialFocusRef={close}
        openerRef={trigger}
        allowNativePopup={true}
        onClose={() => { setOpen(false); }}>
        <div className="dirty-stats-toolbar">
          <h2 className="h5">
            Performer filters
          </h2>
          <button
            ref={close}
            type="button"
            className="btn btn-secondary dirty-ui-button"
            onClick={() => { setOpen(false); }}>
            Done
          </button>
        </div>
        <p>
          Choose which performers contribute to the age histogram and cards. Scene filters remain active. Changes apply immediately.
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
