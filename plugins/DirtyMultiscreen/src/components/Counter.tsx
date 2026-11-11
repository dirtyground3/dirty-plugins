import { DirtyPlugins, queries, React } from "../runtime";
import type { CounterAction } from "../types";
import { DropsGlyph, icon, PluginIconButton } from "./Controls";
const SAVED_MS = 1500;
/** Adds one O to the scene a screen is playing; it can be pressed again for each one. */
export function SceneOCounterButton({ sceneId, screenIndex }: { sceneId: string; screenIndex: number }) {
  const [state, setState] = React.useState<{ status: "idle" | "saving" | "saved" | "error"; count?: number }>({
    status: "idle",
  });
  const mounted = React.useRef(true);
  React.useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  React.useEffect(() => {
    if (state.status !== "saved") return undefined;
    const timer = window.setTimeout(() => setState(value => ({ ...value, status: "idle" })), SAVED_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  // A second press before the button re-renders as busy must not add another O.
  const saving = React.useRef(false);
  const increment = () => {
    if (saving.current) return;
    saving.current = true;
    setState(value => ({ ...value, status: "saving" }));
    DirtyPlugins.graphql<{ sceneIncrementO: number }>(queries.incrementSceneOQuery, { id: sceneId })
      .then(
        data => {
          if (mounted.current) setState({ status: "saved", count: data.sceneIncrementO });
        },
        error => {
          console.error("Could not increment the O counter for scene " + sceneId + ".", error);
          if (mounted.current) setState(value => ({ ...value, status: "error" }));
        },
      )
      .finally(() => {
        saving.current = false;
      });
  };
  const screen = screenIndex + 1;
  const label =
    state.status === "error"
      ? `Could not add an O to the scene on screen ${screen}; retry`
      : `Add an O to the scene on screen ${screen}` + (state.count === undefined ? "" : ` (now ${state.count})`);
  return (
    <React.Fragment>
      <PluginIconButton
        ariaLabel={label}
        busy={state.status === "saving"}
        fallback={state.status === "error" ? "!" : "O"}
        icon={icon(state.status === "error" ? "error" : state.status === "saved" ? "success" : "oCounter")}
        onClick={increment}
      />
      <span className="ms-o-counter-status" role="status" aria-live="polite">
        {state.status === "saved" ? `O counter is now ${state.count}.` : ""}
        {state.status === "error" ? "The O counter could not be saved." : ""}
      </span>
    </React.Fragment>
  );
}
export function VisibleOCounterButton(props: { sceneIds: string[] }) {
  const [status, setStatus] = React.useState("idle");
  const [hidden, setHidden] = React.useState(false);
  const action = React.useRef<CounterAction>({ busy: false, done: false, pendingIds: null });
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function increment() {
    if (action.current.busy || action.current.done) return;
    // A retry only repeats the scenes that failed last time.
    const ids = action.current.pendingIds || props.sceneIds.filter((id, index, all) => all.indexOf(id) === index);
    if (!ids.length) return;
    action.current.busy = true;
    setStatus("loading");
    Promise.all(
      ids.map(id =>
        Promise.resolve()
          .then(() => DirtyPlugins.graphql(queries.incrementSceneOQuery, { id }))
          .then(
            () => null,
            error => {
              console.error("Could not increment the O counter for scene " + id + ".", error);
              return id;
            },
          ),
      ),
    ).then(results => {
      const failedIds = results.filter((id): id is string => id !== null);
      action.current.busy = false;
      action.current.done = failedIds.length === 0;
      action.current.pendingIds = failedIds;
      if (!mounted.current) return;
      setStatus(failedIds.length ? "error" : "success");
      if (failedIds.length) setHidden(false);
    });
  }
  const dismissing = status === "loading" || status === "success";
  const count = props.sceneIds.length;
  const label =
    status === "error"
      ? "Could not increase every visible scene O counter; retry failed scenes"
      : "Increase O counter for " + count + " visible scene" + (count === 1 ? "" : "s");
  const message =
    status === "loading"
      ? "Saving O counters."
      : status === "success"
        ? "O counters increased."
        : status === "error"
          ? "Some O counters could not be saved. Retry the failed scenes."
          : "";
  return (
    <React.Fragment>
      {!hidden && (count > 0 || status !== "idle") && (
        <div
          className={"ms-o-counter" + (dismissing ? " ms-o-counter-dismissing" : "")}
          onAnimationEnd={event => {
            if (event.target === event.currentTarget && dismissing) setHidden(true);
          }}
        >
          <PluginIconButton
            ariaLabel={label}
            disabled={dismissing}
            fallback={status === "error" ? "!" : <DropsGlyph />}
            icon={status === "error" ? icon("error") : undefined}
            onClick={increment}
          />
        </div>
      )}
      <span className="ms-o-counter-status" role="status" aria-live="polite">
        {message}
      </span>
    </React.Fragment>
  );
}
