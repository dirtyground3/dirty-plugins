import { isMarkerLaunchContext } from "../domain/context";
import { useActive, useOwnedEffect as useEffect } from "../lifecycle";
import { contexts, counts, DirtyPlugins, life, PluginApi, queries, React } from "../runtime";
const ROUTE_PATH = "/plugins/multiscreen", SCENE_COUNT_DEBOUNCE_MS = 300;
export function ContextualMultiscreenNavLink() {
  const active = useActive();
  const location = PluginApi.libraries.ReactRouterDOM.useLocation();
  const [contextRevision, setContextRevision] = React.useState(0);
  const [sceneCount, setSceneCount] = React.useState<number | null>(null);
  const [countLoading, setCountLoading] = React.useState(false);
  const launchContext = React.useMemo(
    () => contexts.getLaunchContextForPath(location.pathname),
    [contextRevision, location.pathname]
  );
  const launchContextKey = React.useMemo(
    () => launchContext ? JSON.stringify(launchContext) : "",
    [launchContext]
  );
  useEffect(() => {
    return contexts.subscribeToContextChanges(() => {
      setContextRevision((revision) => revision + 1);
    });
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!launchContext || !launchContextKey) {
      setSceneCount(null);
      setCountLoading(false);
      return;
    }
    const cachedCount = counts.getCachedSceneCount(launchContextKey);
    if (cachedCount !== null) {
      setSceneCount(cachedCount);
      setCountLoading(false);
      return;
    }
    setCountLoading(true);
    const debounceMs = launchContext.source === "selection" || launchContext.source === "marker-selection" ? 0 : SCENE_COUNT_DEBOUNCE_MS;
    const timeoutId = window.setTimeout(() => {
      void queries.getLiveSceneCount(launchContext).then((count) => {
        if (!cancelled && life.active) counts.cacheSceneCount(launchContextKey, count);
        if (!cancelled) setSceneCount(count);
      }).catch(() => {
        if (!cancelled) setSceneCount(null);
      }).finally(() => {
        if (!cancelled) setCountLoading(false);
      });
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [launchContext, launchContextKey]);
  if (!active) return null;
  const formattedSceneCount = sceneCount?.toLocaleString();
  const countNoun = isMarkerLaunchContext(launchContext) ? "markers" : "scenes";
  const buttonTitle = formattedSceneCount ? `DirtyMultiscreen (${formattedSceneCount} ${countNoun})` : "DirtyMultiscreen";
  const handleClick = React.useCallback(() => {
    contexts.storeLaunchContext(launchContext);
  }, [launchContext]);
  // Icons use <i> rather than <span> so themes that hide navbar spans keep them.
  const icon = (<React.Fragment>
    <i className="ms-nav-icon" aria-hidden="true"><i /><i /><i /><i /></i>
    {launchContext && (<i
      className={`ms-nav-count${countLoading ? " ms-loading" : ""}`}
      aria-label={countLoading ? `Counting ${countNoun}` : `${formattedSceneCount ?? 0} ${countNoun}`}
    >
      {countLoading ? "\u2026" : formattedSceneCount ?? "?"}
    </i>)}
  </React.Fragment>);
  return (<DirtyPlugins.react.NavAction
    as={PluginApi.libraries.ReactRouterDOM.NavLink}
    className="ms-nav-link ms-nav-button"
    exact={true}
    to={ROUTE_PATH}
    onClick={handleClick}
    label={buttonTitle}
    icon={icon}
  />);
}
