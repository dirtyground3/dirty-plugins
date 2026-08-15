(function () {
  "use strict";

  var api = window.PluginApi;
  if (!api || !api.React || !api.patch) {
    console.error("[Stash Copy] PluginApi is unavailable");
    return;
  }
  if (window.__stashCopyNativeMenuLoaded) return;
  window.__stashCopyNativeMenuLoaded = true;

  var React = api.React;
  var ReactDOM = api.ReactDOM;
  var Dropdown = api.libraries.Bootstrap.Dropdown;
  var PLUGIN_ID = "stashCopy";
  var busy = false;

  function graphql(query, variables) {
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query: query, variables: variables || {} }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Stash returned HTTP " + response.status);
        return response.json();
      })
      .then(function (result) {
        if (result.errors && result.errors.length) {
          throw new Error(
            result.errors.map(function (error) { return error.message; }).join("; ")
          );
        }
        return result.data || {};
      });
  }

  function getSettings() {
    return graphql(
      "query StashCopySettings($ids:[ID!]){" +
        "configuration{plugins(include:$ids)}}",
      { ids: [PLUGIN_ID] }
    ).then(function (data) {
      var plugins = (data.configuration && data.configuration.plugins) || {};
      return plugins[PLUGIN_ID] || {};
    });
  }

  function queueCopy(sceneIds) {
    return graphql(
      "mutation StashCopyRun($pluginId:ID!,$description:String!,$args:Map){" +
        "runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
      {
        pluginId: PLUGIN_ID,
        description: "Copy files for " + sceneIds.length + " selected scene" +
          (sceneIds.length === 1 ? "" : "s"),
        args: { scene_ids: sceneIds },
      }
    ).then(function (data) { return data.runPluginTask; });
  }

  function notify(message, isError) {
    var toast = document.createElement("div");
    toast.className = "stash-copy-toast alert " +
      (isError ? "alert-danger" : "alert-success");
    toast.setAttribute("role", "alert");
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, isError ? 8000 : 5000);
  }

  function sceneIdFromSelectionCheckbox(checkbox) {
    var item = checkbox.closest(".scene-card, .table-list tbody tr, .wall-item");
    if (!item) return null;
    var link = item.querySelector('a[href*="/scenes/"]');
    if (!link) return null;
    try {
      var path = new URL(link.getAttribute("href"), window.location.origin).pathname;
      var match = path.match(/\/scenes\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch (_error) {
      return null;
    }
  }

  function selectedSceneIds() {
    var ids = [];
    var seen = Object.create(null);
    document.querySelectorAll(
      ".item-list-container.scene-list input[type=checkbox]:checked"
    ).forEach(function (checkbox) {
      var id = sceneIdFromSelectionCheckbox(checkbox);
      if (id && !seen[id]) {
        seen[id] = true;
        ids.push(id);
      }
    });
    return ids;
  }

  function startCopy(selectedIds) {
    var sceneIds = selectedIds && selectedIds.length
      ? selectedIds.slice()
      : selectedSceneIds();
    if (busy) return;
    if (!sceneIds.length) {
      notify("No selected scenes were found on this page.", true);
      return;
    }

    busy = true;
    getSettings()
      .then(function (settings) {
        if (!String(settings.destinationFolder || "").trim()) {
          throw new Error(
            "Set Destination folder under Settings > Plugins > Stash Copy first."
          );
        }
        return queueCopy(sceneIds);
      })
      .then(function (jobId) {
        notify(
          "Scene file copy queued as job " + jobId + ". Progress is available in Tasks.",
          false
        );
      })
      .catch(function (error) {
        console.error("[Stash Copy]", error);
        notify(error.message || String(error), true);
      })
      .then(function () { busy = false; });
  }

  function CopyMenuController() {
    var menuState = React.useState(null);
    var menu = menuState[0];
    var setMenu = menuState[1];
    var idsState = React.useState([]);
    var sceneIds = idsState[0];
    var setSceneIds = idsState[1];

    React.useEffect(function () {
      var pendingTimer = null;

      function onDocumentClick(event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var toggle = target.closest(
          ".item-list-container.scene-list #more-menu"
        );
        if (!toggle) return;

        if (pendingTimer !== null) window.clearTimeout(pendingTimer);
        pendingTimer = window.setTimeout(function () {
          pendingTimer = null;
          var dropdown = toggle.closest(".dropdown");
          var targetMenu = dropdown && dropdown.querySelector(
            ".scene-list-operations-dropdown"
          );
          var selected = selectedSceneIds();
          setSceneIds(selected);
          setMenu(selected.length ? targetMenu : null);
        }, 0);
      }

      document.addEventListener("click", onDocumentClick);
      return function () {
        document.removeEventListener("click", onDocumentClick);
        if (pendingTimer !== null) window.clearTimeout(pendingTimer);
      };
    }, []);

    if (!menu || !sceneIds.length) return null;
    return ReactDOM.createPortal(
      React.createElement(
        Dropdown.Item,
        {
          className: "bg-secondary text-white stash-copy-menu-item",
          onClick: function () { startCopy(sceneIds); },
        },
        "Copy scene files"
      ),
      menu
    );
  }

  // FilteredSceneList is an official Stash patch point. Its existing output is
  // returned unchanged; the controller is a sibling that stays idle until the
  // operations menu is opened. React owns and removes the portal item safely.
  api.patch.after("FilteredSceneList", function (_props, rendered) {
    return React.createElement(
      React.Fragment,
      null,
      rendered,
      React.createElement(CopyMenuController, { key: "stash-copy-controller" })
    );
  });
})();
