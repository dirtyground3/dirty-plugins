import { DirtyPlugins, queries, React } from "../runtime";
import type { CounterAction } from "../types";
import { icon, PluginIconButton } from "./Controls";
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
            fallback={status === "error" ? "!" : "O"}
            icon={status === "error" ? icon("error") : icon("oCounter")}
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
