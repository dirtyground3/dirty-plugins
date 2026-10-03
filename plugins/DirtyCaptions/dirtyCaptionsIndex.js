// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCaptionsIndex";
  if (window[INSTANCE_KEY]) return;
  var ANY_FIELD = "Contains embedded captions", TEXT_FIELD = "Contains embedded text captions";
  var STATUS_FIELD = "Caption index status";

  var FILTER_TYPE = "dirty_captions", MESSAGE_ID = "dirtyCaptions.filter.embedded";
  /** @param {string} field @param {string} value @param {string=} modifier */
  function fieldValue(field, value, modifier) { return { field: field, modifier: modifier || "EQUALS", value: [value] }; }
  var DEFINITIONS = [
    { label: "Any captions", fields: [fieldValue(ANY_FIELD, "Yes")] },
    { label: "Text captions", fields: [fieldValue(TEXT_FIELD, "Yes")] },
    { label: "Bitmap / other", fields: [fieldValue(ANY_FIELD, "Yes"), fieldValue(TEXT_FIELD, "No")] },
    { label: "None", fields: [fieldValue(ANY_FIELD, "No")] },
    { label: "Verified", fields: [fieldValue(STATUS_FIELD, "Ready")] },
    { label: "Unverified", fields: [fieldValue(STATUS_FIELD, "Ready", "NOT_EQUALS")] }
  ];
  /** @param {*} criterion @returns {*} */
  function definitionFor(criterion) { return DEFINITIONS.filter(function (item) { return criterion.value === item.label; })[0]; }
  /** @param {*} definition @returns {*} */
  function fieldsFor(definition) { return definition.fields.map(function (field) { return Object.assign({}, field, { value: field.value.slice() }); }); }

  /** @param {*} filter @returns {*} */
  function canonicalFilter(filter) {
    var fields = [], retained = [], changed = false, customCount = 0;
    filter.criteria.forEach(function (criterion) {
      if (criterion.criterionOption.type === FILTER_TYPE) {
        changed = true;
        if (criterion.isValid()) fields = fields.concat(fieldsFor(definitionFor(criterion)));
      } else if (criterion.criterionOption.type === "custom_fields") {
        customCount += 1;
        fields = fields.concat(criterion.value || []);
      } else retained.push(criterion);
    });
    if (!changed && customCount < 2) return filter;
    if (fields.length) {
      var custom = filter.makeCriterion("custom_fields");
      custom.value = fields; retained.push(custom);
    }
    var canonical = Object.create(filter);
    canonical.criteria = retained;
    // Native URL serialization initializes randomSeed. Keep that initialization
    // on the active model so serializing a bookmark cannot reshuffle results.
    canonical.getSortBy = function () { return filter.getSortBy(); };
    return canonical;
  }

  /** @param {*} filter @param {*} intl @returns {boolean} */
  function installNativeFilters(filter, intl) {
    if (!filter || filter.mode !== "SCENES" || !filter.options) return false;
    var options = filter.options.criterionOptions || [];
    var seed = options.filter(function (option) { return option.type === "resolution"; })[0];
    if (!seed || !options.some(function (option) { return option.type === "custom_fields"; })) return false;
    // These are plugin-owned messages in the current native Intl context.
    if (intl && intl.messages && !intl.messages[MESSAGE_ID]) intl.messages[MESSAGE_ID] = "Embedded captions";
    if (!options.some(function (option) { return option.type === FILTER_TYPE; })) {
      var option = Object.assign(Object.create(Object.getPrototypeOf(seed)), seed, {
        type: FILTER_TYPE, messageID: MESSAGE_ID, sfwMessageID: MESSAGE_ID, hidden: false,
        options: DEFINITIONS.map(function (item) { return item.label; }), modifierOptions: ["EQUALS"], defaultModifier: "EQUALS"
      });
      option.makeCriterionFn = function () {
        // Use the native Resolution criterion and its enum radio controls.
        // These categories have no ordering or range operators.
        var criterion = seed.makeCriterion().clone();
        criterion.criterionOption = option;
        criterion.value = ""; criterion.modifier = "EQUALS";
        criterion.isValid = function () { return this.modifier === "EQUALS" && Boolean(definitionFor(this)); };
        criterion.toCriterionInput = function () { return this.isValid() ? fieldsFor(definitionFor(this)) : []; };
        criterion.applyToCriterionInput = criterion.applyToSavedCriterion = function (input) {
          if (this.isValid()) input.custom_fields = (input.custom_fields || []).concat(this.toCriterionInput());
        };
        return criterion;
      };
      options.push(option);
    }
    for (var old = options.length - 1; old >= 0; old -= 1) {
      if (/^dirty_captions_(any|text|verified)$/.test(options[old].type)) options.splice(old, 1);
    }
    var prototype = Object.getPrototypeOf(filter), key = "__dirtyCaptionsNativeFilters";
    if (!prototype[key]) {
      // Convert only when serializing: the UI keeps one native enum criterion,
      // while GraphQL, saved filters and URLs use one normal custom-field list.
      ["makeFilter", "makeSavedFilter", "getEncodedParams"].forEach(function (name) {
        var original = prototype[name];
        if (typeof original !== "function") return;
        prototype[name] = function () {
          return original.apply(this.mode === "SCENES" ? canonicalFilter(this) : this, arguments);
        };
      });
      ["configureFromDecodedParams", "configureFromSavedFilter"].forEach(function (name) {
        var original = prototype[name];
        if (typeof original !== "function") return;
        prototype[name] = function () {
          /** @type {*} */
          var current = this;
          var result = original.apply(current, arguments);
          if (current.mode === "SCENES") current.criteria = normalizeFilter(current).criteria;
          return result;
        };
      });
      Object.defineProperty(prototype, key, { value: true });
    }
    return true;
  }

  /** @param {*} filter @returns {*} */
  function normalizeFilter(filter) {
    var values = [];
    filter.criteria.forEach(function (criterion) {
      if (criterion.criterionOption.type === "custom_fields") values = values.concat(criterion.value || []);
    });
    if (filter.criteria.some(function (item) { return item.criterionOption.type === FILTER_TYPE; })) return filter;
    // Prefer the two-field bitmap category over its generic Any captions part.
    // Leave additional legacy predicates in Custom Fields to preserve their
    // exact meaning instead of broadening an existing URL or saved filter.
    var definition = DEFINITIONS.slice().sort(function (a, b) { return b.fields.length - a.fields.length; }).filter(function (item) {
      return item.fields.every(function (expected) {
        var matches = values.filter(function (field) { return field.field === expected.field; });
        return matches.length === 1 && matches[0].modifier === expected.modifier && matches[0].value &&
          matches[0].value.length === 1 && matches[0].value[0] === expected.value[0];
      });
    })[0];
    if (!definition) return filter;
    var next = filter.clone(), retained = [], added = false;
    next.criteria.forEach(function (criterion) {
      if (criterion.criterionOption.type !== "custom_fields") { retained.push(criterion); return; }
      criterion.value = (criterion.value || []).filter(function (field) {
        if (!definition.fields.some(function (expected) { return expected.field === field.field; })) return true;
        if (!added) {
          var nativeCriterion = next.makeCriterion(FILTER_TYPE);
          nativeCriterion.value = definition.label; nativeCriterion.modifier = "EQUALS";
          retained.push(nativeCriterion); added = true;
        }
        return false;
      });
      if (criterion.value.length) retained.push(criterion);
    });
    next.criteria = retained;
    return next;
  }

  /** @param {{api: *, hub: *}} dependencies */
  function createIndexUi(dependencies) {
    var api = dependencies.api, hub = dependencies.hub;
    var React = api.React, ui = hub.react, html = ui.html;
    function operation(mode, args) { return hub.runPluginOperation("dirtyCaptions", Object.assign({ mode: mode }, args || {})); }

    function Monitor() {
      var useJobsSubscription = api.GQL && api.GQL.useJobsSubscribeSubscription;
      var subscription = typeof useJobsSubscription === "function" ? useJobsSubscription() : null;
      var event = subscription && subscription.data && subscription.data.jobsSubscribe;
      var job = event && event.job;
      var processingJobs = React.useRef([]);
      React.useEffect(function () {
        var pending = false, cancelled = false;
        function bootstrap() {
          if (pending || cancelled) return;
          pending = true;
          operation("indexBootstrap").catch(function (error) {
            if (hub.debugLog) hub.debugLog("dirtyCaptions", "Caption index maintenance failed", { error: error.message });
          }).then(function () { pending = false; });
        }
        bootstrap();
        window.addEventListener("dirty-plugins:configuration-changed", bootstrap);
        return function () { cancelled = true; window.removeEventListener("dirty-plugins:configuration-changed", bootstrap); };
      }, []);
      React.useEffect(function () {
        if (!job || event.type !== "REMOVE" || job.status !== "FINISHED" || job.description !== "Scanning..." ||
            !job.id || !job.startTime) return;
        // JobsSubscribe includes startTime, but not addTime/endTime. Stash
        // reuses job IDs after restart, so the timestamp is part of the identity.
        var key = JSON.stringify([String(job.id), job.startTime]);
        if (processingJobs.current.indexOf(key) >= 0) return;
        processingJobs.current.push(key);
        processingJobs.current = processingJobs.current.slice(-50);
        // The backend checks the opt-in setting and internal-scan ownership,
        // and atomically deduplicates completion events from multiple tabs.
        operation("indexAfterScan", { jobId: String(job.id), startTime: job.startTime }).catch(function (error) {
          processingJobs.current = processingJobs.current.filter(function (item) { return item !== key; });
          if (hub.debugLog) hub.debugLog("dirtyCaptions", "Caption index refresh after Scan failed", { error: error.message });
        });
      }, [event && event.type, job && job.id, job && job.status, job && job.description, job && job.startTime]);
      return null;
    }

    function SettingsAddon() {
      var state = React.useState(null), status = state[0], setStatus = state[1];
      var busyState = React.useState(false), busy = busyState[0], setBusy = busyState[1];
      var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
      var alive = React.useRef(false);
      React.useEffect(function () {
        alive.current = true;
        function poll() {
          operation("indexStatus").then(function (result) { if (alive.current) setStatus(result); }, function (failure) { if (alive.current) setError(failure.message); });
        }
        poll(); var timer = window.setInterval(poll, 3000);
        return function () { alive.current = false; window.clearInterval(timer); };
      }, []);
      function action(mode, args) {
        if (busy) return;
        setBusy(true); setError("");
        operation(mode, args).then(function (result) { if (alive.current) setStatus(result); }, function (failure) {
          if (alive.current) setError(failure.message);
        }).then(function () { if (alive.current) setBusy(false); });
      }
      var running = status && (status.status === "Running" || status.status === "Queued");
      return html`<${ui.SettingsSection} title="Caption index"
        description="Refresh indexes new or changed files using the saved file map. Enable refresh after Scan above and keep a Stash tab open until Scan completes; queued caption jobs continue after the browser closes.">
        <p role="status">${status && status.status ? status.status + " · " + (status.checked || 0) + " scenes checked · " + (status.probed || 0) + (status.forceRun ? " files reprobed · " : " new or changed files probed · ") + (Number(status.skipped) || 0) + " unchanged scenes skipped · " + (status.errors || 0) + " errors this run" : "The library has not been indexed yet."}</p>
        ${status && status.lastFullScan && html`<p>Last library check: ${new Date(status.lastFullScan * 1000).toLocaleString()}</p>`}
        <div className="dirty-ui-control-row">
          <${ui.Button} disabled=${busy || running} busy=${busy} onClick=${function () { action("indexRefresh"); }}>Refresh caption index<//>
          ${running && html`<${ui.Button} disabled=${busy} onClick=${function () { action("indexCancel"); }}>Stop refresh<//>`}
          <${ui.Button} tone="quiet" disabled=${busy || running} onClick=${function () { action("indexRefresh", { force: true }); }}>Reprobe all files<//>
        </div>
        <p>Known unchanged files are skipped without opening the media. Reprobe all files bypasses the saved map, including previous failed checks.</p>
        <p>Open Edit filters on a scene list and choose Embedded captions, then Any captions, Text captions, Bitmap / other, None, Verified, or Unverified. None includes only successfully checked files. Save the filter with Stash’s bookmark menu.</p>
        ${error && html`<p className="dirty-ui-text-error" role="alert">${error}</p>`}
      <//>`;
    }

    /** @param {*} result @returns {*} */
    function nativeFilterProps(result) {
      if (Array.isArray(result)) {
        for (var i = 0; i < result.length; i += 1) { var found = nativeFilterProps(result[i]); if (found) return found; }
        return null;
      }
      if (!React.isValidElement(result)) return null;
      var props = result.props || {};
      if (props.filter && props.filter.mode === "SCENES" && props.setFilter) return props;
      return props.children ? nativeFilterProps(props.children) : null;
    }
    /** @param {*} result @param {*} previous @param {*} criteria @returns {*} */
    function updateCriteriaProps(result, previous, criteria) {
      if (Array.isArray(result)) {
        var children = result.map(function (item) { return updateCriteriaProps(item, previous, criteria); });
        return children.every(function (item, index) { return item === result[index]; }) ? result : children;
      }
      if (!React.isValidElement(result)) return result;
      var props = result.props || {}, changes = props.criteria === previous ? { criteria: criteria } : {};
      if (!props.children) return props.criteria === previous ? React.cloneElement(result, changes) : result;
      var updatedChildren = updateCriteriaProps(props.children, previous, criteria);
      if (props.criteria !== previous && updatedChildren === props.children) return result;
      return React.cloneElement(result, changes, updatedChildren);
    }
    /** @param {*} result @param {*} intl @returns {*} */
    function decorateList(result, intl) {
      var props = nativeFilterProps(result);
      if (!props || !installNativeFilters(props.filter, intl)) return result;
      var normalized = normalizeFilter(props.filter);
      if (normalized === props.filter) return result;
      // URL-backed Stash lists reconstruct their model from query parameters.
      // Calling setFilter with equivalent parameters cannot update that model.
      // Adapt its criteria before native child controls render instead.
      var previous = props.filter.criteria;
      props.filter.criteria = normalized.criteria;
      return updateCriteriaProps(result, previous, normalized.criteria);
    }
    return { Monitor: Monitor, SettingsAddon: SettingsAddon, decorateList: decorateList };
  }

  window[INSTANCE_KEY] = { createIndexUi: createIndexUi, installNativeFilters: installNativeFilters, normalizeFilter: normalizeFilter };
})();
