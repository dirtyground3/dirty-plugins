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
  var html = DirtyPlugins.react && DirtyPlugins.react.html;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;
  var ui = DirtyPlugins.react || {};
  var Section = DirtyPlugins.react && DirtyPlugins.react.SettingsSection;
  var Toggle = DirtyPlugins.react && DirtyPlugins.react.SettingsToggle;
  var Field = ui.Field, Pagination = ui.Pagination, Button = ui.Button, ActionMenu = ui.ActionMenu;
  var Badge = ui.Badge, Dialog = ui.Dialog, SaveStatus = ui.SaveStatus;
  if (!html || !Section || !Toggle || !Field || !Pagination || !Button || !ActionMenu || !Badge || !Dialog || !SaveStatus) return;
  var PLUGIN_ID = "dirtyTidy";
  var PREVIEW_PAGE_SIZE = 50;
  var settingsModule = window.__dirtyTidySettings;
  if (!settingsModule) return;
  var DEFAULT_SETTINGS = settingsModule.defaults;
  var VARIABLES = settingsModule.variables;
  var settingsFromConfiguration = settingsModule.settingsFromConfiguration;
  var parseLevels = settingsModule.parseLevels;
  var parseMaxFilenameLength = settingsModule.parseMaxFilenameLength;
  var parseSeparator = settingsModule.parseSeparator;
  var parseRenamePattern = settingsModule.parseRenamePattern;
  var parseBoolean = settingsModule.parseBoolean;

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
      (DirtyPlugins.isInternalScan ? DirtyPlugins.isInternalScan(job.id, job.startTime) : Promise.resolve(false))
        .then(function (internal) { return internal ? null : queueApprovedAutomation(trigger, job.id, jobKey); })
        .catch(function (automationError) {
          console.error("DirtyTidy could not queue automation", automationError);
          delete processingJobs.current[jobKey];
        });
    }, [event && event.type, job && job.id, job && job.status, job && job.description, job && job.startTime]);

    return null;
  }

  var previewModule = window.__dirtyTidyPreview;
  if (!previewModule) return;
  var previewViews = previewModule.createPreview({ html: html, React: React, DirtyPlugins: DirtyPlugins, variables: VARIABLES });
  var variableMenuItems = previewViews.variableMenuItems, Summary = previewViews.Summary;
  var PreviewTable = previewViews.PreviewTable;
  var TRIGGER_LABELS = { scan: "Scan", generate: "Generate" };
  var AUTOMATION_HELP = "Automation applies the approved folder and filename rules to the current library, including new scenes and updated metadata. The Stash UI must stay open until the Scan or Generate job finishes.";

  function VariableMenu(props) {
    return html`<${ActionMenu} className="dirty-tidy-variable-menu" label="+ Variable" ariaLabel=${props.ariaLabel} items=${variableMenuItems(props.onInsert)} />`;
  }

  // One switchable, expandable strategy part (folders or filename).
  function StrategyRow(props) {
    return html`
      <div className=${"dirty-ui-row" + (props.open ? " is-open" : "") + (props.enabled ? "" : " is-off")}>
        <div className="dirty-ui-row-main">
          <${Toggle} checked=${props.enabled} label=${html`<span className="sr-only">${props.title}</span>`} onChange=${props.onEnabled} />
          <button type="button" className="dirty-ui-row-summary" aria-expanded=${props.open} onClick=${props.onToggle}>
            <span className="dirty-ui-row-title">${props.title}</span>
            <span className="dirty-ui-row-detail dirty-tidy-template">${props.enabled ? props.detail : "Off"}</span>
          </button>
        </div>
        ${props.open && html`<div className="dirty-ui-row-editor">${props.children}</div>`}
      </div>`;
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
    var previewState = useState(null);
    var preview = previewState[0];
    var setPreview = previewState[1];
    var busyState = useState("");
    var busy = busyState[0];
    var setBusy = busyState[1];
    var statusState = useState("");
    var status = statusState[0];
    var setStatus = statusState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var previewFilterState = useState("all");
    var previewFilter = previewFilterState[0];
    var setPreviewFilter = previewFilterState[1];
    var previewPageState = useState(1);
    var previewPage = previewPageState[0];
    var setPreviewPage = previewPageState[1];
    var openState = useState("");
    var openRow = openState[0];
    var setOpenRow = openState[1];
    var showFilesState = useState(false);
    var showFiles = showFilesState[0];
    var setShowFiles = showFilesState[1];
    var confirmState = useState(false);
    var confirming = confirmState[0];
    var setConfirming = confirmState[1];
    var approveState = useState(true);
    var approve = approveState[0];
    var setApprove = approveState[1];
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
      if (affectsStrategy !== false) {
        setPreview(null);
        setPreviewFilter("all");
        setPreviewPage(1);
        setShowFiles(false);
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
    }

    function removeLevel(index) {
      changed({ hierarchyLevels: draft.hierarchyLevels.filter(function (_level, levelIndex) { return levelIndex !== index; }) });
    }

    function addLevel() {
      changed({ hierarchyLevels: draft.hierarchyLevels.concat(["{title}"]) });
    }

    function failed(failure) {
      setError(failure.message || String(failure));
      setStatus("");
    }

    function saveStrategy() {
      setBusy("save");
      setError("");
      DirtyPlugins.configurePlugin(PLUGIN_ID, draft)
        .then(function () {
          setSavedSettings(draft);
          setStatus("Strategy saved.");
        })
        .catch(failed)
        .then(function () { setBusy(""); });
    }

    function generatePreview() {
      setBusy("preview");
      setError("");
      setStatus("");
      runPreview(draft)
        .then(function (result) {
          setPreview(result);
          // Adopt the backend's normalized settings so what the panel shows (and
          // later saves) is exactly what the preview's strategy hash was built
          // from. The server is authoritative; the client only mirrors it.
          if (result && result.settings) setDraft(settingsFromConfiguration(result.settings));
          setPreviewFilter("all");
          setPreviewPage(1);
          setShowFiles(false);
          setOpenRow("");
        })
        .catch(failed)
        .then(function () { setBusy(""); });
    }

    function changePreviewFilter(value) {
      setPreviewFilter(value);
      setPreviewPage(1);
      setShowFiles(true);
    }

    function openConfirmation() {
      setApprove(true);
      setConfirming(true);
    }

    // The confirmation dialog is the explicit review step: it saves exactly
    // the previewed strategy, optionally approves it for automation, and then
    // queues the reviewed plan.
    function applyPlan(runNow) {
      if (!preview) return;
      var automated = draft.automationMode !== "manual" && approve;
      var approvedSettings = automated ? Object.assign({}, draft, {
        approvedStrategyHash: preview.strategy_hash,
        approvedPlanDigest: preview.plan_digest || "",
      }) : draft;
      setBusy("apply");
      setError("");
      DirtyPlugins.configurePlugin(PLUGIN_ID, approvedSettings)
        .then(function () {
          setDraft(approvedSettings);
          setSavedSettings(approvedSettings);
          return runNow ? queueExecution(preview.strategy_hash) : null;
        })
        .then(function (jobId) {
          setConfirming(false);
          var automationText = automated ? " Automation is on after every " + TRIGGER_LABELS[draft.automationMode] + "." : "";
          setStatus(jobId ? "Queued as Stash job " + jobId + "; progress is in Tasks." + automationText : "Strategy saved." + automationText);
          DirtyPlugins.ui.notify(jobId ? "DirtyTidy execution queued." : "DirtyTidy strategy saved.");
          if (jobId) setPreview(null);
        })
        .catch(failed)
        .then(function () { setBusy(""); });
    }

    var summary = (preview && preview.summary) || {};
    var readyCount = summary.ready || 0;
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
    var trigger = TRIGGER_LABELS[draft.automationMode];
    var approved = Boolean(draft.approvedStrategyHash);
    var levelsText = draft.hierarchyLevels.length ? draft.hierarchyLevels.join(" / ") + " /" : "No folder levels";
    function stashIdNote(required) { return required ? " · only scenes with a Stash ID" : ""; }

    return html`
      <div className="dirty-tidy">
        <div className="dirty-ui-toolbar">
          <h3>Strategy</h3>
          <select
            aria-label="DirtyTidy automation mode"
            className="form-control dirty-ui-select dirty-tidy-automation"
            disabled=${Boolean(busy)}
            onChange=${function (event) { changed({ automationMode: event.target.value }, false); }}
            title=${AUTOMATION_HELP}
            value=${draft.automationMode}
          >
            <option value="manual">Manual only</option>
            <option value="scan">Run after Scan</option>
            <option value="generate">Run after Generate</option>
          </select>
          ${trigger && html`<${Badge}
            className=${approved ? "dirty-tidy-approved" : "dirty-tidy-unapproved"}
            title=${approved ? "Approved for the current strategy, including future scenes." : "Preview the strategy and approve it when you run it."}
          >${approved ? "Approved" : "Needs approval"}<//>`}
          <${SaveStatus} state=${settingsDirty ? "pending" : "saved"} message=${settingsDirty ? "Unsaved changes" : "Saved"} />
          <span className="dirty-ui-spacer"></span>
          <${Button} disabled=${Boolean(busy) || !settingsDirty} busy=${busy === "save"} onClick=${saveStrategy}>Save<//>
          <${Button} tone="primary" busy=${busy === "preview"} disabled=${Boolean(busy) || (!draft.moveEnabled && !draft.renameEnabled)} onClick=${generatePreview}>Preview<//>
        </div>
        ${error && html`<div className="dirty-tidy-message dirty-ui-text-error" role="alert">${error}</div>`}
        ${status && html`<div className="dirty-tidy-message" role="status">${status}</div>`}
        <div className="dirty-ui-row-list">
          <${StrategyRow}
            title="Move into folders"
            detail=${levelsText + stashIdNote(draft.moveRequireStashId)}
            enabled=${draft.moveEnabled}
            onEnabled=${function (value) { changed({ moveEnabled: value }); }}
            open=${openRow === "move"}
            onToggle=${function () { setOpenRow(openRow === "move" ? "" : "move"); }}
          >
            <div className="dirty-tidy-levels">
              ${draft.hierarchyLevels.map(function (level, index) {
                return html`<div className="dirty-tidy-level" key=${index}>
                  <span className="dirty-tidy-level-number">${String(index + 1)}</span>
                  <input
                    aria-label=${"Folder level " + (index + 1)}
                    className="form-control"
                    onChange=${function (event) { updateLevel(index, event.target.value); }}
                    type="text"
                    value=${level}
                  />
                  <${VariableMenu} ariaLabel=${"Insert variable into folder level " + (index + 1)} onInsert=${function (token) { updateLevel(index, level + token); }} />
                  <${ActionMenu} ariaLabel=${"Actions for folder level " + (index + 1)} items=${[
                    { label: "Move up", disabled: index === 0, onSelect: function () { moveLevel(index, -1); } },
                    { label: "Move down", disabled: index === draft.hierarchyLevels.length - 1, onSelect: function () { moveLevel(index, 1); } },
                    { label: "Remove level", tone: "danger", onSelect: function () { removeLevel(index); } },
                  ]} />
                </div>`;
              })}
              <div><${Button} compact tone="quiet" onClick=${addLevel}>+ Add folder level<//></div>
            </div>
            <p className="dirty-tidy-help">Folders are created inside each file's current library folder. Missing values become “Unknown”.</p>
            <${Toggle}
              checked=${draft.moveRequireStashId}
              label="Only scenes with a Stash ID"
              onChange=${function (value) { changed({ moveRequireStashId: value }); }}
            />
          <//>
          <${StrategyRow}
            title="Rename files"
            detail=${(draft.renamePattern || "No pattern") + ".ext" + stashIdNote(draft.renameRequireStashId)}
            enabled=${draft.renameEnabled}
            onEnabled=${function (value) { changed({ renameEnabled: value }); }}
            open=${openRow === "rename"}
            onToggle=${function () { setOpenRow(openRow === "rename" ? "" : "rename"); }}
          >
            <${Field}
              id="dirty-tidy-rename-pattern"
              label="Filename pattern"
              className="dirty-tidy-field"
              help="The extension is kept. Missing variables are skipped and invalid characters removed."
              action=${html`<${VariableMenu} ariaLabel="Insert variable into filename pattern" onInsert=${function (token) { changed({ renamePattern: draft.renamePattern + token }); }} />`}
            >
              <input
                className="form-control"
                onChange=${function (event) { changed({ renamePattern: event.target.value }); }}
                type="text"
                value=${draft.renamePattern}
              />
            <//>
            <${Toggle}
              checked=${draft.renameRequireStashId}
              label="Only scenes with a Stash ID"
              onChange=${function (value) { changed({ renameRequireStashId: value }); }}
            />
            <details className="dirty-tidy-advanced">
              <summary>${"Advanced · max " + draft.maxFilenameLength + " characters · separator “" + draft.multiValueSeparator + "”"}</summary>
              <div className="dirty-tidy-field-row">
                <${Field} id="dirty-tidy-max-length" label="Maximum filename length" className="dirty-tidy-field">
                  <input
                    className="form-control"
                    max=${255}
                    min=${16}
                    onChange=${function (event) { changed({ maxFilenameLength: Number(event.target.value) }); }}
                    type="number"
                    value=${draft.maxFilenameLength}
                  />
                <//>
                <${Field} id="dirty-tidy-separator" label="Separator for multiple values" className="dirty-tidy-field" help="Used between performers or tags.">
                  <input
                    className="form-control"
                    maxLength=${10}
                    onChange=${function (event) { changed({ multiValueSeparator: event.target.value }); }}
                    type="text"
                    value=${draft.multiValueSeparator}
                  />
                <//>
              </div>
            </details>
          <//>
        </div>
        ${preview && html`<${Section}
          className="dirty-tidy-preview"
          title="Preview"
          description=${settingsDirty ? "Uses unsaved changes; they're saved when you run. Nothing has changed yet." : "Nothing has changed yet."}
        >
          <${Summary}
            disabled=${Boolean(busy)}
            onChange=${changePreviewFilter}
            summary=${summary}
            total=${preview.total}
            value=${previewFilter}
          />
          <div className="dirty-ui-control-row dirty-tidy-preview-actions">
            <${Button} tone="quiet" pressed=${showFiles} onClick=${function () { setShowFiles(!showFiles); }}>${showFiles ? "Hide files" : "Show files"}<//>
            <span className="dirty-ui-spacer"></span>
            <${Button} tone="quiet" onClick=${function () { setPreview(null); setShowFiles(false); }}>Discard<//>
            <${Button}
              tone="primary"
              disabled=${Boolean(busy) || (!readyCount && !trigger)}
              onClick=${openConfirmation}
            >${readyCount ? "Run " + readyCount + (readyCount === 1 ? " operation…" : " operations…") : trigger ? "Approve automation…" : "Nothing to run"}<//>
          </div>
          ${showFiles && html`<${React.Fragment}>
            <${PreviewTable} operations=${visibleOperations} />
            ${previewPages > 1 && html`<${Pagination}
              className="dirty-tidy-pagination"
              ariaLabel="Preview pages"
              page=${previewPage}
              totalPages=${previewPages}
              onPageChange=${setPreviewPage}
              summary=${"Page " + previewPage + " of " + previewPages + " · " + filteredTotal + " matching"}
            />`}
          <//>`}
        <//>`}
        <${Dialog} open=${confirming && Boolean(preview)} ariaLabel="Confirm DirtyTidy plan" onClose=${function () { setConfirming(false); }} className="dirty-ui-panel dirty-tidy-confirm-dialog">
          <h2>${readyCount ? "Apply " + readyCount + (readyCount === 1 ? " file operation?" : " file operations?") : "Approve automation?"}</h2>
          ${readyCount > 0 && html`<p>
            ${"Move " + (summary.moves || 0) + " · Rename " + (summary.renames || 0)}
            ${summary.blocked ? html`<span className="dirty-ui-text-error">${" · " + summary.blocked + " blocked files are skipped"}</span>` : ""}
          </p>`}
          <p className="dirty-tidy-help">${readyCount ? "The strategy is saved first. Files are moved through Stash; progress appears in Tasks." : "The strategy is saved and applied after every " + trigger + "."}</p>
          ${trigger && readyCount > 0 && html`<${Toggle}
            checked=${approve}
            label=${"Also apply automatically after every " + trigger}
            onChange=${setApprove}
          />`}
          <div className="dirty-ui-control-row">
            <${Button} onClick=${function () { setConfirming(false); }}>Cancel<//>
            ${trigger && readyCount > 0 && approve && html`<${Button} disabled=${Boolean(busy)} onClick=${function () { applyPlan(false); }}>Approve without running<//>`}
            <${Button} tone=${readyCount ? "danger" : "primary"} busy=${busy === "apply"} disabled=${Boolean(busy)} onClick=${function () { applyPlan(readyCount > 0); }}>${readyCount ? "Run now" : "Approve"}<//>
          </div>
        <//>
      </div>`;
  }

  if (PluginApi.patch && PluginApi.patch.after) {
    PluginApi.patch.after("App", function () {
      var args = Array.prototype.slice.call(arguments);
      var result = args.pop();
      return html`<${React.Fragment}>
        ${result}
        <${DirtyTidyAutomationMonitor} key="dirty-tidy-automation-monitor" />
      <//>`;
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
