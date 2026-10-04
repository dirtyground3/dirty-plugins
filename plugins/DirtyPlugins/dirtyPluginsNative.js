// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsNative";
  if (window[INSTANCE_KEY]) return;
  /** @param {HubNativeDependencies} dependencies */
  function createNative(dependencies) {
    var hubApi = dependencies.hubApi;
    var PluginApi = dependencies.PluginApi;
    var Dialog = dependencies.Dialog;
    var StateView = dependencies.StateView;
    var Button = dependencies.Button;
    var html = dependencies.html;
    var useEffect = dependencies.useEffect;
    var useState = dependencies.useState;
    var useRef = dependencies.useRef;
    var nativeComponentLoads = {};
    var nativeBundleLoads = {};
    var filterModule = window.__dirtyPluginsSceneFilter;
    if (!filterModule) return;
    var filters = filterModule.createSceneFilter({ hubApi: hubApi, PluginApi: PluginApi, Dialog: Dialog, StateView: StateView, Button: Button, html: html, useEffect: useEffect, useState: useState, useRef: useRef });
    var serializeSceneFilter = filters.serialize, SharedSceneFilterCapture = filters.Capture, SceneFilterEditor = filters.Editor;
    hubApi.react.SceneFilterEditor = SceneFilterEditor;
    hubApi.serializeSceneFilter = serializeSceneFilter;
    PluginApi.patch.instead("SceneList", function () {
      var args = Array.prototype.slice.call(arguments), next = args.pop(), props = args[0];
      var owner = props && props.extraCriteria && props.extraCriteria.dirtySharedFilter;
      // Stash 0.31's scene list does not forward extraCriteria to SceneList.
      // The editor is the only native scene list on suite plugin routes.
      if (!owner && filters.activeOwner() && window.location.pathname.indexOf("/plugins/") === 0) owner = filters.activeOwner();
      if (!owner || !props.filter) return next.apply(null, args);
      return html`<${SharedSceneFilterCapture} owner=${owner} filter=${props.filter} />`;
    });
    hubApi.native = {
      loadComponent: function (name) {
        if (PluginApi.components && PluginApi.components[name]) {
          return Promise.resolve(PluginApi.components[name]);
        }
        if (!PluginApi.utils || !PluginApi.utils.loadComponents ||
            !PluginApi.loadableComponents || !PluginApi.loadableComponents[name]) {
          return Promise.reject(new Error("Stash does not expose " + name + "."));
        }
        if (!nativeComponentLoads[name]) {
          nativeComponentLoads[name] = Promise.resolve().then(function () {
            return PluginApi.utils.loadComponents([PluginApi.loadableComponents[name]]);
          }).then(function () {
            if (!PluginApi.components || !PluginApi.components[name]) {
              throw new Error("Stash did not register " + name + ".");
            }
            return PluginApi.components[name];
          }).catch(function (error) {
            delete nativeComponentLoads[name];
            throw error;
          });
        }
        return nativeComponentLoads[name];
      },
      ensureComponents: function (loadableName, requiredNames) {
        var names = requiredNames || [loadableName];
        function available() { return names.every(function (name) { return PluginApi.components && PluginApi.components[name]; }); }
        if (available()) return Promise.resolve(names.map(function (name) { return PluginApi.components[name]; }));
        if (!PluginApi.utils || !PluginApi.utils.loadComponents || !PluginApi.loadableComponents || !PluginApi.loadableComponents[loadableName]) {
          return Promise.reject(new Error("Stash does not expose " + loadableName + "."));
        }
        if (!nativeBundleLoads[loadableName]) {
          nativeBundleLoads[loadableName] = Promise.resolve().then(function () {
            return PluginApi.utils.loadComponents([PluginApi.loadableComponents[loadableName]]);
          }).catch(function (error) {
            delete nativeBundleLoads[loadableName];
            throw error;
          });
        }
        return nativeBundleLoads[loadableName].then(function () {
          if (!available()) throw new Error("Stash did not register " + names.join(", ") + ".");
          return names.map(function (name) { return PluginApi.components[name]; });
        });
      }
    };
    var captureInThisPage = false;
    hubApi.captureEnabled = function (search) {
      try {
        var currentSearch = window.location && window.location.search || "";
        var query = new URLSearchParams(search == null ? currentSearch : search);
        var currentLocation = search == null || search === currentSearch;
        if (query.get("docsCapture") === "0" || query.get("censorMedia") === "0") {
          if (currentLocation) captureInThisPage = false;
          return false;
        }
        if (query.get("docsCapture") === "1" || query.get("censorMedia") === "1") {
          if (currentLocation) captureInThisPage = true;
          return true;
        }
        return currentLocation && captureInThisPage;
      } catch (_error) {
        return false;
      }
    };
    hubApi.captureUrl = function (to, search) {
      if (typeof to !== "string" || !hubApi.captureEnabled(search == null ? undefined : search)) return to;
      if (/[?&](docsCapture|censorMedia)=1(?:&|#|$)/.test(to)) return to;
      if (/[?&]docsCapture=/.test(to)) return to.replace(/([?&]docsCapture=)[^&#]*/, function (_match, prefix) { return prefix + "1"; });
      var hash = to.indexOf("#"), beforeHash = hash < 0 ? to : to.slice(0, hash), afterHash = hash < 0 ? "" : to.slice(hash);
      return beforeHash + (beforeHash.indexOf("?") < 0 ? "?" : "&") + "docsCapture=1" + afterHash;
    };

    return {
    };
  }
  window[INSTANCE_KEY] = { createNative: createNative };
})();
