import type { StatsDataDependencies, StatsEntityLoad, StatsPageEffect, StatsPageRequest } from "../types";


/**
 * @template T
 * @param {StatsPageRequest<T>} request
 * @returns {Promise<T[]>}
 */
export async function fetchAllPages<T>(request: StatsPageRequest<T>) {
  var rows: T[] = [], page = 1, total = 0;
  do {
    if (request.signal.aborted) return [];
    var response = await request.graphql(request.query, request.variables(page), { signal: request.signal });
    if (request.signal.aborted) return [];
    var collection = request.collection(response);
    total = collection.count;
    if (!collection.rows.length && rows.length < total) throw new Error(request.failureLabel);
    rows = rows.concat(collection.rows);
    page += 1;
  } while (!request.singlePage && rows.length < total);
  return rows;
}


/** @param {StatsDataDependencies} dependencies */
export function createLoader(dependencies: StatsDataDependencies) {
  /**
   * Callers own data-specific state and filters; this hook owns request lifetime.
   * @template T
   * @param {StatsPageEffect<T>} options
   * @param {unknown[]} keys
   */
  function usePageLoad<T>(options: StatsPageEffect<T>, keys: unknown[]) {
    dependencies.React.useEffect(function () {
      var controller = new AbortController();
      options.setError("");
      if (options.enabled === false) {
        if (options.onDisabled) options.onDisabled();
        options.setLoading(false);
        return;
      }
      options.setLoading(true);
      if (options.onStart) options.onStart();
      fetchAllPages(Object.assign({}, options, { graphql: (query: string, variables: Record<string, unknown>, config: { signal: AbortSignal }) => dependencies.graphql<import("../types").EntityResponse<T>>(query, variables, config), signal: controller.signal }))
        .then(function (rows) {
          if (controller.signal.aborted) return;
          options.publish(rows);
          options.setLoading(false);
        }).catch(function (error) {
          if (controller.signal.aborted) return;
          if (options.onError) options.onError();
          options.setError(error.message);
          options.setLoading(false);
        });
      const cleanup = () => { controller.abort(); unown?.(); };
      const unown = dependencies.own?.(cleanup);
      return cleanup;
    }, keys);
  }
  /** Ordinary entity pages share state; refresh and selection stay with their views. */
  function usePageData<T = import("../types").StatsScene & import("../types").StatsPerformer>() {
    var rows = dependencies.React.useState<T[]>([]), loading = dependencies.React.useState(true), error = dependencies.React.useState("");
    return {
      rows: rows[0], loading: loading[0], error: error[0], setError: error[1],
      /** @param {StatsEntityLoad} options @param {unknown[]} keys */
      useLoad: function (options: StatsEntityLoad<T>, keys: unknown[]) {
        usePageLoad(Object.assign({}, options, {
          collection: function (response: import("../types").EntityResponse<T>) {
            return options.entity === "performers" ? { count: response.findPerformers!.count, rows: response.findPerformers!.performers } : { count: response.findScenes!.count, rows: response.findScenes!.scenes };
          },
          failureLabel: options.failureLabel || "The " + (options.entity === "performers" ? "performer" : "scene") + " list changed while loading. Refresh to try again.",
          setLoading: loading[1], setError: error[1],
          publish: function (result: T[]) { rows[1](result); if (options.onLoaded) options.onLoaded(result); }
        }), keys);
      }
    };
  }
  return { usePageLoad: usePageLoad, usePageData: usePageData };
}
