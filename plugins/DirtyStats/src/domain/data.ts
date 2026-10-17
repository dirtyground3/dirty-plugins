import { hub, React } from "../runtime";
import type {
  EntityResponse,
  StatsEntityLoad,
  StatsPageEffect,
  StatsPageRequest,
  StatsPerformer,
  StatsScene,
} from "../types";

export const PERFORMER_SCENE_RATINGS_QUERY =
  "query DirtyStatsPerformerSceneRatings($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id name rating100 scenes{id rating100}}}}";

/**
 * @template T
 * @param {StatsPageRequest<T>} request
 * @returns {Promise<T[]>}
 */
export async function fetchAllPages<T>(request: StatsPageRequest<T>) {
  let rows: T[] = [],
    page = 1,
    total = 0;
  do {
    if (request.signal.aborted) return [];
    const response = await request.graphql(request.query, request.variables(page), { signal: request.signal });
    if (request.signal.aborted) return [];
    const collection = request.collection(response);
    total = collection.count;
    if (!collection.rows.length && rows.length < total) throw new Error(request.failureLabel);
    rows = rows.concat(collection.rows);
    page += 1;
  } while (!request.singlePage && rows.length < total);
  return rows;
}

/**
 * Callers own data-specific state and filters; this hook owns request lifetime.
 * @template T
 * @param {StatsPageEffect<T>} options
 * @param {unknown[]} keys
 */
export function usePageLoad<T>(options: StatsPageEffect<T>, keys: unknown[]) {
  React.useEffect(() => {
    const controller = new AbortController();
    options.setError("");
    if (options.enabled === false) {
      if (options.onDisabled) options.onDisabled();
      options.setLoading(false);
      return;
    }
    options.setLoading(true);
    if (options.onStart) options.onStart();
    fetchAllPages(
      Object.assign({}, options, {
        graphql: (query: string, variables: Record<string, unknown>, config: { signal: AbortSignal }) =>
          hub.graphql<EntityResponse<T>>(query, variables, config),
        signal: controller.signal,
      }),
    )
      .then(rows => {
        if (controller.signal.aborted) return;
        options.publish(rows);
        options.setLoading(false);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (options.onError) options.onError();
        options.setError(error.message);
        options.setLoading(false);
      });
    return () => controller.abort();
  }, keys);
}
/** Ordinary entity pages share state; refresh and selection stay with their views. */
export function usePageData<T = StatsScene & StatsPerformer>() {
  const rows = React.useState<T[]>([]),
    loading = React.useState(true),
    error = React.useState("");
  return {
    rows: rows[0],
    loading: loading[0],
    error: error[0],
    setError: error[1],
    /** @param {StatsEntityLoad} options @param {unknown[]} keys */
    useLoad: (options: StatsEntityLoad<T>, keys: unknown[]) => {
      usePageLoad(
        Object.assign({}, options, {
          collection: (response: EntityResponse<T>) =>
            options.entity === "performers"
              ? { count: response.findPerformers!.count, rows: response.findPerformers!.performers }
              : { count: response.findScenes!.count, rows: response.findScenes!.scenes },
          failureLabel:
            options.failureLabel ||
            "The " +
              (options.entity === "performers" ? "performer" : "scene") +
              " list changed while loading. Refresh to try again.",
          setLoading: loading[1],
          setError: error[1],
          publish: (result: T[]) => {
            rows[1](result);
            if (options.onLoaded) options.onLoaded(result);
          },
        }),
        keys,
      );
    },
  };
}
