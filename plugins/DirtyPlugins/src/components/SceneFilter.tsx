import { React } from "../runtime";
import type { FilterProps, HubNativeDependencies, NativeFilter, SceneCondition } from "../types";
export function createSceneFilter(dependencies: HubNativeDependencies) {
  var hubApi = dependencies.hubApi, PluginApi = dependencies.PluginApi;
  var Dialog = dependencies.Dialog, StateView = dependencies.StateView, Button = dependencies.Button;


  var sceneFilterListeners: Record<string, (value: SceneCondition) => void> = {};
  var activeSharedSceneFilter: string | null = null;
  function serializeSceneFilter(filter: NativeFilter) {
    var find = Object.assign({}, filter.makeFindFilter());
    delete find.page;
    delete find.per_page;
    var query = new URLSearchParams(filter.makeQueryParameters());
    query.delete("page");
    query.delete("per_page");
    return { find: find, scene: JSON.parse(JSON.stringify(filter.makeFilter() || {})), query: query.toString(), all: false };
  }
  function SharedSceneFilterCapture(props: { filter: NativeFilter; owner: string; }) {
    var value = serializeSceneFilter(props.filter);
    var key = JSON.stringify(value);
    React.useEffect(function() {
      var listener = sceneFilterListeners[props.owner];
      if (listener) listener(value);
    }, [props.owner, key]);
    return null;
  }
  function SceneFilterEditor(props: FilterProps) {
    var readyState = React.useState(false), ready = readyState[0], setReady = readyState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var candidate = React.useRef(props.value || {});
    var owner = React.useRef("filter-" + Math.random().toString(36).slice(2));
    var closeRef = React.useRef<HTMLButtonElement | null>(null);
    var callback = React.useRef(props.onChange);
    callback.current = props.onChange;
    React.useEffect(function() {
      if (!props.open) return undefined;
      var active = true;
      candidate.current = props.value || {};
      activeSharedSceneFilter = owner.current;
      sceneFilterListeners[owner.current] = function(value) { candidate.current = value; };
      hubApi.native.ensureComponents("SceneList", ["FilteredSceneList"]).then(function() {
        if (active) setReady(true);
      }).catch(function(failure) { if (active) setError(failure.message); });
      return function() {
        active = false; delete sceneFilterListeners[owner.current];
        if (activeSharedSceneFilter === owner.current) activeSharedSceneFilter = null;
      };
    }, [props.open]);
    function applyFilter() {
      callback.current(candidate.current); props.onClose();
    }
    var initialEntries = [{ pathname: "/scenes", search: "?" + ((props.value || {}).query || "") }];
    var body = error ? (<StateView
      title="Stash filters unavailable"
      detail={error}>

    </StateView>)
      : !ready ? (<StateView
        title="Loading filters…">

      </StateView>)
        : (<PluginApi.libraries.ReactRouterDOM.MemoryRouter
          initialEntries={initialEntries}>
          <PluginApi.components.FilteredSceneList
            alterQuery={true}
            extraCriteria={{ dirtySharedFilter: owner.current }}>

          </PluginApi.components.FilteredSceneList>
        </PluginApi.libraries.ReactRouterDOM.MemoryRouter>);
    return (<Dialog
      id="dirty-shared-scene-filter-dialog"
      open={props.open}
      ariaLabel="Scene filter"
      initialFocusRef={closeRef}
      allowNativePopup={true}
      onClose={props.onClose}
      className="dirty-ui-native-filter-dialog dirty-ui-panel"
      backdropClassName="dirty-ui-native-filter-overlay">
      <h2>
        {"Scene filter"}
      </h2>
      {body}
      <div
        className="dirty-ui-control-row">
        <Button
          onClick={props.onClose}
          buttonRef={closeRef}>
          {"Cancel"}
        </Button>
        <Button
          tone="primary"
          disabled={!ready || Boolean(error)}
          onClick={applyFilter}>
          {"Use filter"}
        </Button>
      </div>
    </Dialog>);
  }
  return { serialize: serializeSceneFilter, Capture: SharedSceneFilterCapture, Editor: SceneFilterEditor, activeOwner: function() { return activeSharedSceneFilter; } };
}
