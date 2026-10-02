// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCaptionsPlugin";
  if (window[INSTANCE_KEY]) return;
  /** @type {any} */
  var api = window["PluginApi"];
  /** @type {any} */
  var hub = window.DirtyPlugins;
  var tracks = window["__dirtyCaptionsTracks"];
  if (!api || !hub || !tracks) return;
  var React = api.React, ui = hub.react, html = ui.html;

  /** @param {{scene:*, capture:boolean}} props */
  function CaptionsController(props) {
    var node = React.useRef(null);
    var state = React.useState({ message: "", retry: false });
    var status = state[0], setStatus = state[1];
    var refreshState = React.useState(0), revision = refreshState[0], refresh = refreshState[1];
    var key = tracks.sceneKey(props.scene);
    React.useEffect(function () {
      function changed(event) {
        if (!event.detail || event.detail.pluginId === "dirtyCaptions") refresh(function (value) { return value + 1; });
      }
      window.addEventListener("dirty-plugins:configuration-changed", changed);
      return function () { window.removeEventListener("dirty-plugins:configuration-changed", changed); };
    }, []);
    React.useEffect(function () {
      var root = node.current && node.current.parentElement;
      if (!root) return undefined;
      var cancelled = false, player = null, release = null, observer = null, timer = null;
      var settings = null, result = null, waiting = false;
      setStatus({ message: "", retry: false });
      function fail(error) {
        if (cancelled) return;
        setStatus({ message: String(error && error.message || error), retry: true });
      }
      function apply() {
        if (cancelled || !player || player.isDisposed() || !result || !settings) return;
        try {
          release = tracks.attachTracks(player, result, settings, function (message) { fail(new Error(message)); });
          setStatus({ message: result.warnings.join(" "), retry: Boolean(result.retryable) });
        } catch (error) { fail(error); }
      }
      function findPlayer() {
        if (cancelled || !settings || !settings.enabled) return;
        var element = root.querySelector("video-js");
        var next = element && element.player;
        if (next && !next.isDisposed() && next !== player) {
          if (release) { release(); release = null; }
          player = next;
          next.ready(function () {
            if (cancelled || next !== player || next.isDisposed()) return;
            if (result) { apply(); return; }
            if (waiting) return;
            waiting = true;
            setStatus({ message: "Loading embedded captions…", retry: false });
            tracks.requestCaptions(props.scene).then(function (data) {
              if (cancelled) return;
              result = data;
              if (hub.debugLog) hub.debugLog("dirtyCaptions", "Embedded captions loaded", {
                sceneId: props.scene.id, tracks: data.tracks.length, warnings: data.warnings.length
              });
              apply();
            }, fail);
          });
        }
      }
      hub.getPluginSettings("dirtyCaptions").then(function (raw) {
        if (cancelled) return;
        settings = tracks.settings(raw);
        if (!settings.enabled) return;
        observer = new MutationObserver(findPlayer);
        observer.observe(root, { childList: true, subtree: true });
        findPlayer();
        // Video.js may set element.player after inserting the element.
        timer = window.setInterval(findPlayer, 1000);
      }, fail);
      return function () {
        cancelled = true;
        if (observer) observer.disconnect();
        if (timer !== null) window.clearInterval(timer);
        if (release) release();
      };
    }, [key, revision]);
    return html`<div ref=${node} className="dirty-captions-status dirty-ui-control-row" aria-live="polite">
      ${status.message && html`<span role=${status.retry ? "alert" : "status"}>${status.message}</span>`}
      ${status.retry && html`<${ui.Button} size="compact" onClick=${function () { refresh(function (value) { return value + 1; }); }}>Retry captions<//>`}
    </div>`;
  }

  api.patch.after("ScenePlayer", function () {
    var args = Array.prototype.slice.call(arguments);
    var result = args.pop(), props = args[0];
    if (!props || !props.scene || !props.scene.files || !props.scene.files.length || !React.isValidElement(result)) return result;
    var capture = Boolean(hub.captureEnabled && hub.captureEnabled(window.location.search));
    var className = (result.props.className || "") + " dirty-captions-player" + (capture ? " dirty-captions-capture" : "");
    return React.cloneElement(result, { className: className }, result.props.children,
      React.createElement(CaptionsController, { key: "dirty-captions-controller", scene: props.scene, capture: capture }));
  });
  window[INSTANCE_KEY] = { CaptionsController: CaptionsController };
  if (hub.debugLog) hub.debugLog("dirtyCaptions", "Native scene player captions registered");
})();
