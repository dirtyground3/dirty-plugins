import { isMarkerLaunchContext } from "../domain/context";
import type { ComponentDependencies } from "../types";
export function createNavigation(deps: ComponentDependencies) {
  const { api: PluginApi, hub: DirtyPlugins, contexts, queries, React, useOwnedEffect: useEffect } = deps;
  const { Fragment, useState, useCallback, useMemo } = React;
  const { NavLink, useLocation } = PluginApi.libraries.ReactRouterDOM;
  const ROUTE_PATH = "/plugins/multiscreen", SCENE_COUNT_DEBOUNCE_MS = 300;
  const { subscribeToContextChanges, getLaunchContextForPath, storeLaunchContext } = contexts;
  const { getLiveSceneCount } = queries;
  const { getCachedSceneCount, cacheSceneCount } = deps.counts;
  function ContextualMultiscreenNavLink() {
    const active = deps.useActive();
    const location = useLocation();
    const [contextRevision, setContextRevision] = useState(0);
    const [sceneCount, setSceneCount] = useState<number | null>(null);
    const [countLoading, setCountLoading] = useState(false);
    const launchContext = useMemo(
      () => getLaunchContextForPath(location.pathname),
      [contextRevision, location.pathname]
    );
    const launchContextKey = useMemo(
      () => launchContext ? JSON.stringify(launchContext) : "",
      [launchContext]
    );
    useEffect(() => {
      return subscribeToContextChanges(() => {
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
      const cachedCount = getCachedSceneCount(launchContextKey);
      if (cachedCount !== null) {
        setSceneCount(cachedCount);
        setCountLoading(false);
        return;
      }
      setCountLoading(true);
      const debounceMs = launchContext.source === "selection" || launchContext.source === "marker-selection" ? 0 : SCENE_COUNT_DEBOUNCE_MS;
      const timeoutId = window.setTimeout(() => {
        void getLiveSceneCount(launchContext).then((count) => {
          if (!cancelled && deps.life.active) cacheSceneCount(launchContextKey, count);
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
    const handleClick = useCallback(() => {
      storeLaunchContext(launchContext);
    }, [launchContext]);
    // Icons use <i> rather than <span> so themes that hide navbar spans keep them.
    const icon = (<Fragment>
      <i className="ms-nav-icon" aria-hidden="true"><i /><i /><i /><i /></i>
      {launchContext && (<i
        className={`ms-nav-count${countLoading ? " ms-loading" : ""}`}
        aria-label={countLoading ? `Counting ${countNoun}` : `${formattedSceneCount ?? 0} ${countNoun}`}
      >
        {countLoading ? "\u2026" : formattedSceneCount ?? "?"}
      </i>)}
    </Fragment>);
    return (<DirtyPlugins.react.NavAction
      as={NavLink}
      className="ms-nav-link ms-nav-button"
      exact={true}
      to={ROUTE_PATH}
      onClick={handleClick}
      label={buttonTitle}
      icon={icon}
    />);
  }
  return ContextualMultiscreenNavLink;
}
