// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyTidyPreview";
  if (window[INSTANCE_KEY]) return;

  /** @param {{html: Function, React: *, DirtyPlugins: *, variables: string[][]}} dependencies */
  function createPreview(dependencies) {
    var html = dependencies.html, React = dependencies.React;
    var DirtyPlugins = dependencies.DirtyPlugins, VARIABLES = dependencies.variables;

  /** Menu items that insert a template token, grouped under headers. @param {function(string): void} onInsert @returns {Array<*>} */
  function variableMenuItems(onInsert) {
    var groups = [], byGroup = {};
    VARIABLES.forEach(function (variable) {
      var group = variable[2] || "Variables";
      if (!byGroup[group]) { byGroup[group] = []; groups.push(group); }
      byGroup[group].push(variable);
    });
    return groups.reduce(function (items, group) {
      return items.concat([{ header: group }], byGroup[group].map(function (variable) {
        return { key: variable[0], label: html`${variable[1]} <span className="dirty-tidy-token">${"{" + variable[0] + "}"}</span>`, onSelect: function () { onInsert("{" + variable[0] + "}"); } };
      }));
    }, []);
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
    // Empty categories add noise; "All" and the active filter always stay.
    values = values.filter(function (value) { return value[2] === "all" || value[1] > 0 || props.value === value[2]; });
    return html`
      <div className="dirty-tidy-summary" role="group" aria-label="Filter preview">
        ${values.map(function (value) {
          var active = props.value === value[2];
          return html`<button
            aria-pressed=${active}
            className=${"dirty-tidy-summary-item dirty-ui-metric dirty-tidy-summary-" + value[2] + (active ? " dirty-tidy-summary-active" : "")}
            disabled=${props.disabled}
            key=${value[0]}
            onClick=${function () { props.onChange(value[2]); }}
            type="button"
          >
            <strong className="dirty-ui-metric-value">${String(value[1])}</strong>
            <span className="dirty-ui-metric-detail">${value[0]}</span>
          </button>`;
        })}
      </div>`;
  }

  function PreviewNotes(props) {
    var operation = props.operation || {};
    var warnings = operation.warnings || [];
    var blockedScenes = operation.blocked_scenes || [];
    if (DirtyPlugins.captureEnabled && DirtyPlugins.captureEnabled(window.location && window.location.search)) {
      return warnings.length || blockedScenes.length ? html`<span>Details hidden for documentation</span>` : null;
    }
    return html`
      <div className="dirty-tidy-notes">
        ${warnings.map(function (warning, index) {
          return html`<div key=${"warning-" + index}>${warning}</div>`;
        })}
        ${blockedScenes.length > 0 && html`
          <div className="dirty-tidy-blocked-scenes">
            <span>${blockedScenes.length === 1 ? "Blocked scene: " : "Blocked scenes: "}</span>
            ${blockedScenes.map(function (scene, index) {
              return html`<${React.Fragment} key=${scene.id}>
                ${index > 0 && ", "}
                <a href=${"/scenes/" + encodeURIComponent(scene.id)} title=${"Open scene " + scene.id}>
                  ${scene.title || ("Scene " + scene.id)}
                </a>
              <//>`;
            })}
          </div>`}
      </div>`;
  }

  function PreviewTable(props) {
    var operations = props.operations || [];
    var docsCapture = DirtyPlugins.captureEnabled && DirtyPlugins.captureEnabled(window.location && window.location.search);
    if (!operations.length) {
      return html`<p className="dirty-tidy-empty">No operations match this filter.</p>`;
    }
    return html`
      <div className="dirty-tidy-preview-table-wrap dirty-ui-table-wrap">
        <table className="table table-sm dirty-tidy-preview-table dirty-ui-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Current path</th>
              <th>Proposed path</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${operations.map(function (operation) {
              return html`<tr key=${operation.file_id} className=${"dirty-tidy-row-" + operation.status}>
                <td><span className="badge dirty-ui-badge dirty-tidy-status">${operation.status}</span></td>
                <td className="dirty-tidy-path">${docsCapture ? "Path hidden" : operation.source_path}</td>
                <td className="dirty-tidy-path">${docsCapture ? "Path hidden" : operation.destination_path}</td>
                <td><${PreviewNotes} operation=${operation} /></td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>`;
  }

    return { variableMenuItems: variableMenuItems, Summary: Summary, PreviewNotes: PreviewNotes, PreviewTable: PreviewTable };
  }

  window[INSTANCE_KEY] = { createPreview: createPreview };
})();
