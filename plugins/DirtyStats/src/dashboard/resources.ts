import { fetchPages } from "../domain/dashboard";
import { React, hub } from "../runtime";
import type { Capacity, DashboardResource, ResourceState } from "../types";

/** Keep each dataset alive until its last widget leaves the dashboard. */
export function useDashboardResources(requests: DashboardResource[], ready: boolean) {
  const [resources, setResources] = React.useState<Record<string, ResourceState>>({});
  const active = React.useRef(new Map<string, AbortController>());
  const capacity = React.useRef<{ controller: AbortController; result: Promise<Capacity | null> } | null>(null);
  const key = JSON.stringify(requests);
  React.useEffect(() => {
    if (!ready) return;
    const requested: DashboardResource[] = JSON.parse(key);
    const wanted = new Set(requested.map(request => request.key));
    for (const [key, controller] of active.current)
      if (!wanted.has(key)) {
        active.current.delete(key);
        controller.abort();
      }
    if (!requested.some(request => request.group === "growth")) {
      capacity.current?.controller.abort();
      capacity.current = null;
    }
    const added = requested.filter(request => !active.current.has(request.key));
    setResources(current => {
      if (!added.length && Object.keys(current).every(key => wanted.has(key))) return current;
      const next: Record<string, ResourceState> = {};
      for (const key of wanted) if (current[key]) next[key] = current[key];
      for (const request of added) next[request.key] = { loading: true, rows: [], error: "", capacity: null };
      return next;
    });
    for (const request of added) {
      const controller = new AbortController();
      active.current.set(request.key, controller);
      if (request.group === "growth" && !capacity.current) {
        const controller = new AbortController();
        const result = hub
          .graphql<{ configuration: { general: { stashes: Array<{ path: string; excludeVideo: boolean }> } } }>(
            "query DirtyStatsDashboardSources{configuration{general{stashes{path excludeVideo}}}}",
            {},
            { signal: controller.signal },
          )
          .then(configuration => {
            if (controller.signal.aborted) return null;
            const paths = configuration.configuration.general.stashes
              .filter(source => !source.excludeVideo)
              .map(source => source.path);
            return hub.runPluginOperation<Capacity>("dirtyStats", { mode: "capacity", paths });
          })
          .catch(() => null);
        capacity.current = { controller, result };
      }
      const publish = (state: ResourceState) => {
        if (active.current.get(request.key) === controller && !controller.signal.aborted)
          setResources(current => ({ ...current, [request.key]: state }));
      };
      Promise.all([
        fetchPages(request.group, request.filter, controller.signal, request.limit),
        request.group === "growth" ? capacity.current!.result : null,
      ])
        .then(([rows, capacity]) => publish({ loading: false, rows, error: "", capacity }))
        .catch(error => publish({ loading: false, rows: [], error: error.message || String(error), capacity: null }));
    }
  }, [ready, key]);
  React.useEffect(
    () => () => {
      for (const controller of active.current.values()) controller.abort();
      active.current.clear();
      capacity.current?.controller.abort();
      capacity.current = null;
    },
    [],
  );
  return resources;
}
