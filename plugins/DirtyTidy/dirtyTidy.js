(function () {
  "use strict";

  var INSTANCE_KEY = "__dirtyTidyPlugin";
  if (window[INSTANCE_KEY]) return;

  var PluginApi = window.PluginApi;
  var DirtyPlugins = window.DirtyPlugins;
  if (!PluginApi || !DirtyPlugins || !DirtyPlugins.registerSettingsPanel) return;

  var React = PluginApi.React;
  var h = React.createElement;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;
  var SettingsCard = DirtyPlugins.react && DirtyPlugins.react.SettingsCard;
  var Section = DirtyPlugins.react && DirtyPlugins.react.SettingsSection;
  var Toggle = DirtyPlugins.react && DirtyPlugins.react.SettingsToggle;
  if (!SettingsCard || !Section || !Toggle) return;
  var PLUGIN_ID = "dirtyTidy";
  var PREVIEW_PAGE_SIZE = 50;
  var DEFAULT_SETTINGS = {
    moveEnabled: true,
    hierarchyLevels: ["{studio}", "{year}"],
    renameEnabled: false,
    renamePattern: "{date} - {studio} - {title}",
    maxFilenameLength: 180,
    multiValueSeparator: ", ",
    automationMode: "manual",
    approvedStrategyHash: "",
  };
  var VARIABLES = [
    ["title", "Title"],
    ["scene_id", "Scene ID"],
    ["date", "Date"],
    ["year", "Year"],
    ["month", "Month"],
    ["day", "Day"],
    ["rating", "Rating"],
    ["rating_bucket", "Rating bucket"],
    ["organized", "Organized"],
    ["studio", "Studio"],
    ["parent_studio", "Parent studio"],
    ["performers", "Performers"],
    ["first_performer", "First performer"],
    ["first_female_performer", "First female performer"],
    ["first_male_performer", "First male performer"],
    ["performer_count", "Performer count"],
    ["tags", "Tags"],
    ["first_tag", "First tag"],
    ["group", "Group"],
    ["group_position", "Group position"],
    ["resolution", "Resolution"],
    ["height", "Height"],
    ["video_codec", "Video codec"],
    ["duration", "Duration (minutes)"],
    ["duration_bucket", "Duration bucket"],
    ["source", "Source"],
    ["original_name", "Original name"],
    ["extension", "Extension"],
  ];

  function parseLevels(value) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_error) { value = [value]; }
    }
    if (!Array.isArray(value)) return DEFAULT_SETTINGS.hierarchyLevels.slice();
    var levels = value.map(function (item) {
      return typeof item === "object" && item ? item.template : item;
    }).map(function (item) { return String(item || "").trim(); }).filter(Boolean);
    return levels.length ? levels : DEFAULT_SETTINGS.hierarchyLevels.slice();
  }

  function settingsFromConfiguration(configuration) {
    var source = DirtyPlugins.values.asObject(configuration);
    var automationMode = ["manual", "scan", "generate"].indexOf(source.automationMode) >= 0
      ? source.automationMode
      : "manual";
    var approvedStrategyHash = /^[0-9a-f]{64}$/i.test(String(source.approvedStrategyHash || ""))
      ? String(source.approvedStrategyHash).toLowerCase()
      : "";
    return {
      moveEnabled: DirtyPlugins.values.coerceBoolean(source.moveEnabled, true),
      hierarchyLevels: parseLevels(source.hierarchyLevels),
      renameEnabled: DirtyPlugins.values.coerceBoolean(source.renameEnabled, false),
      renamePattern: String(source.renamePattern || DEFAULT_SETTINGS.renamePattern),
      maxFilenameLength: DirtyPlugins.values.clampInteger(
        source.maxFilenameLength,
        DEFAULT_SETTINGS.maxFilenameLength,
        16,
        255
      ),
      multiValueSeparator: String(source.multiValueSeparator || DEFAULT_SETTINGS.multiValueSeparator),
      automationMode: automationMode,
      approvedStrategyHash: approvedStrategyHash,
    };
  }

  function pluginResult(value) {
    var result = DirtyPlugins.values.parseMaybeJson(value);
    if (result && typeof result === "object" && result.error) {
      throw new Error(String(result.error));
    }
    if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "output")) {
      return DirtyPlugins.values.parseMaybeJson(result.output);
    }
    return result;
  }

  function runPreview(settings) {
    return DirtyPlugins.graphql(
      "mutation DirtyTidyPreview($pluginId:ID!,$args:Map!){" +
        "runPluginOperation(plugin_id:$pluginId,args:$args)}",
      {
        pluginId: PLUGIN_ID,
        args: {
          includeAll: true,
          mode: "preview",
          settings: settings,
        },
      }
    ).then(function (data) { return pluginResult(data.runPluginOperation); });
  }

  function queueExecution(strategyHash) {
    return DirtyPlugins.graphql(
      "mutation DirtyTidyExecute($pluginId:ID!,$description:String,$args:Map){" +
        "runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
      {
        pluginId: PLUGIN_ID,
        description: "Apply confirmed DirtyTidy file plan",
        args: { mode: "execute", expectedStrategyHash: strategyHash },
      }
    ).then(function (data) { return data.runPluginTask; });
  }

  function queueAutomation(trigger, sourceJobId) {
    return DirtyPlugins.graphql(
      "mutation DirtyTidyAutomation($pluginId:ID!,$description:String,$args:Map){" +
        "runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
      {
        pluginId: PLUGIN_ID,
        description: "Apply approved DirtyTidy strategy after " + trigger,
        args: {
          mode: "automation",
          automationTrigger: trigger,
          sourceJobId: String(sourceJobId),
        },
      }
    ).then(function (data) { return data.runPluginTask; });
  }

  function claimAutomationJob(jobId) {
    var storageKey = "dirtyTidy.automationJobs";
    try {
      var handled = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(handled)) handled = [];
      if (handled.indexOf(String(jobId)) >= 0) return false;
      handled.push(String(jobId));
      window.localStorage.setItem(storageKey, JSON.stringify(handled.slice(-50)));
      return true;
    } catch (_error) {
      return true;
    }
  }

  function DirtyTidyAutomationMonitor() {
    var useJobsSubscription = PluginApi.GQL && PluginApi.GQL.useJobsSubscribeSubscription;
    if (typeof useJobsSubscription !== "function") return null;
    var subscription = useJobsSubscription();
    var processingJobs = useRef({});
    var event = subscription && subscription.data && subscription.data.jobsSubscribe;
    var job = event && event.job;

    useEffect(function () {
      if (!job || job.status !== "FINISHED") return;
      var trigger = job.description === "Scanning..."
        ? "scan"
        : (job.description === "Generating..." ? "generate" : "");
      if (!trigger || processingJobs.current[job.id] || !claimAutomationJob(job.id)) return;
      processingJobs.current[job.id] = true;
      DirtyPlugins.getPluginSettings(PLUGIN_ID)
        .then(settingsFromConfiguration)
        .then(function (settings) {
          if (settings.automationMode !== trigger || !settings.approvedStrategyHash) return null;
          return queueAutomation(trigger, job.id).then(function (queuedJobId) {
            DirtyPlugins.ui.notify(
              "DirtyTidy queued after " + trigger + " as Stash job " + queuedJobId + "."
            );
          });
        })
        .catch(function (automationError) {
          console.error("DirtyTidy could not queue automation", automationError);
        });
    }, [job && job.id, job && job.status, job && job.description]);

    return null;
  }

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
      ["Ready", summary.ready || 0, "ready"],
      ["Moves", summary.moves || 0, "move"],
      ["Renames", summary.renames || 0, "rename"],
      ["Warnings", summary.warnings || 0, "warning"],
      ["Unchanged", summary.unchanged || 0, "unchanged"],
      ["Blocked", summary.blocked || 0, "blocked"],
    ];
    return h(
      "div",
      { className: "dirty-tidy-summary" },
      values.map(function (value) {
        return h("div", { className: "dirty-tidy-summary-item dirty-tidy-summary-" + value[2], key: value[0] },
          h("strong", null, String(value[1])),
          h("span", null, value[0])
        );
      })
    );
  }

  function PreviewTable(props) {
    var operations = props.operations || [];
    if (!operations.length) {
      return h("p", { className: "dirty-tidy-empty" }, "No operations match this filter.");
    }
    return h(
      "div",
      { className: "dirty-tidy-preview-table-wrap" },
      h("table", { className: "table table-sm dirty-tidy-preview-table" },
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
              h("td", null, h("span", { className: "badge dirty-tidy-status" }, operation.status)),
              h("td", { className: "dirty-tidy-path" }, operation.source_path),
              h("td", { className: "dirty-tidy-path" }, operation.destination_path),
              h("td", null, (operation.warnings || []).join(" "))
            );
          })
        )
      )
    );
  }

  function PreviewFilters(props) {
    var summary = props.summary || {};
    var filters = [
      ["all", "All", props.total || 0],
      ["ready", "Ready", summary.ready || 0],
      ["warning", "Warnings", summary.warnings || 0],
      ["blocked", "Blocked", summary.blocked || 0],
      ["unchanged", "Unchanged", summary.unchanged || 0],
    ];
    return h(
      "div",
      { className: "dirty-tidy-filters", role: "group", "aria-label": "Filter preview by status" },
      filters.map(function (filter) {
        var active = props.value === filter[0];
        return h(
          "button",
          {
            "aria-pressed": active,
            className: "dirty-tidy-filter" + (active ? " dirty-tidy-filter-active" : ""),
            disabled: props.disabled,
            key: filter[0],
            onClick: function () { props.onChange(filter[0]); },
            type: "button",
          },
          filter[1] + " (" + filter[2] + ")"
        );
      })
    );
  }

  function DirtyTidySettings(props) {
    var draftState = useState(function () {
      return settingsFromConfiguration(props.configuration);
    });
    var draft = draftState[0];
    var setDraft = draftState[1];
    var savedSettingsState = useState(function () {
      return settingsFromConfiguration(props.configuration);
    });
    var savedSettings = savedSettingsState[0];
    var setSavedSettings = savedSettingsState[1];
    var focusState = useState({ kind: "level", index: 0 });
    var focusTarget = focusState[0];
    var setFocusTarget = focusState[1];
    var previewState = useState(null);
    var preview = previewState[0];
    var setPreview = previewState[1];
    var busyState = useState(false);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var statusState = useState("");
    var status = statusState[0];
    var setStatus = statusState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var confirmedState = useState(false);
    var confirmed = confirmedState[0];
    var setConfirmed = confirmedState[1];
    var previewFilterState = useState("all");
    var previewFilter = previewFilterState[0];
    var setPreviewFilter = previewFilterState[1];
    var previewPageState = useState(1);
    var previewPage = previewPageState[0];
    var setPreviewPage = previewPageState[1];
    var settingsDirty = useMemo(function () {
      return JSON.stringify(draft) !== JSON.stringify(savedSettings);
    }, [draft, savedSettings]);

    useEffect(function () {
      var cancelled = false;
      DirtyPlugins.getPluginSettings(PLUGIN_ID).then(function (settings) {
        if (!cancelled) {
          var normalized = settingsFromConfiguration(settings);
          setDraft(normalized);
          setSavedSettings(normalized);
        }
      }).catch(function () {
        // The hub-provided configuration remains a usable fallback.
      });
      return function () { cancelled = true; };
    }, []);

    useEffect(function () {
      if (props.onDirtyChange) props.onDirtyChange(PLUGIN_ID, settingsDirty);
    }, [props.onDirtyChange, settingsDirty]);

    useEffect(function () {
      return function () {
        if (props.onDirtyChange) props.onDirtyChange(PLUGIN_ID, false);
      };
    }, [props.onDirtyChange]);

    function changed(update, affectsStrategy) {
      setDraft(function (current) {
        var next = Object.assign({}, current, update);
        if (affectsStrategy !== false) next.approvedStrategyHash = "";
        return next;
      });
      if (affectsStrategy !== false) {
        setPreview(null);
        setPreviewFilter("all");
        setPreviewPage(1);
        setConfirmed(false);
      }
      setStatus("");
      setError("");
    }

    function updateLevel(index, value) {
      var levels = draft.hierarchyLevels.slice();
      levels[index] = value;
      changed({ hierarchyLevels: levels });
    }

    function moveLevel(index, direction) {
      var nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= draft.hierarchyLevels.length) return;
      var levels = draft.hierarchyLevels.slice();
      var temporary = levels[index];
      levels[index] = levels[nextIndex];
      levels[nextIndex] = temporary;
      changed({ hierarchyLevels: levels });
      setFocusTarget({ kind: "level", index: nextIndex });
    }

    function removeLevel(index) {
      var levels = draft.hierarchyLevels.filter(function (_level, levelIndex) {
        return levelIndex !== index;
      });
      changed({ hierarchyLevels: levels });
      setFocusTarget({ kind: "level", index: Math.max(0, Math.min(index, levels.length - 1)) });
    }

    function addLevel() {
      var levels = draft.hierarchyLevels.concat(["{title}"]);
      changed({ hierarchyLevels: levels });
      setFocusTarget({ kind: "level", index: levels.length - 1 });
    }

    function insertVariable(token) {
      if (focusTarget.kind === "rename") {
        changed({ renamePattern: draft.renamePattern + token });
        return;
      }
      if (!draft.hierarchyLevels.length) {
        changed({ hierarchyLevels: [token] });
        setFocusTarget({ kind: "level", index: 0 });
        return;
      }
      var index = Math.max(0, Math.min(focusTarget.index, draft.hierarchyLevels.length - 1));
      updateLevel(index, draft.hierarchyLevels[index] + token);
    }

    function saveStrategy() {
      setBusy(true);
      setError("");
      setStatus("Saving strategy…");
      DirtyPlugins.configurePlugin(PLUGIN_ID, draft)
        .then(function () {
          setSavedSettings(draft);
          setStatus("Strategy saved.");
          DirtyPlugins.ui.notify("DirtyTidy strategy saved.");
        })
        .catch(function (saveError) {
          setError(saveError.message || String(saveError));
          setStatus("");
        })
        .then(function () { setBusy(false); });
    }

    function generatePreview() {
      setBusy(true);
      setError("");
      setStatus("Saving strategy and calculating preview…");
      DirtyPlugins.configurePlugin(PLUGIN_ID, draft)
        .then(function () {
          setSavedSettings(draft);
          return runPreview(draft);
        })
        .then(function (result) {
          setPreview(result);
          setPreviewFilter("all");
          setPreviewPage(1);
          setConfirmed(false);
          setStatus("Preview calculated from the saved strategy.");
        })
        .catch(function (previewError) {
          setError(previewError.message || String(previewError));
          setStatus("");
        })
        .then(function () { setBusy(false); });
    }

    function changePreviewFilter(value) {
      setPreviewFilter(value);
      setPreviewPage(1);
    }

    function execute() {
      if (!preview || !confirmed) return;
      setBusy(true);
      setError("");
      setStatus("Queueing confirmed operations…");
      queueExecution(preview.strategy_hash)
        .then(function (jobId) {
          setStatus("DirtyTidy queued as Stash job " + jobId + ". Progress is available in Tasks.");
          setConfirmed(false);
          DirtyPlugins.ui.notify("DirtyTidy execution queued.");
        })
        .catch(function (queueError) {
          setError(queueError.message || String(queueError));
          setStatus("");
        })
        .then(function () { setBusy(false); });
    }

    function approveAutomation() {
      if (!preview || !confirmed || draft.automationMode === "manual") return;
      var approvedSettings = Object.assign({}, draft, {
        approvedStrategyHash: preview.strategy_hash,
      });
      setBusy(true);
      setError("");
      setStatus("Saving automation approval…");
      DirtyPlugins.configurePlugin(PLUGIN_ID, approvedSettings)
        .then(function () {
          setDraft(approvedSettings);
          setSavedSettings(approvedSettings);
          setConfirmed(false);
          setStatus(
            "Approved. DirtyTidy will run after completed " +
            (approvedSettings.automationMode === "scan" ? "Scan" : "Generate") +
            " jobs while the Stash UI is open."
          );
          DirtyPlugins.ui.notify("DirtyTidy automation enabled.");
        })
        .catch(function (approvalError) {
          setError(approvalError.message || String(approvalError));
          setStatus("");
        })
        .then(function () { setBusy(false); });
    }

    var previewReady = preview && preview.summary && preview.summary.ready > 0;
    var previewOperations = preview && Array.isArray(preview.operations) ? preview.operations : [];
    var filteredOperations = previewFilter === "all"
      ? previewOperations
      : previewOperations.filter(function (operation) { return operation.status === previewFilter; });
    var filteredTotal = filteredOperations.length;
    var previewPages = Math.max(1, Math.ceil(filteredTotal / PREVIEW_PAGE_SIZE));
    var visibleOperations = filteredOperations.slice(
      (previewPage - 1) * PREVIEW_PAGE_SIZE,
      previewPage * PREVIEW_PAGE_SIZE
    );
    var strategyDescription = useMemo(function () {
      if (!draft.moveEnabled && !draft.renameEnabled) return "Both operations are disabled.";
      var actions = [];
      if (draft.moveEnabled) actions.push("move into " + draft.hierarchyLevels.length + " hierarchy level(s)");
      if (draft.renameEnabled) actions.push("rename using the configured pattern");
      return "DirtyTidy will " + actions.join(" and ") + ".";
    }, [draft.moveEnabled, draft.renameEnabled, draft.hierarchyLevels.length]);

    return h(
      SettingsCard,
      { bodyClassName: "dirty-tidy-body", className: "dirty-tidy-card", plugin: props.plugin },
        h(Section, {
          title: "Organize folders",
          description: "Every level stays relative to the file's current Stash source. Missing values render as Unknown.",
        },
          h(Toggle, {
            checked: draft.moveEnabled,
            label: "Move files into the configured hierarchy",
            onChange: function (value) { changed({ moveEnabled: value }); },
          }),
          h("div", { className: "dirty-tidy-levels" },
            draft.hierarchyLevels.map(function (level, index) {
              return h("div", { className: "dirty-tidy-level", key: index },
                h("span", { className: "dirty-tidy-level-number" }, String(index + 1)),
                h("input", {
                  "aria-label": "Hierarchy level " + (index + 1),
                  className: "form-control",
                  disabled: !draft.moveEnabled,
                  onChange: function (event) { updateLevel(index, event.target.value); },
                  onFocus: function () { setFocusTarget({ kind: "level", index: index }); },
                  type: "text",
                  value: level,
                }),
                h("button", { "aria-label": "Move level up", className: "dirty-ui-icon-button", disabled: index === 0, onClick: function () { moveLevel(index, -1); }, type: "button" }, "↑"),
                h("button", { "aria-label": "Move level down", className: "dirty-ui-icon-button", disabled: index === draft.hierarchyLevels.length - 1, onClick: function () { moveLevel(index, 1); }, type: "button" }, "↓"),
                h("button", { "aria-label": "Remove level", className: "dirty-ui-icon-button", onClick: function () { removeLevel(index); }, type: "button" }, "×")
              );
            }),
            h("button", { className: "btn btn-secondary dirty-ui-button", disabled: !draft.moveEnabled, onClick: addLevel, type: "button" }, "+ Add hierarchy level")
          )
        ),
        h(Section, {
          title: "Rename files",
          description: "The original extension is preserved. Invalid filename characters are removed before the maximum length is applied.",
        },
          h(Toggle, {
            checked: draft.renameEnabled,
            label: "Rename files using a template",
            onChange: function (value) { changed({ renameEnabled: value }); },
          }),
          h("div", { className: "dirty-tidy-field" },
            h("label", { htmlFor: "dirty-tidy-rename-pattern" }, "Filename pattern"),
            h("input", {
              className: "form-control",
              disabled: !draft.renameEnabled,
              id: "dirty-tidy-rename-pattern",
              onChange: function (event) { changed({ renamePattern: event.target.value }); },
              onFocus: function () { setFocusTarget({ kind: "rename" }); },
              type: "text",
              value: draft.renamePattern,
            })
          ),
          h("div", { className: "dirty-tidy-field-row" },
            h("div", { className: "dirty-tidy-field" },
              h("label", { htmlFor: "dirty-tidy-max-length" }, "Maximum filename length"),
              h("input", {
                className: "form-control",
                disabled: !draft.renameEnabled,
                id: "dirty-tidy-max-length",
                max: 255,
                min: 16,
                onChange: function (event) { changed({ maxFilenameLength: Number(event.target.value) }); },
                type: "number",
                value: draft.maxFilenameLength,
              })
            ),
            h("div", { className: "dirty-tidy-field" },
              h("label", { htmlFor: "dirty-tidy-separator" }, "Multi-value separator"),
              h("input", {
                className: "form-control",
                id: "dirty-tidy-separator",
                maxLength: 10,
                onChange: function (event) { changed({ multiValueSeparator: event.target.value }); },
                type: "text",
                value: draft.multiValueSeparator,
              })
            )
          )
        ),
        h(Section, {
          title: "Template variables",
          description: "Focus a hierarchy level or the filename pattern, then choose a variable to insert it.",
        }, h(VariablePicker, { onInsert: insertVariable })),
        h(Section, {
          title: "Automation",
          description: "Choose when an approved strategy runs. Stash exposes job completion to UI plugins, so the Stash UI must remain open until that Scan or Generate job finishes.",
        },
          h("select", {
            "aria-label": "DirtyTidy automation mode",
            className: "form-control dirty-tidy-automation",
            disabled: busy,
            onChange: function (event) { changed({ automationMode: event.target.value }, false); },
            value: draft.automationMode,
          },
            h("option", { value: "manual" }, "Manual only"),
            h("option", { value: "scan" }, "After Scan completes"),
            h("option", { value: "generate" }, "After Generate completes")
          ),
          draft.automationMode !== "manual" && h(
            "p",
            { className: "dirty-tidy-automation-state" },
            draft.approvedStrategyHash
              ? "Automation is approved for the current strategy."
              : "Automation is inactive. Save and preview, review the result, then approve it below."
          )
        ),
        h(Section, {
          title: "Preview and run",
          description: strategyDescription,
        },
          h("div", { className: "dirty-tidy-actions" },
            h("button", { className: "btn btn-secondary dirty-ui-button", disabled: busy, onClick: saveStrategy, type: "button" }, busy ? "Working…" : "Save strategy"),
            h("button", { className: "btn btn-primary dirty-ui-button", disabled: busy || (!draft.moveEnabled && !draft.renameEnabled), onClick: generatePreview, type: "button" }, busy ? "Working…" : "Save and preview")
          ),
          error && h("div", { className: "dirty-tidy-message dirty-ui-text-error", role: "alert" }, error),
          status && h("div", { className: "dirty-tidy-message", role: "status" }, status),
          preview && h(React.Fragment, null,
            h(Summary, { summary: preview.summary }),
            h(PreviewFilters, {
              disabled: busy,
              onChange: changePreviewFilter,
              summary: preview.summary,
              total: preview.total,
              value: previewFilter,
            }),
            h(PreviewTable, { operations: visibleOperations }),
            previewPages > 1 && h("div", { className: "dirty-tidy-pagination" },
              h("button", { className: "btn btn-secondary dirty-ui-button", disabled: previewPage <= 1, onClick: function () { setPreviewPage(previewPage - 1); }, type: "button" }, "Previous"),
              h("span", null, "Page " + previewPage + " of " + previewPages + " · " + filteredTotal + " matching"),
              h("button", { className: "btn btn-secondary dirty-ui-button", disabled: previewPage >= previewPages, onClick: function () { setPreviewPage(previewPage + 1); }, type: "button" }, "Next")
            ),
            h("div", { className: "dirty-tidy-confirm" },
              h(Toggle, {
                checked: confirmed,
                label: "I reviewed this preview and confirm the ready operations.",
                onChange: setConfirmed,
              }),
              h("button", {
                className: "btn btn-danger dirty-ui-button",
                disabled: busy || !confirmed || !previewReady,
                onClick: execute,
                type: "button",
              }, "Run " + ((preview.summary && preview.summary.ready) || 0) + " operation(s)"),
              draft.automationMode !== "manual" && h("button", {
                className: "btn btn-primary dirty-ui-button",
                disabled: busy || !confirmed,
                onClick: approveAutomation,
                type: "button",
              }, "Approve and enable after " + (draft.automationMode === "scan" ? "Scan" : "Generate"))
            )
          )
        )
    );
  }

  if (PluginApi.patch && PluginApi.patch.after) {
    PluginApi.patch.after("App", function () {
      var args = Array.prototype.slice.call(arguments);
      var result = args.pop();
      return h(
        React.Fragment,
        null,
        result,
        h(DirtyTidyAutomationMonitor, { key: "dirty-tidy-automation-monitor" })
      );
    });
  }
  DirtyPlugins.registerSettingsPanel(PLUGIN_ID, DirtyTidySettings);
  window[INSTANCE_KEY] = {
    automationMonitor: DirtyTidyAutomationMonitor,
    settingsPanel: DirtyTidySettings,
  };
})();
