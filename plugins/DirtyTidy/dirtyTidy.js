(function () {
  "use strict";

  var INSTANCE_KEY = "__dirtyTidyPlugin";
  if (window[INSTANCE_KEY]) {
    if (window.DirtyPlugins && window.DirtyPlugins.debugLog) {
      window.DirtyPlugins.debugLog("dirtyTidy", "skipped: duplicate load");
    }
    return;
  }

  var PluginApi = window.PluginApi;
  var DirtyPlugins = window.DirtyPlugins;
  if (!PluginApi || !DirtyPlugins || !DirtyPlugins.registerSettingsPanel) {
    if (window.DirtyPlugins && window.DirtyPlugins.debugLog) {
      window.DirtyPlugins.debugLog("dirtyTidy", "skipped: required runtime missing", {
        hasPluginApi: Boolean(PluginApi),
        hasDirtyPlugins: Boolean(DirtyPlugins),
      });
    }
    return;
  }
  window.__dirtyCurrentPluginId = "dirtyTidy";
  var debugLog = DirtyPlugins.debugLog || function () {};
  var debugScriptSrc = null;
  try {
    debugScriptSrc = (typeof document !== "undefined" && document.currentScript) ? document.currentScript.src : null;
  } catch (_debugError) {}
  debugLog("dirtyTidy", "script started", { script: debugScriptSrc });

  var React = PluginApi.React;
  var h = React.createElement;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;
  var SettingsCard = DirtyPlugins.react && DirtyPlugins.react.SettingsCard;
  var Section = DirtyPlugins.react && DirtyPlugins.react.SettingsSection;
  var Toggle = DirtyPlugins.react && DirtyPlugins.react.SettingsToggle;
  var Field = DirtyPlugins.react && DirtyPlugins.react.Field;
  var Pagination = DirtyPlugins.react && DirtyPlugins.react.Pagination;
  var IconButton = DirtyPlugins.react && DirtyPlugins.react.IconButton;
  if (!SettingsCard || !Section || !Toggle || !Field || !Pagination || !IconButton) return;
  var PLUGIN_ID = "dirtyTidy";
  var PREVIEW_PAGE_SIZE = 50;
  var DEFAULT_SETTINGS = {
    moveEnabled: true,
    moveRequireStashId: false,
    hierarchyLevels: ["{studio}", "{year}"],
    renameEnabled: false,
    renameRequireStashId: false,
    renamePattern: "{date} - {studio} - {title}",
    maxFilenameLength: 180,
    multiValueSeparator: ", ",
    automationMode: "manual",
    approvedStrategyHash: "",
    approvedPlanDigest: "",
  };
  var VARIABLES = [
    ["title", "Title"],
    ["scene_id", "Scene ID"],
    ["stash_id", "Stash ID"],
    ["date", "Date"],
    ["year", "Year"],
    ["month", "Month"],
    ["day", "Day"],
    ["rating", "Rating"],
    ["grade", "Grade (A–F)"],
    ["rating_bucket", "Rating bucket"],
    ["organized", "Organized"],
    ["studio", "Studio"],
    ["parent_studio", "Parent studio"],
    ["performers", "Performers"],
    ["first_performer", "First performer"],
    ["female_performers", "Female performers"],
    ["male_performers", "Male performers"],
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

  // The Python backend's normalize_settings() is the single source of truth.
  // These helpers mirror it exactly so a saved draft always hashes to the same
  // strategy the server planned with, and so a stale preview cannot be caused
  // by the two sides defaulting differently.
  function parseLevels(value) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_error) { value = [value]; }
    }
    if (!Array.isArray(value)) return DEFAULT_SETTINGS.hierarchyLevels.slice();
    // An explicit all-empty list stays empty rather than reverting to the
    // defaults the server would never plan with.
    return value.map(function (item) {
      var template = (typeof item === "object" && item) ? item.template : item;
      return template ? String(template).trim() : "";
    }).filter(Boolean);
  }

  function parseMaxFilenameLength(value) {
    var number;
    if (typeof value === "number" && Number.isFinite(value)) number = Math.trunc(value);
    else if (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) number = parseInt(value.trim(), 10);
    else return DEFAULT_SETTINGS.maxFilenameLength;
    return Math.max(16, Math.min(255, number));
  }

  function parseSeparator(value) {
    var separator = value == null ? DEFAULT_SETTINGS.multiValueSeparator : String(value);
    if (!separator) separator = DEFAULT_SETTINGS.multiValueSeparator;
    return separator.slice(0, 10);
  }

  function parseRenamePattern(source) {
    if (!Object.prototype.hasOwnProperty.call(source, "renamePattern")) {
      return DEFAULT_SETTINGS.renamePattern;
    }
    return source.renamePattern ? String(source.renamePattern).trim() : "";
  }

  function parseBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
      return Boolean(value);
    }
    if (value === null || value === undefined) return fallback;
    if (typeof value === "number") return value !== 0;
    return Boolean(value);
  }

  function parseAutomationMode(value) {
    var mode = String(value == null ? "" : value).trim().toLowerCase();
    return ["manual", "scan", "generate"].indexOf(mode) >= 0 ? mode : "manual";
  }

  function parseApprovalHash(value) {
    var hash = String(value == null ? "" : value).trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(hash) ? hash : "";
  }

  function settingsFromConfiguration(configuration) {
    var source = DirtyPlugins.values.asObject(configuration);
    return {
      moveEnabled: parseBoolean(source.moveEnabled, true),
      moveRequireStashId: parseBoolean(source.moveRequireStashId, false),
      hierarchyLevels: parseLevels(source.hierarchyLevels),
      renameEnabled: parseBoolean(source.renameEnabled, false),
      renameRequireStashId: parseBoolean(source.renameRequireStashId, false),
      renamePattern: parseRenamePattern(source),
      maxFilenameLength: parseMaxFilenameLength(source.maxFilenameLength),
      multiValueSeparator: parseSeparator(source.multiValueSeparator),
      automationMode: parseAutomationMode(source.automationMode),
      approvedStrategyHash: parseApprovalHash(source.approvedStrategyHash),
      approvedPlanDigest: parseApprovalHash(source.approvedPlanDigest),
    };
  }

  function runPreview(settings) {
    return DirtyPlugins.runPluginOperation(PLUGIN_ID, {
      includeAll: true,
      mode: "preview",
      settings: settings,
    });
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
    var storageKey = "dirtyTidy.automationJobs.v2";
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

  function releaseAutomationJob(jobId) {
    var storageKey = "dirtyTidy.automationJobs.v2";
    try {
      var handled = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
      if (!Array.isArray(handled)) return;
      window.localStorage.setItem(storageKey, JSON.stringify(handled.filter(function (handledJobId) {
        return handledJobId !== String(jobId);
      })));
    } catch (_error) {
      // A failed local-storage cleanup must not hide the original queue error.
    }
  }

  function queueApprovedAutomation(trigger, sourceJobId, jobKey) {
    return DirtyPlugins.getPluginSettings(PLUGIN_ID)
      .then(settingsFromConfiguration)
      .then(function (settings) {
        if (settings.automationMode !== trigger || !settings.approvedStrategyHash) return null;
        if (!claimAutomationJob(jobKey)) return null;
        return queueAutomation(trigger, sourceJobId)
          .then(function (queuedJobId) {
            DirtyPlugins.ui.notify(
              "DirtyTidy queued after " + trigger + " as Stash job " + queuedJobId + "."
            );
            return queuedJobId;
          })
          .catch(function (automationError) {
            releaseAutomationJob(jobKey);
            throw automationError;
          });
      });
  }

  function DirtyTidyAutomationMonitor() {
    var useJobsSubscription = PluginApi.GQL && PluginApi.GQL.useJobsSubscribeSubscription;
    if (typeof useJobsSubscription !== "function") return null;
    var jobsSubscription = useJobsSubscription();
    var processingJobs = useRef({});
    var event = jobsSubscription && jobsSubscription.data && jobsSubscription.data.jobsSubscribe;
    var job = event && event.job;

    useEffect(function () {
      if (!job) return;
      var trigger = job.description === "Scanning..." ? "scan" :
        job.description === "Generating..." ? "generate" : "";
      if (
        event.type !== "REMOVE" ||
        job.status !== "FINISHED" ||
        !trigger
      ) return;
      // Stash restarts its job counter on startup. The built-in JobsSubscribe
      // selection includes startTime, but not addTime (unlike JobData queries).
      // Use the start timestamp to identify runs across restarts and replays.
      if (!job.startTime) {
        console.error("DirtyTidy could not identify the completed job: missing startTime", job.id);
        return;
      }
      var jobKey = JSON.stringify([trigger, String(job.id), job.startTime]);
      if (processingJobs.current[jobKey]) return;
      processingJobs.current[jobKey] = true;
      // A finished REMOVE carries the scan identity itself, avoiding a race
      // between the separate scan-completion and job-removal subscriptions.
      queueApprovedAutomation(trigger, job.id, jobKey)
        .catch(function (automationError) {
          console.error("DirtyTidy could not queue automation", automationError);
          delete processingJobs.current[jobKey];
        });
    }, [event && event.type, job && job.id, job && job.status, job && job.description, job && job.startTime]);

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
        if (affectsStrategy !== false) {
          next.approvedStrategyHash = "";
          next.approvedPlanDigest = "";
        }
        return next;
      });
      setConfirmed(false);
      if (affectsStrategy !== false) {
        setPreview(null);
        setPreviewFilter("all");
        setPreviewPage(1);
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
      setStatus("Calculating preview from the current settings…");
      runPreview(draft)
        .then(function (result) {
          setPreview(result);
          // Adopt the backend's normalized settings so what the panel shows (and
          // later saves) is exactly what the preview's strategy hash was built
          // from. The server is authoritative; the client only mirrors it.
          if (result && result.settings) setDraft(settingsFromConfiguration(result.settings));
          setPreviewFilter("all");
          setPreviewPage(1);
          setConfirmed(false);
          setStatus(
            settingsDirty
              ? "Preview calculated. These settings have not been saved."
              : "Preview calculated from the saved strategy."
          );
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

    function confirmAndSavePreview() {
      if (!preview) return;
      setBusy(true);
      setError("");
      setStatus("Saving strategy and confirming preview…");
      DirtyPlugins.configurePlugin(PLUGIN_ID, draft)
        .then(function () {
          setSavedSettings(draft);
          setConfirmed(true);
          setStatus("Preview confirmed and strategy saved.");
          DirtyPlugins.ui.notify("DirtyTidy preview confirmed and strategy saved.");
        })
        .catch(function (confirmationError) {
          setError(confirmationError.message || String(confirmationError));
          setStatus("");
        })
        .then(function () { setBusy(false); });
    }

    function execute() {
      if (!preview || !confirmed || settingsDirty) return;
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
      if (!preview || !confirmed || settingsDirty || draft.automationMode === "manual") return;
      var approvedSettings = Object.assign({}, draft, {
        approvedStrategyHash: preview.strategy_hash,
        approvedPlanDigest: preview.plan_digest || "",
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
      : previewOperations.filter(function (operation) {
        if (previewFilter === "move" || previewFilter === "rename") {
          return (operation.actions || []).indexOf(previewFilter) !== -1;
        }
        return operation.status === previewFilter;
      });
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
          h(Toggle, {
            checked: draft.moveRequireStashId,
            label: "Only move files for scenes with a Stash ID",
            onChange: function (value) { changed({ moveRequireStashId: value }); },
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
                h(IconButton, { ariaLabel: "Move level up", fallback: "↑", disabled: index === 0, onClick: function () { moveLevel(index, -1); } }),
                h(IconButton, { ariaLabel: "Move level down", fallback: "↓", disabled: index === draft.hierarchyLevels.length - 1, onClick: function () { moveLevel(index, 1); } }),
                h(IconButton, { ariaLabel: "Remove level", fallback: "×", tone: "danger", onClick: function () { removeLevel(index); } })
              );
            }),
            h("button", { className: "btn btn-secondary dirty-ui-button", disabled: !draft.moveEnabled, onClick: addLevel, type: "button" }, "+ Add hierarchy level")
          )
        ),
        h(Section, {
          title: "Rename files",
          description: "Missing variables are skipped. The original extension is preserved, and invalid filename characters are removed before the maximum length is applied.",
        },
          h(Toggle, {
            checked: draft.renameEnabled,
            label: "Rename files using a template",
            onChange: function (value) { changed({ renameEnabled: value }); },
          }),
          h(Toggle, {
            checked: draft.renameRequireStashId,
            label: "Only rename files for scenes with a Stash ID",
            onChange: function (value) { changed({ renameRequireStashId: value }); },
          }),
          h(Field, { id: "dirty-tidy-rename-pattern", label: "Filename pattern", className: "dirty-tidy-field" },
            h("input", {
              className: "form-control",
              disabled: !draft.renameEnabled,
              onChange: function (event) { changed({ renamePattern: event.target.value }); },
              onFocus: function () { setFocusTarget({ kind: "rename" }); },
              type: "text",
              value: draft.renamePattern,
            })
          ),
          h("div", { className: "dirty-tidy-field-row" },
            h(Field, { id: "dirty-tidy-max-length", label: "Maximum filename length", className: "dirty-tidy-field" },
              h("input", {
                className: "form-control",
                disabled: !draft.renameEnabled,
                max: 255,
                min: 16,
                onChange: function (event) { changed({ maxFilenameLength: Number(event.target.value) }); },
                type: "number",
                value: draft.maxFilenameLength,
              })
            ),
            h(Field, { id: "dirty-tidy-separator", label: "Multi-value separator", className: "dirty-tidy-field" },
              h("input", {
                className: "form-control",
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
            className: "form-control dirty-ui-select dirty-tidy-automation",
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
            draft.approvedStrategyHash && draft.approvedPlanDigest
              ? "Automation is approved for the current strategy and plan."
              : "Automation is inactive. Preview and review the strategy, then use Confirm and save before approving below."
          )
        ),
        h(Section, {
          title: "Preview and run",
          description: strategyDescription,
        },
          h("div", { className: "dirty-tidy-actions" },
            h("button", { className: "btn btn-secondary dirty-ui-button", disabled: busy, onClick: saveStrategy, type: "button" }, busy ? "Working…" : "Save strategy"),
            h("button", { className: "btn btn-primary dirty-ui-button", disabled: busy || (!draft.moveEnabled && !draft.renameEnabled), onClick: generatePreview, type: "button" }, busy ? "Working…" : "Preview")
          ),
          error && h("div", { className: "dirty-tidy-message dirty-ui-text-error", role: "alert" }, error),
          status && h("div", { className: "dirty-tidy-message", role: "status" }, status),
          preview && h(React.Fragment, null,
            settingsDirty && h(
              "div",
              { className: "dirty-tidy-message", role: "status" },
              "This preview uses unsaved settings. Use Confirm and save before running or enabling automation."
            ),
            h(Summary, {
              disabled: busy,
              onChange: changePreviewFilter,
              summary: preview.summary,
              total: preview.total,
              value: previewFilter,
            }),
            h(PreviewTable, { operations: visibleOperations }),
            previewPages > 1 && h(Pagination, { className: "dirty-tidy-pagination", ariaLabel: "Preview pages", page: previewPage, totalPages: previewPages, onPageChange: setPreviewPage, summary: "Page " + previewPage + " of " + previewPages + " · " + filteredTotal + " matching" }),
            h("div", { className: "dirty-tidy-confirm" },
              h("button", {
                className: "btn btn-primary dirty-ui-button",
                disabled: busy || confirmed,
                onClick: confirmAndSavePreview,
                type: "button",
              }, "Confirm and save"),
              h("button", {
                className: "btn btn-danger dirty-ui-button",
                disabled: busy || !confirmed || !previewReady || settingsDirty,
                onClick: execute,
                type: "button",
              }, "Run " + ((preview.summary && preview.summary.ready) || 0) + " operation(s)"),
              draft.automationMode !== "manual" && h("button", {
                className: "btn btn-primary dirty-ui-button",
                disabled: busy || !confirmed || settingsDirty,
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
    algorithms: {
      settingsFromConfiguration: settingsFromConfiguration,
      parseLevels: parseLevels,
      parseMaxFilenameLength: parseMaxFilenameLength,
      parseSeparator: parseSeparator,
      parseRenamePattern: parseRenamePattern,
      parseBoolean: parseBoolean,
    },
  };
  debugLog("dirtyTidy", "script finished registering", {
    elapsedMs: DirtyPlugins.debugElapsed ? DirtyPlugins.debugElapsed() : null,
  });
  window.__dirtyCurrentPluginId = null;
})();
