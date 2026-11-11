import { ensureComponents } from "../native";
import { PluginApi, React } from "../runtime";
import { withClass } from "../shared/values";
import type {
  FilterProps,
  NativeFilter,
  NativePatchArguments,
  NativePatchHandler,
  NativeSceneFilterProps,
  SceneCondition,
} from "../types";
import { Button, StateView } from "./Controls";
import { Dialog } from "./Dialog";

const listeners: Record<string, (value: SceneCondition) => void> = {};
let activeOwner: string | null = null;

export function serializeSceneFilter(filter: NativeFilter): SceneCondition {
  const find = Object.assign({}, filter.makeFindFilter());
  delete find.page;
  delete find.per_page;
  const query = new URLSearchParams(filter.makeQueryParameters());
  query.delete("page");
  query.delete("per_page");
  return { find, scene: JSON.parse(JSON.stringify(filter.makeFilter() || {})), query: query.toString(), all: false };
}

function SharedSceneFilterCapture(props: { filter: NativeFilter; owner: string }) {
  const value = serializeSceneFilter(props.filter),
    key = JSON.stringify(value);
  React.useEffect(() => {
    const listener = listeners[props.owner];
    if (listener) listener(value);
  }, [props.owner, key]);
  return null;
}

/** Replace the editor's native scene list with a capture of its filter. */
export function sceneListPatch(...args: NativePatchArguments) {
  const next = args.pop() as NativePatchHandler,
    props = args[0];
  let owner = props && props.extraCriteria && props.extraCriteria.dirtySharedFilter;
  // Stash 0.31's scene list does not forward extraCriteria to SceneList.
  // The editor is the only native scene list on suite plugin routes.
  if (!owner && activeOwner && window.location.pathname.indexOf("/plugins/") === 0) owner = activeOwner;
  if (!owner || !props.filter) return next.apply(null, args);
  return <SharedSceneFilterCapture owner={owner} filter={props.filter} />;
}

/**
 * Stash's own search, filter and saved-filter controls for scenes. Each change of their
 * filter is reported; the native results stay hidden so the caller shows its own.
 */
export function NativeSceneFilter(props: NativeSceneFilterProps) {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState("");
  const owner = React.useRef("filter-" + Math.random().toString(36).slice(2));
  const callback = React.useRef(props.onChange);
  callback.current = props.onChange;
  // The router starts from the given value; later changes come from the native controls.
  const [initialEntries] = React.useState(() => [{ pathname: "/scenes", search: "?" + (props.value?.query || "") }]);
  React.useEffect(() => {
    let active = true;
    activeOwner = owner.current;
    listeners[owner.current] = value => callback.current(value);
    ensureComponents("SceneList", ["FilteredSceneList"])
      .then(() => {
        if (active) setReady(true);
      })
      .catch(failure => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
      delete listeners[owner.current];
      if (activeOwner === owner.current) activeOwner = null;
    };
  }, []);
  return (
    <div className={withClass("dirty-ui-native-scene-filter", props.className)}>
      {error ? (
        <StateView title="Stash filters unavailable" detail={error} />
      ) : !ready ? (
        <StateView title="Loading filters…" />
      ) : (
        <PluginApi.libraries.ReactRouterDOM.MemoryRouter initialEntries={initialEntries}>
          <PluginApi.components.FilteredSceneList
            alterQuery={true}
            extraCriteria={{ dirtySharedFilter: owner.current }}
          />
        </PluginApi.libraries.ReactRouterDOM.MemoryRouter>
      )}
    </div>
  );
}

export function SceneFilterEditor(props: FilterProps) {
  const [captured, setCaptured] = React.useState(false);
  const candidate = React.useRef(props.value || {});
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const callback = React.useRef(props.onChange);
  callback.current = props.onChange;
  React.useEffect(() => {
    if (!props.open) return;
    candidate.current = props.value || {};
    setCaptured(false);
  }, [props.open]);
  function applyFilter() {
    callback.current(candidate.current);
    props.onClose();
  }
  return (
    <Dialog
      id="dirty-shared-scene-filter-dialog"
      open={props.open}
      ariaLabel="Scene filter"
      initialFocusRef={closeRef}
      allowNativePopup={true}
      onClose={props.onClose}
      className="dirty-ui-native-filter-dialog dirty-ui-panel"
      backdropClassName="dirty-ui-native-filter-overlay"
    >
      <h2>Scene filter</h2>
      {props.open && (
        <NativeSceneFilter
          value={props.value}
          onChange={value => {
            candidate.current = value;
            setCaptured(true);
          }}
        />
      )}
      <div className="dirty-ui-control-row">
        <Button onClick={props.onClose} buttonRef={closeRef}>
          Cancel
        </Button>
        <Button tone="primary" disabled={!captured} onClick={applyFilter}>
          Use filter
        </Button>
      </div>
    </Dialog>
  );
}
