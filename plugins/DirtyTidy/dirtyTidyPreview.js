// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyTidyPreview";
  if (window[INSTANCE_KEY]) return;

  /** @param {{h: Function, React: *, DirtyPlugins: *, variables: string[][]}} dependencies */
  function createPreview(dependencies) {
    var h = dependencies.h, React = dependencies.React;
    var DirtyPlugins = dependencies.DirtyPlugins, VARIABLES = dependencies.variables;

  function VariablePicker(props) {
    return h(
      "div",
      { className: "dirty-tidy-variables", "aria-label": "Template variables" },
      VARIABLES.map(function (variable) {
        return h(
          "button",
          {
            className: "dirty-tidy-variable",
            key: variable[0],
            onClick: function () { props.onInsert("{" + variable[0] + "}"); },
            title: variable[1],
            type: "button",
          },
          "{" + variable[0] + "}"
        );
      })
    );
  }

  function Summary(props) {
    var summary = props.summary || {};
    var values = [
      ["All", props.total || 0, "all"],
      ["Ready", summary.ready || 0, "ready"],
      ["Moves", summary.moves || 0, "move"],
      ["Renames", summary.renames || 0, "rename"],
      ["Warnings", summary.warnings || 0, "warning"],
      ["Unchanged", summary.unchanged || 0, "unchanged"],
      ["Blocked", summary.blocked || 0, "blocked"],
    ];
    return h(
      "div",
      { className: "dirty-tidy-summary", role: "group", "aria-label": "Filter preview" },
      values.map(function (value) {
        var active = props.value === value[2];
        return h("button", {
          "aria-pressed": active,
          className: "dirty-tidy-summary-item dirty-ui-metric dirty-tidy-summary-" + value[2] + (active ? " dirty-tidy-summary-active" : ""),
          disabled: props.disabled,
          key: value[0],
          onClick: function () { props.onChange(value[2]); },
          type: "button",
        },
          h("strong", { className: "dirty-ui-metric-value" }, String(value[1])),
          h("span", { className: "dirty-ui-metric-detail" }, value[0])
        );
      })
    );
  }

  function PreviewNotes(props) {
    var operation = props.operation || {};
    var warnings = operation.warnings || [];
    var blockedScenes = operation.blocked_scenes || [];
    if (DirtyPlugins.captureEnabled && DirtyPlugins.captureEnabled(window.location && window.location.search)) {
      return warnings.length || blockedScenes.length ? h("span", null, "Details hidden for documentation") : null;
    }
    return h(
      "div",
      { className: "dirty-tidy-notes" },
      warnings.map(function (warning, index) {
        return h("div", { key: "warning-" + index }, warning);
      }),
      blockedScenes.length > 0 && h(
        "div",
        { className: "dirty-tidy-blocked-scenes" },
        h("span", null, blockedScenes.length === 1 ? "Blocked scene: " : "Blocked scenes: "),
        blockedScenes.map(function (scene, index) {
          return h(
            React.Fragment,
            { key: scene.id },
            index > 0 && ", ",
            h(
              "a",
              {
                href: "/scenes/" + encodeURIComponent(scene.id),
                title: "Open scene " + scene.id,
              },
              scene.title || ("Scene " + scene.id)
            )
          );
        })
      )
    );
  }

  function PreviewTable(props) {
    var operations = props.operations || [];
    var docsCapture = DirtyPlugins.captureEnabled && DirtyPlugins.captureEnabled(window.location && window.location.search);
    if (!operations.length) {
      return h("p", { className: "dirty-tidy-empty" }, "No operations match this filter.");
    }
    return h(
      "div",
      { className: "dirty-tidy-preview-table-wrap dirty-ui-table-wrap" },
      h("table", { className: "table table-sm dirty-tidy-preview-table dirty-ui-table" },
        h("thead", null,
          h("tr", null,
            h("th", null, "Status"),
            h("th", null, "Current path"),
            h("th", null, "Proposed path"),
            h("th", null, "Notes")
          )
        ),
        h("tbody", null,
          operations.map(function (operation) {
            return h("tr", { key: operation.file_id, className: "dirty-tidy-row-" + operation.status },
              h("td", null, h("span", { className: "badge dirty-ui-badge dirty-tidy-status" }, operation.status)),
              h("td", { className: "dirty-tidy-path" }, docsCapture ? "Path hidden" : operation.source_path),
              h("td", { className: "dirty-tidy-path" }, docsCapture ? "Path hidden" : operation.destination_path),
              h("td", null, h(PreviewNotes, { operation: operation }))
            );
          })
        )
      )
    );
  }

    return { VariablePicker: VariablePicker, Summary: Summary, PreviewNotes: PreviewNotes, PreviewTable: PreviewTable };
  }

  window[INSTANCE_KEY] = { createPreview: createPreview };
})();
