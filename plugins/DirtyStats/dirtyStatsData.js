// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyStatsData";
  if (window[INSTANCE_KEY]) return;

  /**
   * @template T
   * @param {StatsPageRequest<T>} request
   * @returns {Promise<T[]>}
   */
  async function fetchAllPages(request) {
    var rows = [], page = 1, total = 0;
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
  function createLoader(dependencies) {
    /**
     * Callers own data-specific state and filters; this hook owns request lifetime.
     * @template T
     * @param {StatsPageEffect<T>} options
     * @param {unknown[]} keys
     */
    function usePageLoad(options, keys) {
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
        fetchAllPages(Object.assign({}, options, { graphql: dependencies.graphql, signal: controller.signal }))
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
        return function () { controller.abort(); };
      }, keys);
    }
    /** Ordinary entity pages share state; refresh and selection stay with their views. */
    function usePageData() {
      var rows = dependencies.React.useState([]), loading = dependencies.React.useState(true), error = dependencies.React.useState("");
      return {
        rows: rows[0], loading: loading[0], error: error[0], setError: error[1],
        /** @param {StatsEntityLoad} options @param {unknown[]} keys */
        useLoad: function (options, keys) {
          usePageLoad(Object.assign({}, options, {
            collection: function (response) {
              var batch = response[options.entity === "performers" ? "findPerformers" : "findScenes"];
              return { count: batch.count, rows: batch[options.entity] };
            },
            failureLabel: options.failureLabel || "The " + (options.entity === "performers" ? "performer" : "scene") + " list changed while loading. Refresh to try again.",
            setLoading: loading[1], setError: error[1],
            publish: function (result) { rows[1](result); if (options.onLoaded) options.onLoaded(result); }
          }), keys);
        }
      };
    }
    return { usePageLoad: usePageLoad, usePageData: usePageData };
  }
  window[INSTANCE_KEY] = { fetchAllPages: fetchAllPages, createLoader: createLoader };
})();
