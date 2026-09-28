(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCompactorPlugin";
  if (window[INSTANCE_KEY]) return;
  var api = window.PluginApi, hub = window.DirtyPlugins;
  if (!api || !hub || !hub.react.SceneFilterEditor || !hub.react.html) return;
  var React = api.React;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef;
  var ui = hub.react, html = ui.html, ID = "dirtyCompactor";
  var rules = window.__dirtyCompactorRules, automation = window.__dirtyCompactorAutomation;
  if (!rules || !automation) return;
  function operation(mode, args) { return hub.runPluginOperation(ID, Object.assign({ mode: mode }, args || {})); }
  var copy = rules.copy, bytes = rules.bytes, newRule = rules.newRule;
  var normalize = rules.normalize, validation = rules.validation, filterSummary = rules.filterSummary;
  function field(id, label, value, change, options, help) {
    var props = { value: value, onChange: function (event) { change(event.target.value); }, className: "form-control dirty-ui-select" };
    var control = options ? html`<select ...${props}>${options.map(function (item) {
      return html`<option key=${item[0]} value=${item[0]}>${item[1]}</option>`;
    })}</select>` : html`<input ...${Object.assign(props, { type: /-(width|height|rate)$/.test(id) ? "number" : "text", step: "any" })} />`;
    return html`<${ui.Field} id=${id} label=${label} help=${help}>${control}<//>`;
  }
  function RuleCard(props) {
    var r = props.rule, filterState = useState(false), openFilter = filterState[0], setOpenFilter = filterState[1];
    var matchState = useState(null), matches = matchState[0], setMatches = matchState[1];
    var matchKey = JSON.stringify(r.condition);
    useEffect(function () {
      var active = true;
      setMatches(null);
      var timer = setTimeout(function () {
        var condition = r.condition || {};
        if (!condition.all && !Object.keys(condition.scene || {}).length && !(condition.find || {}).q) return;
        hub.graphql("query($find:FindFilterType,$scene:SceneFilterType){findScenes(filter:$find,scene_filter:$scene){count}}",
          { find: Object.assign({}, condition.find, { per_page: 1 }), scene: condition.scene || {} })
          .then(function (data) { if (active) setMatches(data.findScenes.count); })
          .catch(function () { if (active) setMatches("unavailable"); });
      }, 500);
      return function () { active = false; clearTimeout(timer); };
    }, [matchKey]);
    function change(key, value) { var next = copy(r); next[key] = value; props.onChange(next); }
    var encoderOptions = [["auto", "Auto GPU → CPU"], ["cpu", "CPU"]];
    ((props.capabilities && props.capabilities.encoders[r.codec]) || []).forEach(function (kind) {
      if (kind !== "cpu") encoderOptions.push([kind, { nvenc: "NVIDIA NVENC", qsv: "Intel QSV", amf: "AMD AMF" }[kind]]);
    });
    if (!encoderOptions.some(function (option) { return option[0] === r.encoder; })) encoderOptions.push([r.encoder, r.encoder.toUpperCase() + " (not detected; CPU fallback)"]);
    var card = { name: (props.index + 1) + ". " + r.name,
      description: filterSummary(r.condition) + (matches === null ? "" : " · Matches: " + matches) };
    return html`
      <${ui.SettingsCard} className="dirty-compactor-rule" plugin=${card}>
        <div className="dirty-ui-control-row">
          <${ui.SettingsToggle} checked=${r.enabled} label="Enabled" onChange=${function (value) { change("enabled", value); }} />
          <${ui.Badge}>${r.mode === "automatic" ? "Automatic" : "Manual"}<//>
          <${ui.Button} compact disabled=${props.index === 0} onClick=${function () { props.onMove(-1); }} ariaLabel=${"Move " + r.name + " up"}>↑<//>
          <${ui.Button} compact disabled=${props.last} onClick=${function () { props.onMove(1); }} ariaLabel=${"Move " + r.name + " down"}>↓<//>
          <${ui.Button} compact onClick=${props.onDuplicate}>Duplicate<//>
          <${ui.Button} compact tone="danger" onClick=${props.onRemove}>Remove<//>
        </div>
        <details open=${props.initialOpen}>
          <summary>${"Edit rule · " + r.action}</summary>
          <div className="dirty-compactor-grid">
            ${field(r.id + "-name", "Name", r.name, function (v) { change("name", v); })}
            ${field(r.id + "-mode", "Execution", r.mode, function (v) { change("mode", v); }, [["manual", "Manual"], ["automatic", "Automatic after scans"]])}
          </div>
          <${ui.SettingsSection} title="Condition" description="The first enabled matching rule wins, even when it is Manual during an automatic run.">
            <div className="dirty-ui-control-row">
              <${ui.Button} onClick=${function () { setOpenFilter(true); }}>Edit scene filter<//>
              <${ui.SettingsToggle} checked=${r.condition.all} label="All scenes" onChange=${function (value) { change("condition", { all: value, scene: {}, find: {}, query: "" }); }} />
            </div>
          <//>
          <${ui.SceneFilterEditor} open=${openFilter} value=${r.condition} onClose=${function () { setOpenFilter(false); }} onChange=${function (v) { change("condition", v); }} />
          <${ui.SettingsSection} title="Action">
            ${field(r.id + "-action", "Action", r.action, function (v) { change("action", v); }, [["resize", "Resize"], ["reencode", "Reencode"], ["delete", "Delete scene and files"]])}
            ${r.action === "delete" ? html`<p className="dirty-compactor-danger">Deletes the scene, all associated media, and generated assets through Stash. Automatic rules do not ask again after scans.</p>` : html`
              <div className="dirty-compactor-grid">
                ${r.action === "resize" && field(r.id + "-preset", "Maximum resolution", "custom", function (v) {
                  if (v === "custom") return; var next = copy(r), d = v.split("x"); next.width = Number(d[0]); next.height = Number(d[1]); props.onChange(next);
                }, [["custom", "Custom / current dimensions"], ["854x480", "480p"], ["1280x720", "720p"], ["1920x1080", "1080p"], ["2560x1440", "1440p"], ["3840x2160", "2160p"]])}
                ${r.action === "resize" && field(r.id + "-width", "Maximum width", r.width, function (v) { change("width", v); })}
                ${r.action === "resize" && field(r.id + "-height", "Maximum height", r.height, function (v) { change("height", v); })}
                ${field(r.id + "-rate", "Target video bitrate (Mbps)", r.mbps, function (v) { change("mbps", v); }, null, "Video only. Audio and subtitles are retained; actual file savings are validated.")}
                ${field(r.id + "-codec", "Video codec", r.codec, function (v) { change("codec", v); }, [["h264", "H.264"], ["hevc", "H.265 / HEVC"]])}
                ${field(r.id + "-encoder", "Encoder", r.encoder, function (v) { change("encoder", v); }, encoderOptions)}
                ${field(r.id + "-format", "Output format", r.format, function (v) { change("format", v); }, [["keep", "Keep format"], ["allow", "Allow format change"]], "When necessary, allow MP4 or MKV while preserving supported streams.")}
              </div>`}
          <//>
        </details>
      <//>`;
  }
  function Results(props) {
    var record = props.record;
    return html`
      <${ui.SettingsSection} title=${props.title} description=${record.status + " · " + record.total + " operations"}>
        ${record.error && html`<${ui.StateView} title="Planning failed" detail=${record.error} />`}
        <p>${"Estimated savings: " + bytes(record.estimatedSavings) + " · Reclaimed: " + bytes(record.actualSavings)}</p>
        ${record.libraryBytesRemoved > 0 && html`<p>${"Removed from library: " + bytes(record.libraryBytesRemoved) + ". Disk space reclaimed depends on Stash trash settings."}</p>`}
        ${record.progress && html`<div role="status">${record.progress.stage} ${Math.round(record.progress.progress * 100) + "%"}</div>`}
        <div className="dirty-ui-table-wrap">
          <table className="dirty-ui-table dirty-compactor-table">
            <thead><tr>${["Scene / file", "Rule / action", "Proposed output", "Status"].map(function (label) {
              return html`<th key=${label} scope="col">${label}</th>`;
            })}</tr></thead>
            <tbody>${(record.operations || []).map(function (op) {
              return html`
                <tr key=${op.id}>
                  <td>
                    ${props.onExclude && html`<${ui.SettingsToggle} checked=${props.excluded.indexOf(op.sceneId) < 0} label=${"Include scene " + op.sceneId} onChange=${function (value) { props.onExclude(op.sceneId, !value); }} />`}
                    <a href=${"/scenes/" + op.sceneId}>${props.capture ? "Scene hidden" : op.title}</a>
                    <details>
                      <summary>File details</summary>
                      <span className="dirty-compactor-path">${props.capture ? "Path hidden" : op.source}</span>
                      ${op.media && html`<div>${op.media.width + " × " + op.media.height + " · " + (op.media.bitrate / 1e6).toFixed(2) + " Mbps"}</div>`}
                      ${op.identity && html`<div>${bytes(op.identity.size)}</div>`}
                    </details>
                  </td>
                  <td>${op.rule.name}<br />${op.rule.action}</td>
                  <td>
                    ${op.dimensions ? op.dimensions.join(" × ") + " · " + op.rule.mbps + " Mbps" : "Delete scene and files"}
                    <div>${"Estimated saving " + bytes(op.savings)}</div>
                    ${op.destination !== op.source && html`<div className="dirty-compactor-path">${props.capture ? "Path hidden" : op.destination}</div>`}
                  </td>
                  <td><${ui.Badge}>${op.status}<//>${op.reason && html`<p>${op.reason}</p>`}</td>
                </tr>`;
            })}</tbody>
          </table>
        </div>
        <${ui.Pagination} page=${record.page} totalPages=${record.pages} onPageChange=${props.onPage} ariaLabel="Operation pages" summary=${"Page " + record.page + " of " + record.pages} />
      <//>`;
  }
  function OutputReview(props) {
    var review = props.run.review, player = useRef(null);
    var failedState = useState(false), failed = failedState[0], setFailed = failedState[1];
    var busyState = useState(false), busy = busyState[0], setBusy = busyState[1];
    useEffect(function () { setBusy(false); setFailed(false); }, [review.operationId]);
    function release() { if (player.current) { player.current.pause(); player.current.removeAttribute("src"); player.current.load(); } }
    useEffect(function () { return release; }, []);
    function decide(mode) {
      release(); setBusy(true);
      props.act(mode, { id: props.run.id, operationId: review.operationId }).finally(function () { setBusy(false); });
    }
    var saved = review.originalSize - review.outputSize;
    var card = { name: "Encoded output ready for review", description: "Original unchanged. Accept installs this exact file without encoding again." };
    return html`
      <${ui.SettingsCard} className="dirty-compactor-review" plugin=${card}>
        <h3>${props.capture ? "Scene hidden" : review.title}</h3>
        ${props.capture ? html`<div className="dirty-compactor-media-placeholder">Media hidden for documentation</div>`
          : !busy && html`<video ref=${player} src=${review.url} controls preload="metadata" playsInline onError=${function () { setFailed(true); }} aria-label="Encoded output preview" />`}
        ${failed && html`<${ui.StateView} title="This browser cannot play the output" detail="Download the exact output for inspection in an external player. The preview is never transcoded." />`}
        <div className="dirty-compactor-grid">
          <p>${"Original: " + review.original.width + " × " + review.original.height + " · " + review.original.codec + " · " + (review.original.bitrate / 1e6).toFixed(2) + " Mbps · " + bytes(review.originalSize)}</p>
          <p>${"Output: " + review.output.width + " × " + review.output.height + " · " + review.output.codec + " · " + (review.output.bitrate / 1e6).toFixed(2) + " Mbps · " + bytes(review.outputSize)}</p>
          <p>${"Potential savings: " + bytes(saved) + " (" + (100 * saved / review.originalSize).toFixed(1) + "%)"}</p>
          <p>${"Encoder: " + review.encoder + (review.fallback ? " · CPU fallback" : "")}</p>
        </div>
        <p className="dirty-compactor-path">${props.capture ? "Destination hidden" : review.destination}</p>
        ${review.reason && html`<${ui.StateView} title="Output requires attention" detail=${review.reason} />`}
        <div className="dirty-ui-control-row">
          ${!props.capture && html`<a className="dirty-ui-button btn btn-secondary" href=${review.url} download="" target="_blank" rel="noreferrer">Download output</a>`}
          <${ui.Button} tone="primary" disabled=${busy || props.settingsPending} onClick=${function () { decide("acceptOutput"); }}>Accept and replace<//>
          <${ui.Button} disabled=${busy} onClick=${function () { decide("discardOutput"); }}>Discard and keep original<//>
          <${ui.Button} disabled=${busy} onClick=${function () { release(); props.onLater(); }}>Review later<//>
        </div>
      <//>`;
  }
  function Settings(props) {
    var draftState = useState(normalize(props.configuration || {})), draft = draftState[0], setDraft = draftState[1];
    var saved = useRef(null), draftRef = useRef(draft), saving = useRef(false), ready = useRef(false), mounted = useRef(true);
    draftRef.current = draft;
    var statusState = useState("Loading…"), status = statusState[0], setStatus = statusState[1];
    var errorState = useState(""), error = errorState[0], setError = errorState[1];
    var blocked = useRef(false);
    var capState = useState(null), caps = capState[0], setCaps = capState[1];
    var previewState = useState(null), preview = previewState[0], setPreview = previewState[1];
    var previewIdState = useState(""), previewId = previewIdState[0], setPreviewId = previewIdState[1];
    var runState = useState(null), run = runState[0], setRun = runState[1];
    var runIdState = useState(""), runId = runIdState[0], setRunId = runIdState[1];
    var historyState = useState([]), history = historyState[0], setHistory = historyState[1];
    var pageState = useState(1), page = pageState[0], setPage = pageState[1];
    var excludedState = useState([]), excluded = excludedState[0], setExcluded = excludedState[1];
    var confirmState = useState(false), confirm = confirmState[0], setConfirm = confirmState[1];
    var reviewState = useState(false), review = reviewState[0], setReview = reviewState[1];
    var laterState = useState(false), later = laterState[0], setLater = laterState[1];
    var busyState = useState(false), busy = busyState[0], setBusy = busyState[1];
    var invalid = validation(draft), dirty = JSON.stringify(draft) !== saved.current;
    var capture = hub.captureEnabled(window.location.search);
    ui.usePageTitle("DirtyCompactor", "Settings");
    function load() {
      return hub.getPluginSettings(ID).then(function (value) {
        if (!mounted.current) return;
        var normalized = normalize(value); saved.current = JSON.stringify(normalized); ready.current = true; blocked.current = false;
        setDraft(normalized); setStatus("Saved"); setError("");
      }).catch(function (failure) { if (mounted.current) setError(failure.message); });
    }
    useEffect(function () { load(); return function () { mounted.current = false; }; }, []);
    useEffect(function () {
      if (props.onDirtyChange) props.onDirtyChange(ID, dirty);
      return function () { if (props.onDirtyChange) props.onDirtyChange(ID, false); };
    }, [dirty]);
    useEffect(function () {
      if (!ready.current || !dirty || invalid || blocked.current) return undefined;
      var timer = setTimeout(function pump() {
        if (saving.current || !mounted.current) return;
        var value = copy(draftRef.current);
        if (validation(value) || JSON.stringify(value) === saved.current) return;
        saving.current = true; setStatus("Saving…");
        hub.configurePlugin(ID, value).then(function () {
          saved.current = JSON.stringify(value);
          if (mounted.current) { setStatus("Saved"); setError(""); }
        }).catch(function (failure) {
          blocked.current = true;
          if (mounted.current) { setError(failure.message); setStatus("Save failed"); }
        }).finally(function () {
          saving.current = false;
          if (mounted.current && !blocked.current && JSON.stringify(draftRef.current) !== saved.current) pump();
        });
      }, 500);
      return function () { clearTimeout(timer); };
    }, [draft, dirty, invalid]);
    useEffect(function () {
      var active = true, running = false;
      function refresh() {
        if (running) return;
        running = true;
        Promise.all([operation("listRuns"), previewId ? operation("getPreview", { id: previewId, page: page }) : Promise.resolve(null),
          runId ? operation("getRun", { id: runId, page: page }) : Promise.resolve(null)]).then(function (values) {
          if (!active) return;
          setHistory(values[0]); setPreview(values[1]); setRun(values[2]);
          if (!runId) {
            var current = values[0].find(function (r) { return ["completed", "failed", "cancelled"].indexOf(r.status) < 0; });
            if (current) setRunId(current.id);
          }
        }).catch(function (failure) { if (active) setError(failure.message); }).finally(function () { running = false; });
      }
      refresh(); var timer = setInterval(refresh, 2000);
      return function () { active = false; clearInterval(timer); };
    }, [previewId, runId, page]);
    function changed(next) { setDraft(next); setPreviewId(""); setPreview(null); setExcluded([]); setStatus("Pending save"); }
    function updateRule(index, value) { var next = copy(draft); next.rules[index] = value; changed(next); }
    function act(mode, args) {
      setBusy(true); setError("");
      return operation(mode, args).then(function (value) {
        if (mode === "preview") { setPreviewId(value.id); setPage(1); }
        if (mode === "startRun") { setRunId(value.id); setPreviewId(""); setConfirm(false); setLater(false); }
        if (mode === "capabilities") setCaps(value);
        if (args && args.id === runId) return operation("getRun", { id: runId, page: page }).then(setRun);
        return value;
      }).catch(function (failure) { setError(failure.message || String(failure)); }).finally(function () { setBusy(false); });
    }
    var readyCount = preview && preview.counts && preview.counts.ready || 0;
    return html`
      <div className=${"dirty-compactor" + (capture ? " dirty-compactor-capture" : "")}>
        <${ui.SettingsSection} title="DirtyCompactor" description="First matching rule wins. Automatic runs need an open Stash tab to detect successful scans; queued work continues without the browser.">
          <div className="dirty-ui-control-row">
            <${ui.SettingsToggle} checked=${!draft.automationPaused} label="Automation active" onChange=${function (v) { changed(Object.assign({}, draft, { automationPaused: !v })); }} />
            <${ui.Button} onClick=${function () { var next = copy(draft); next.rules.push(newRule()); changed(next); }}>Add rule<//>
            <${ui.Button} disabled=${busy} onClick=${function () { act("capabilities"); }}>Detect encoders<//>
            <${ui.Button} tone="primary" disabled=${busy || dirty || Boolean(invalid) || !draft.rules.length} onClick=${function () { act("preview"); }}>Preview rules<//>
            <${ui.SaveStatus} state=${invalid ? "invalid" : error ? "error" : dirty ? "pending" : "saved"} message=${invalid || status} />
          </div>
        <//>
        ${error && html`<${ui.StateView} title="DirtyCompactor needs attention" detail=${error} actions=${html`<${ui.Button} onClick=${load}>Reload saved settings<//>`} />`}
        ${!draft.rules.length && html`<${ui.StateView} title="No rules yet" detail="Add a rule, choose its scene filter and action, then preview its effect." />`}
        ${draft.rules.map(function (r, index) {
          return html`<${RuleCard} key=${r.id} rule=${r} index=${index} last=${index === draft.rules.length - 1} capabilities=${caps}
            initialOpen=${!r.enabled} onChange=${function (value) { updateRule(index, value); }}
            onMove=${function (direction) { var next = copy(draft), other = index + direction; var temp = next.rules[index]; next.rules[index] = next.rules[other]; next.rules[other] = temp; changed(next); }}
            onDuplicate=${function () { var next = copy(draft), duplicate = copy(r); duplicate.id = newRule().id; duplicate.enabled = false; duplicate.mode = "manual"; duplicate.name += " copy"; next.rules.splice(index + 1, 0, duplicate); changed(next); }}
            onRemove=${function () { var next = copy(draft); next.rules.splice(index, 1); changed(next); }} />`;
        })}
        ${preview && html`
          <${React.Fragment}>
            <${Results} record=${preview} title="Operation preview" onPage=${setPage} capture=${capture} excluded=${excluded}
              onExclude=${function (id, remove) { setExcluded(function (current) { return remove ? current.concat(id).filter(function (v, i, a) { return a.indexOf(v) === i; }) : current.filter(function (v) { return v !== id; }); }); }} />
            <${ui.Button} tone="primary" disabled=${busy || dirty || preview.status !== "ready" || !readyCount} onClick=${function () { setConfirm(true); }}>Review and run<//>
          <//>`}
        <${ui.Dialog} open=${confirm} ariaLabel="Confirm manual run" onClose=${function () { setConfirm(false); }} className="dirty-ui-panel dirty-compactor-confirm">
          <h2>Run these operations?</h2>
          <p>${readyCount + " ready operations before exclusions. " + excluded.length + " scenes excluded. Delete rules remove scenes and files through Stash."}</p>
          ${preview && preview.readyActions && html`<p className="dirty-compactor-danger">${"Resize: " + preview.readyActions.resize + " · Reencode: " + preview.readyActions.reencode + " · Delete scenes: " + preview.readyActions.delete}</p>`}
          <${ui.SettingsToggle} checked=${review} label="Review encoded outputs before replacing originals" onChange=${setReview} />
          <p>${review ? "Encode one complete file, then wait for Accept or Discard. Original files remain untouched while awaiting review. Delete rules have no encoded preview." : "Validated smaller outputs replace originals automatically during this manual run."}</p>
          <div className="dirty-ui-control-row">
            <${ui.Button} onClick=${function () { setConfirm(false); }}>Cancel<//>
            <${ui.Button} tone="danger" disabled=${busy || dirty} onClick=${function () { act("startRun", { id: previewId, reviewOutputs: review, excludedScenes: excluded }); }}>Start manual run<//>
          </div>
        <//>
        ${run && html`
          <${React.Fragment}>
            ${run.review && !later && html`<${OutputReview} key=${run.review.operationId} run=${run} act=${act} capture=${capture} settingsPending=${dirty || Boolean(invalid)} onLater=${function () { setLater(true); }} />`}
            ${run.review && later && html`<${ui.StateView} title="Output waiting for review" detail=${"Original unchanged · temporary output " + bytes(run.review.outputSize)} actions=${html`<${ui.Button} onClick=${function () { setLater(false); }}>Resume review<//>`} />`}
            <${Results} record=${run} title="Current run" onPage=${setPage} capture=${capture} />
            ${["completed", "failed", "cancelled"].indexOf(run.status) < 0 && html`
              <div className="dirty-ui-control-row">
                <${ui.Button} disabled=${busy} onClick=${function () { act("cancelRun", { id: run.id }); }}>Cancel run<//>
                ${["recovery", "running", "finalizing", "reconciling", "queued", "acceptQueued", "discarding"].indexOf(run.status) >= 0 && html`<${ui.Button} disabled=${busy} onClick=${function () { act("retryRecovery", { id: run.id }); }}>Recover interrupted run<//>`}
                ${run.status === "recovery" && html`<${ui.Button} disabled=${busy} onClick=${function () { act("restoreOriginal", { id: run.id }); }}>Restore original<//>`}
              </div>`}
          <//>`}
        <${ui.SettingsSection} title="Run history">
          ${history.length ? html`<ul className="dirty-compactor-history">${history.map(function (item) {
            return html`<li key=${item.id}><${ui.Button} onClick=${function () { setRunId(item.id); setPage(1); setLater(false); }}>${new Date(item.created * 1000).toLocaleString()}<//>${" · " + (item.automatic ? "Automatic" : "Manual") + " · " + item.status + " · " + bytes(item.actualSavings) + " reclaimed"}</li>`;
          })}</ul>` : html`<p>No runs yet.</p>`}
        <//>
      </div>`;
  }
  var AutomationMonitor = automation.createAutomationMonitor({ api: api, hub: hub, useRef: useRef, useEffect: useEffect, operation: operation });
  hub.registerSettingsPanel(ID, Settings);
  if (api.patch && api.patch.after) api.patch.after("App", function () {
    var args = Array.prototype.slice.call(arguments), result = args.pop();
    return html`<${React.Fragment}>${result}<${AutomationMonitor} /><//>`;
  });
  window[INSTANCE_KEY] = { settingsPanel: Settings, automationMonitor: AutomationMonitor, algorithms: { newRule: newRule, validation: validation, filterSummary: filterSummary, bytes: bytes } };
})();
