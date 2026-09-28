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
  var FINISHED = ["completed", "failed", "cancelled"];
  var RECOVERABLE = ["recovery", "running", "finalizing", "reconciling", "queued", "acceptQueued", "discarding"];
  var ESTIMATE_SAMPLE = 200;
  var AUTOMATION_HELP = "Automatic rules run after each successful library scan. A Stash tab must be open to notice the scan; queued work continues without it. The first matching rule wins, even when it is Manual.";
  function field(id, label, value, change, options, help, action) {
    var props = { value: value, onChange: function (event) { change(event.target.value); }, className: "form-control" + (options ? " dirty-ui-select" : "") };
    var control = options ? html`<select ...${props}>${options.map(function (item) {
      return html`<option key=${item[0]} value=${item[0]}>${item[1]}</option>`;
    })}</select>` : html`<input ...${Object.assign(props, { type: /-(width|height|rate)$/.test(id) ? "number" : "text", step: "any" })} />`;
    return html`<${ui.Field} id=${id} label=${label} help=${help} action=${action}>${control}<//>`;
  }
  function hidden(text) { return html`<span className="sr-only">${text}</span>`; }
  function RuleRow(props) {
    var r = props.rule, filterState = useState(false), openFilter = filterState[0], setOpenFilter = filterState[1];
    var sampleState = useState(null), sample = sampleState[0], setSample = sampleState[1];
    var preset = rules.RESOLUTIONS.some(function (item) { return item[0] === r.width + "x" + r.height; });
    var sizeState = useState(!preset), customSize = sizeState[0], setCustomSize = sizeState[1];
    var matchKey = JSON.stringify(r.condition);
    useEffect(function () {
      var active = true;
      setSample(null);
      var timer = setTimeout(function () {
        var condition = r.condition || {};
        if (!condition.all && !Object.keys(condition.scene || {}).length && !(condition.find || {}).q) return;
        // A fixed-seed random sample keeps the estimate stable while editing.
        hub.graphql("query($find:FindFilterType,$scene:SceneFilterType){findScenes(filter:$find,scene_filter:$scene){count filesize " +
          "scenes{files{size duration width height bit_rate frame_rate}}}}",
          { find: Object.assign({}, condition.find, { per_page: ESTIMATE_SAMPLE, page: 1, sort: "random_20260928" }), scene: condition.scene || {} })
          .then(function (data) { if (active) setSample(data.findScenes); })
          .catch(function () { if (active) setSample("unavailable"); });
      }, 500);
      return function () { active = false; clearTimeout(timer); };
    }, [matchKey]);
    function change(key, value) { var next = copy(r); next[key] = value; props.onChange(next); }
    var encoderOptions = [["auto", "Auto (GPU if available)"], ["cpu", "CPU"]];
    ((props.capabilities && props.capabilities.encoders[r.codec]) || []).forEach(function (kind) {
      if (kind !== "cpu") encoderOptions.push([kind, { nvenc: "NVIDIA NVENC", qsv: "Intel QSV", amf: "AMD AMF" }[kind]]);
    });
    if (!encoderOptions.some(function (option) { return option[0] === r.encoder; })) encoderOptions.push([r.encoder, r.encoder.toUpperCase() + " (not detected; CPU fallback)"]);
    var detected = props.capabilities && (props.capabilities.encoders[r.codec] || []);
    var matches = sample && typeof sample === "object" ? sample.count : null;
    var scenes = typeof matches === "number" ? matches + (matches === 1 ? " scene" : " scenes") : "";
    var guess = matches ? rules.estimate(r, sample) : null;
    var saving = guess && guess.saved > 0 ? "≈ " + bytes(guess.saved) + (r.action === "delete" ? " freed" : " saved") : "";
    var condition = r.condition || {};
    var hasFilter = condition.all || Object.keys(condition.scene || {}).length || (condition.find || {}).q;
    var quality = rules.quality(r), advanced = [r.codec === "hevc" ? "H.265" : "H.264", r.encoder === "auto" ? "auto encoder" : r.encoder.toUpperCase(), r.format === "keep" ? "keep format" : "format may change"];
    return html`
      <div className=${"dirty-ui-row" + (props.open ? " is-open" : "") + (r.enabled ? "" : " is-off")}>
        <div className="dirty-ui-row-main">
          <${ui.SettingsToggle} checked=${r.enabled} label=${hidden("Enable " + r.name)} onChange=${function (value) { change("enabled", value); }} />
          <button type="button" className="dirty-ui-row-summary" aria-expanded=${props.open} onClick=${props.onToggle}>
            <span className="dirty-ui-row-title">${(props.index + 1) + ". " + r.name}</span>
            <span className="dirty-ui-row-detail">
              ${hasFilter ? filterSummary(condition, props.capture) : html`<span className="dirty-compactor-warning">Choose scenes</span>`}
              ${scenes && " (" + scenes + (saving ? " · " + saving : "") + ")"}
              ${" → "}
              <span className=${r.action === "delete" ? "dirty-compactor-danger" : undefined}>${rules.actionSummary(r)}</span>
            </span>
          </button>
          ${r.mode === "automatic" && html`<${ui.Badge} title="Runs automatically after library scans">Auto<//>`}
          <${ui.ActionMenu} ariaLabel=${"Actions for " + r.name} items=${[
            { label: props.open ? "Close editor" : "Edit", onSelect: props.onToggle },
            { label: "Move up", disabled: props.index === 0, onSelect: function () { props.onMove(-1); } },
            { label: "Move down", disabled: props.last, onSelect: function () { props.onMove(1); } },
            { label: "Duplicate", onSelect: props.onDuplicate },
            { label: "Delete rule", tone: "danger", onSelect: props.onRemove },
          ]} />
        </div>
        ${props.open && html`
          <div className="dirty-ui-row-editor">
            <div className="dirty-compactor-grid">
              ${field(r.id + "-name", "Name", r.name, function (v) { change("name", v); })}
              <div className="dirty-ui-field">
                <span className="dirty-compactor-label">Scenes</span>
                <div className="dirty-ui-control-row">
                  <${ui.Button} disabled=${condition.all} onClick=${function () { setOpenFilter(true); }}>${hasFilter && !condition.all ? "Edit filter" : "Choose filter"}<//>
                  <${ui.SettingsToggle} checked=${condition.all} label="All scenes" onChange=${function (value) { change("condition", { all: value, scene: {}, find: {}, query: "" }); }} />
                  ${scenes && html`<span className="dirty-compactor-muted">${scenes}</span>`}
                </div>
              </div>
            </div>
            <${ui.SceneFilterEditor} open=${openFilter} value=${r.condition} onClose=${function () { setOpenFilter(false); }} onChange=${function (v) { change("condition", v); }} />
            <div className="dirty-compactor-grid">
              ${field(r.id + "-action", "Action", r.action, function (v) { change("action", v); }, [["resize", "Resize"], ["reencode", "Reencode (keep resolution)"], ["delete", "Delete scene and files"]])}
              ${r.action === "resize" && field(r.id + "-preset", "Maximum resolution", customSize ? "custom" : r.width + "x" + r.height, function (v) {
                if (v === "custom") { setCustomSize(true); return; }
                setCustomSize(false); var next = copy(r), d = v.split("x"); next.width = Number(d[0]); next.height = Number(d[1]); props.onChange(next);
              }, rules.RESOLUTIONS.concat([["custom", "Custom size"]]), "Never upscales. Aspect ratio is kept.")}
              ${r.action === "resize" && customSize && field(r.id + "-width", "Maximum width", r.width, function (v) { change("width", v); })}
              ${r.action === "resize" && customSize && field(r.id + "-height", "Maximum height", r.height, function (v) { change("height", v); })}
              ${r.action !== "delete" && field(r.id + "-quality", "Quality", quality, function (v) { change("quality", v); }, rules.QUALITIES, rules.qualityHint(r))}
              ${r.action !== "delete" && quality === "custom" && field(r.id + "-rate", "Video bitrate (Mbps)", r.mbps, function (v) { change("mbps", v); })}
            </div>
            ${guess && html`<p className="dirty-compactor-estimate" title="Estimated from the matching scenes' sizes, durations, and resolutions before planning. Earlier rules may take some of these scenes; Preview gives the exact numbers.">
              ${r.quality === "source" ? "Converting keeps sizes roughly the same." : html`<strong>${"≈ " + bytes(guess.saved)}</strong>${(r.action === "delete" ? " freed of " : " saved of ") + bytes(guess.total) +
                (guess.total ? " (" + Math.round(100 * guess.saved / guess.total) + "%)" : "") + (guess.exact ? "" : " · estimated from " + guess.sampled + " sample scenes")}`}
            </p>`}
            ${r.action === "delete" && html`<p className="dirty-compactor-danger">Deletes the scene, all its media files, and generated assets through Stash.${r.mode === "automatic" ? " Automatic runs will not ask again." : ""}</p>`}
            <${ui.SettingsToggle} checked=${r.mode === "automatic"} label="Run automatically after library scans" onChange=${function (value) { change("mode", value ? "automatic" : "manual"); }} />
            ${r.action !== "delete" && html`
              <details className="dirty-compactor-advanced">
                <summary>${"Advanced · " + advanced.join(" · ")}</summary>
                <div className="dirty-compactor-grid">
                  ${field(r.id + "-codec", "Video codec", r.codec, function (v) { change("codec", v); }, [["h264", "H.264 · plays everywhere"], ["hevc", "H.265 · smaller files"]])}
                  ${field(r.id + "-encoder", "Encoder", r.encoder, function (v) { change("encoder", v); }, encoderOptions,
                    detected ? (detected.length ? "Detected: " + detected.join(", ").toUpperCase() : "No encoder detected for this codec.") : "Auto tries NVIDIA, Intel, then AMD before CPU.",
                    html`<${ui.Button} compact busy=${props.detecting} onClick=${props.onDetect}>Detect<//>`)}
                  ${field(r.id + "-format", "Container", r.format, function (v) { change("format", v); }, [["keep", "Keep original format"], ["allow", "Allow MP4 or MKV if needed"]])}
                </div>
              </details>`}
          </div>`}
      </div>`;
  }
  function Results(props) {
    var record = props.record, counts = record.counts || {};
    var showState = useState(false), showFiles = showState[0], setShowFiles = showState[1];
    var skipped = (counts.blocked || 0) + (counts.unchanged || 0) + (counts.manual || 0);
    var metrics = props.kind === "preview" ? [
      ["Ready", (counts.ready || 0) + (counts.ready === 1 ? " file" : " files")],
      ["Estimated savings", bytes(record.estimatedSavings)],
      ["Skipped", String(skipped)],
    ] : [
      ["Done", (counts.completed || 0) + " of " + record.total],
      [record.libraryBytesRemoved > 0 ? "Reclaimed · removed" : "Reclaimed", bytes(record.actualSavings) + (record.libraryBytesRemoved > 0 ? " · " + bytes(record.libraryBytesRemoved) : "")],
      ["Failed", String(counts.failed || 0)],
    ];
    return html`
      <${ui.SettingsSection} className="dirty-compactor-results" title=${props.title} description=${props.description}>
        ${record.error && html`<${ui.StateView} title="Planning failed" detail=${record.error} />`}
        ${record.progress && html`
          <div className="dirty-compactor-progress" role="status">
            <span>${record.progress.stage}</span>
            <progress max="1" value=${record.progress.progress}></progress>
            <span>${Math.round(record.progress.progress * 100) + "%"}</span>
          </div>`}
        ${record.status !== "planning" && html`<div className="dirty-compactor-metrics">${metrics.map(function (item) {
          return html`<${ui.Metric} key=${item[0]} label=${item[0]} value=${item[1]} />`;
        })}</div>`}
        ${props.kind === "preview" && skipped > 0 && html`
          <div className="dirty-compactor-skipped">
            <span>${"Why " + skipped + (skipped === 1 ? " file was" : " files were") + " skipped"}</span>
            <ul>${(record.skipReasons || []).slice(0, 5).map(function (item) {
              return html`<li key=${item[0]}><strong>${String(item[1])}</strong>${" " + item[0]}</li>`;
            })}</ul>
            ${(record.skipReasons || []).length > 5 && html`<span className="dirty-compactor-muted">Show files for the rest.</span>`}
          </div>`}
        ${record.libraryBytesRemoved > 0 && html`<p className="dirty-compactor-muted">Deleted files may stay on disk depending on Stash's trash settings.</p>`}
        <div className="dirty-ui-control-row dirty-compactor-results-actions">
          ${record.total > 0 && html`<${ui.Button} tone="quiet" pressed=${showFiles} onClick=${function () { setShowFiles(!showFiles); }}>${showFiles ? "Hide files" : "Show files"}<//>`}
          <span className="dirty-ui-spacer"></span>
          ${props.actions}
        </div>
        ${showFiles && html`
          <${React.Fragment}>
            <div className="dirty-ui-table-wrap">
              <table className="dirty-ui-table dirty-compactor-table">
                <thead><tr>${["Scene", "Action", "Saving", "Status"].map(function (label) {
                  return html`<th key=${label} scope="col">${label}</th>`;
                })}</tr></thead>
                <tbody>${(record.operations || []).map(function (op) {
                  return html`
                    <tr key=${op.id}>
                      <td>
                        ${props.onExclude && html`<${ui.SettingsToggle} checked=${props.excluded.indexOf(op.sceneId) < 0} label=${hidden("Include scene " + op.sceneId)} onChange=${function (value) { props.onExclude(op.sceneId, !value); }} />`}
                        <a href=${"/scenes/" + op.sceneId}>${props.capture ? "Scene hidden" : op.title}</a>
                        <details>
                          <summary>File details</summary>
                          <span className="dirty-compactor-path">${props.capture ? "Path hidden" : op.source}</span>
                          ${op.media && html`<div>${op.media.width + " × " + op.media.height + " · " + (op.media.bitrate / 1e6).toFixed(2) + " Mbps"}</div>`}
                          ${op.identity && html`<div>${bytes(op.identity.size)}</div>`}
                          ${op.destination && op.destination !== op.source && html`<div className="dirty-compactor-path">${"→ " + (props.capture ? "Path hidden" : op.destination)}</div>`}
                        </details>
                      </td>
                      <td>${op.dimensions ? op.dimensions.join(" × ") + " · " + (op.mbps || op.rule.mbps) + " Mbps" : html`<span className="dirty-compactor-danger">Delete</span>`}<div className="dirty-compactor-muted">${op.rule.name}</div></td>
                      <td>${bytes(op.actualSavings || op.savings)}</td>
                      <td><${ui.Badge}>${op.status}<//>${op.reason && html`<div className="dirty-compactor-muted">${op.reason}</div>`}</td>
                    </tr>`;
                })}</tbody>
              </table>
            </div>
            <${ui.Pagination} page=${record.page} totalPages=${record.pages} onPageChange=${props.onPage} ariaLabel="Operation pages" summary=${"Page " + record.page + " of " + record.pages} />
          <//>`}
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
    var card = { name: "Check this encoded file", description: "The original is untouched until you accept." };
    function media(item, size) { return item.width + " × " + item.height + " · " + item.codec + " · " + (item.bitrate / 1e6).toFixed(2) + " Mbps · " + bytes(size); }
    return html`
      <${ui.SettingsCard} className="dirty-compactor-review" plugin=${card}>
        <h3>${props.capture ? "Scene hidden" : review.title}</h3>
        ${props.capture ? html`<div className="dirty-compactor-media-placeholder">Media hidden for documentation</div>`
          : !busy && html`<video ref=${player} src=${review.url} controls preload="metadata" playsInline onError=${function () { setFailed(true); }} aria-label="Encoded output preview" />`}
        ${failed && html`<${ui.StateView} title="This browser cannot play the output" detail="Download it to check it in another player. The preview is never transcoded." />`}
        <div className="dirty-compactor-metrics">
          <${ui.Metric} label="Saves" value=${bytes(saved)} detail=${(100 * saved / review.originalSize).toFixed(1) + "% smaller"} />
          <${ui.Metric} label="Original" value=${bytes(review.originalSize)} detail=${media(review.original, review.originalSize)} />
          <${ui.Metric} label="Output" value=${bytes(review.outputSize)} detail=${media(review.output, review.outputSize)} />
        </div>
        <details className="dirty-compactor-advanced">
          <summary>Details</summary>
          <p>${"Encoder: " + review.encoder + (review.fallback ? " · CPU fallback" : "")}</p>
          <p className="dirty-compactor-path">${props.capture ? "Destination hidden" : review.destination}</p>
        </details>
        ${review.reason && html`<${ui.StateView} title="Output requires attention" detail=${review.reason} />`}
        <div className="dirty-ui-control-row">
          <${ui.Button} tone="primary" disabled=${busy || props.settingsPending} onClick=${function () { decide("acceptOutput"); }}>Accept and replace<//>
          <${ui.Button} disabled=${busy} onClick=${function () { decide("discardOutput"); }}>Discard<//>
          <span className="dirty-ui-spacer"></span>
          <${ui.ActionMenu} ariaLabel="More review actions" items=${[
            { label: "Review later", disabled: busy, onSelect: function () { release(); props.onLater(); } },
            !props.capture && { label: "Download output", href: review.url, download: true },
          ]} />
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
    var busyState = useState(""), busy = busyState[0], setBusy = busyState[1];
    var openState = useState(""), openRule = openState[0], setOpenRule = openState[1];
    var removeState = useState(""), removing = removeState[0], setRemoving = removeState[1];
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
            var current = values[0].find(function (r) { return FINISHED.indexOf(r.status) < 0; });
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
      setBusy(mode); setError("");
      return operation(mode, args).then(function (value) {
        if (mode === "preview") { setPreviewId(value.id); setPage(1); setOpenRule(""); }
        if (mode === "startRun") { setRunId(value.id); setPreviewId(""); setConfirm(false); setLater(false); }
        if (mode === "capabilities") setCaps(value);
        if (args && args.id === runId) return operation("getRun", { id: runId, page: page }).then(setRun);
        return value;
      }).catch(function (failure) { setError(failure.message || String(failure)); }).finally(function () { setBusy(""); });
    }
    function addRule() { var next = copy(draft), rule = newRule(); next.rules.push(rule); changed(next); setOpenRule(rule.id); }
    var readyCount = preview && preview.counts && preview.counts.ready || 0;
    var actions = preview && preview.readyActions || { resize: 0, reencode: 0, delete: 0 };
    var removeIndex = draft.rules.findIndex(function (r) { return r.id === removing; });
    var runActive = run && FINISHED.indexOf(run.status) < 0;
    var last = history[0];
    return html`
      <div className=${"dirty-compactor" + (capture ? " dirty-compactor-capture" : "")}>
        <div className="dirty-ui-toolbar">
          <h3>Rules</h3>
          <span title=${AUTOMATION_HELP}>
            <${ui.SettingsToggle} checked=${!draft.automationPaused} label="Automatic runs" onChange=${function (v) { changed(Object.assign({}, draft, { automationPaused: !v })); }} />
          </span>
          <${ui.SaveStatus} state=${invalid ? "invalid" : error ? "error" : dirty ? "pending" : "saved"} message=${invalid || status} />
          <span className="dirty-ui-spacer"></span>
          <${ui.Button} onClick=${addRule}>Add rule<//>
          <${ui.Button} tone="primary" busy=${busy === "preview"} disabled=${Boolean(busy) || dirty || Boolean(invalid) || !draft.rules.length} onClick=${function () { act("preview"); }}>Preview<//>
        </div>
        ${error && html`<${ui.StateView} title="DirtyCompactor needs attention" detail=${error} actions=${html`<${ui.Button} onClick=${load}>Reload saved settings<//>`} />`}
        ${run && run.review && !later && html`<${OutputReview} key=${run.review.operationId} run=${run} act=${act} capture=${capture} settingsPending=${dirty || Boolean(invalid)} onLater=${function () { setLater(true); }} />`}
        ${run && run.review && later && html`<${ui.StateView} title="An encoded file is waiting for your review" detail=${"Original unchanged · temporary output " + bytes(run.review.outputSize)} actions=${html`<${ui.Button} onClick=${function () { setLater(false); }}>Review now<//>`} />`}
        ${!draft.rules.length ? html`<${ui.StateView} title="Start with a rule" detail="A rule picks scenes with a Stash filter and resizes, reencodes, or deletes them. Nothing runs until you preview and confirm." actions=${html`<${ui.Button} tone="primary" onClick=${addRule}>Add rule<//>`} />` : html`
          <div className="dirty-ui-row-list">
            ${draft.rules.map(function (r, index) {
              return html`<${RuleRow} key=${r.id} rule=${r} index=${index} capture=${capture} last=${index === draft.rules.length - 1} capabilities=${caps}
                open=${openRule === r.id} onToggle=${function () { setOpenRule(openRule === r.id ? "" : r.id); }}
                detecting=${busy === "capabilities"} onDetect=${function () { act("capabilities"); }}
                onChange=${function (value) { updateRule(index, value); }}
                onMove=${function (direction) { var next = copy(draft), other = index + direction; var temp = next.rules[index]; next.rules[index] = next.rules[other]; next.rules[other] = temp; changed(next); }}
                onDuplicate=${function () { var next = copy(draft), duplicate = copy(r); duplicate.id = newRule().id; duplicate.enabled = false; duplicate.mode = "manual"; duplicate.name += " copy"; next.rules.splice(index + 1, 0, duplicate); changed(next); setOpenRule(duplicate.id); }}
                onRemove=${function () { setRemoving(r.id); }} />`;
            })}
          </div>`}
        ${preview && html`<${Results} kind="preview" record=${preview} title="Preview" description=${preview.status === "planning" ? "Checking files…" : "Nothing has changed yet."}
          onPage=${setPage} capture=${capture} excluded=${excluded}
          onExclude=${function (id, remove) { setExcluded(function (current) { return remove ? current.concat(id).filter(function (v, i, a) { return a.indexOf(v) === i; }) : current.filter(function (v) { return v !== id; }); }); }}
          actions=${html`<${React.Fragment}>
            <${ui.Button} tone="quiet" onClick=${function () { setPreviewId(""); setPreview(null); setExcluded([]); }}>Discard<//>
            <${ui.Button} tone="primary" disabled=${Boolean(busy) || dirty || preview.status !== "ready" || !readyCount} onClick=${function () { setConfirm(true); }}>Run…<//>
          <//>`} />`}
        ${run && html`<${Results} kind="run" record=${run} onPage=${setPage} capture=${capture}
          title=${(run.automatic ? "Automatic run" : "Manual run") + (run.created ? " · " + new Date(run.created * 1000).toLocaleString() : "")}
          description=${"Status: " + run.status}
          actions=${runActive ? html`<${React.Fragment}>
            ${run.status === "recovery" ? html`<${React.Fragment}>
              <${ui.Button} disabled=${Boolean(busy)} onClick=${function () { act("retryRecovery", { id: run.id }); }}>Retry recovery<//>
              <${ui.Button} tone="primary" disabled=${Boolean(busy)} onClick=${function () { act("restoreOriginal", { id: run.id }); }}>Restore original<//>
            <//>` : html`<${ui.Button} disabled=${Boolean(busy)} onClick=${function () { act("cancelRun", { id: run.id }); }}>Cancel run<//>`}
            ${run.status !== "recovery" && RECOVERABLE.indexOf(run.status) >= 0 && html`<${ui.ActionMenu} ariaLabel="More run actions" items=${[
              { label: "Recover interrupted run", disabled: Boolean(busy), onSelect: function () { act("retryRecovery", { id: run.id }); } },
            ]} />`}
          <//>` : html`<${ui.Button} tone="quiet" onClick=${function () { setRunId(""); setRun(null); setPage(1); }}>Close<//>`} />`}
        ${history.length > 0 && html`
          <details className="dirty-compactor-history">
            <summary>${"Run history · last " + new Date(last.created * 1000).toLocaleDateString() + " · " + bytes(last.actualSavings) + " reclaimed"}</summary>
            <ul>${history.map(function (item) {
              return html`<li key=${item.id}>
                <${ui.Button} tone="quiet" compact onClick=${function () { setRunId(item.id); setPage(1); setLater(false); }}>${new Date(item.created * 1000).toLocaleString()}<//>
                <span className="dirty-compactor-muted">${(item.automatic ? "Automatic" : "Manual") + " · " + item.status + " · " + bytes(item.actualSavings) + " reclaimed"}</span>
              </li>`;
            })}</ul>
          </details>`}
        <${ui.Dialog} open=${confirm} ariaLabel="Confirm manual run" onClose=${function () { setConfirm(false); }} className="dirty-ui-panel dirty-compactor-confirm">
          <h2>${"Run " + Math.max(0, readyCount - excluded.length) + " operations?"}</h2>
          <p>
            ${"Resize " + actions.resize + " · Reencode " + actions.reencode + " · "}
            <span className=${actions.delete ? "dirty-compactor-danger" : undefined}>${"Delete " + actions.delete + " scenes"}</span>
            ${excluded.length ? " · " + excluded.length + " scenes excluded" : ""}
          </p>
          ${actions.delete > 0 && html`<p className="dirty-compactor-danger">Deleted scenes and their files are removed through Stash.</p>`}
          <${ui.SettingsToggle} checked=${review} label="Let me check each encoded file before it replaces the original" onChange=${setReview} />
          <p className="dirty-compactor-muted">${review ? "The run pauses after each encoded file until you accept or discard it." : "Smaller, validated outputs replace the originals automatically."}</p>
          <div className="dirty-ui-control-row">
            <${ui.Button} onClick=${function () { setConfirm(false); }}>Cancel<//>
            <${ui.Button} tone=${actions.delete ? "danger" : "primary"} disabled=${Boolean(busy) || dirty} onClick=${function () { act("startRun", { id: previewId, reviewOutputs: review, excludedScenes: excluded }); }}>Start run<//>
          </div>
        <//>
        <${ui.Dialog} open=${removeIndex >= 0} ariaLabel="Delete rule" onClose=${function () { setRemoving(""); }} className="dirty-ui-panel dirty-compactor-confirm">
          <h2>${"Delete rule “" + (removeIndex >= 0 ? draft.rules[removeIndex].name : "") + "”?"}</h2>
          <p>Only the rule is removed. Media files are not affected.</p>
          <div className="dirty-ui-control-row">
            <${ui.Button} onClick=${function () { setRemoving(""); }}>Cancel<//>
            <${ui.Button} tone="danger" onClick=${function () { var next = copy(draft); next.rules.splice(removeIndex, 1); changed(next); setRemoving(""); }}>Delete rule<//>
          </div>
        <//>
      </div>`;
  }
  var AutomationMonitor = automation.createAutomationMonitor({ api: api, hub: hub, useRef: useRef, useEffect: useEffect, operation: operation });
  hub.registerSettingsPanel(ID, Settings);
  if (api.patch && api.patch.after) api.patch.after("App", function () {
    var args = Array.prototype.slice.call(arguments), result = args.pop();
    return html`<${React.Fragment}>${result}<${AutomationMonitor} /><//>`;
  });
  window[INSTANCE_KEY] = { settingsPanel: Settings, automationMonitor: AutomationMonitor, algorithms: { newRule: newRule, validation: validation, filterSummary: filterSummary, bytes: bytes, targetMbps: rules.targetMbps, actionSummary: rules.actionSummary } };
})();
