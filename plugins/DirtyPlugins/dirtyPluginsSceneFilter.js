// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsSceneFilter";
  if (window[INSTANCE_KEY]) return;

  /** @param {{hubApi: *, PluginApi: *, Dialog: Function, StateView: Function, Button: Function, createElement: Function, useEffect: Function, useState: Function, useRef: Function}} dependencies */
  function createSceneFilter(dependencies) {
    var hubApi = dependencies.hubApi, PluginApi = dependencies.PluginApi;
    var Dialog = dependencies.Dialog, StateView = dependencies.StateView, Button = dependencies.Button;
    var createElement = dependencies.createElement, useEffect = dependencies.useEffect;
    var useState = dependencies.useState, useRef = dependencies.useRef;

  var sceneFilterListeners = {};
  var activeSharedSceneFilter = null;
  function serializeSceneFilter(filter) {
    var find = Object.assign({}, filter.makeFindFilter());
    delete find.page;
    delete find.per_page;
    var query = new URLSearchParams(filter.makeQueryParameters());
    query.delete("page");
    query.delete("per_page");
    return { find: find, scene: JSON.parse(JSON.stringify(filter.makeFilter() || {})), query: query.toString(), all: false };
  }
  function SharedSceneFilterCapture(props) {
    var value = serializeSceneFilter(props.filter);
    var key = JSON.stringify(value);
    useEffect(function () {
      var listener = sceneFilterListeners[props.owner];
      if (listener) listener(value);
    }, [props.owner, key]);
    return null;
  }
  function SceneFilterEditor(props) {
    var readyState = useState(false), ready = readyState[0], setReady = readyState[1];
    var errorState = useState(""), error = errorState[0], setError = errorState[1];
    var candidate = useRef(props.value || {});
    var owner = useRef("filter-" + Math.random().toString(36).slice(2));
    var closeRef = useRef(null);
    var callback = useRef(props.onChange);
    callback.current = props.onChange;
    useEffect(function () {
      if (!props.open) return undefined;
      var active = true;
      candidate.current = props.value || {};
      activeSharedSceneFilter = owner.current;
      sceneFilterListeners[owner.current] = function (value) { candidate.current = value; };
      hubApi.native.ensureComponents("SceneList", ["FilteredSceneList"]).then(function () {
        if (active) setReady(true);
      }).catch(function (failure) { if (active) setError(failure.message); });
      return function () {
        active = false; delete sceneFilterListeners[owner.current];
        if (activeSharedSceneFilter === owner.current) activeSharedSceneFilter = null;
      };
    }, [props.open]);
    return createElement(Dialog, {
      id: "dirty-shared-scene-filter-dialog", open: props.open, ariaLabel: "Scene filter", initialFocusRef: closeRef,
      allowNativePopup: true, onClose: props.onClose,
      className: "dirty-ui-native-filter-dialog dirty-ui-panel",
      backdropClassName: "dirty-ui-native-filter-overlay",
    },
      createElement("h2", null, "Scene filter"),
      error ? createElement(StateView, { title: "Stash filters unavailable", detail: error })
        : !ready ? createElement(StateView, { title: "Loading filters…" })
        : createElement(PluginApi.libraries.ReactRouterDOM.MemoryRouter, {
          initialEntries: [{ pathname: "/scenes", search: "?" + ((props.value || {}).query || "") }],
        }, createElement(PluginApi.components.FilteredSceneList, { alterQuery: true, extraCriteria: { dirtySharedFilter: owner.current } })),
      createElement("div", { className: "dirty-ui-control-row" },
        createElement(Button, { onClick: props.onClose, buttonRef: closeRef }, "Cancel"),
        createElement(Button, { tone: "primary", disabled: !ready || Boolean(error), onClick: function () {
          callback.current(candidate.current); props.onClose();
        } }, "Use filter")));
  }
    return { serialize: serializeSceneFilter, Capture: SharedSceneFilterCapture, Editor: SceneFilterEditor, activeOwner: function () { return activeSharedSceneFilter; } };
  }

  window[INSTANCE_KEY] = { createSceneFilter: createSceneFilter };
})();
