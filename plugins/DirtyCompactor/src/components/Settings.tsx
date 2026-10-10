import { React, hub, ui, ID, operation } from "../runtime";
import { copy, bytes, newRule, normalize, validation } from "../domain/rules";
import { FINISHED, PLANNING, RECOVERABLE, previewDescription } from "../domain/workflow";
import { RuleRow } from "./RuleRow";
import { Results } from "./Results";
import { OutputReview } from "./OutputReview";
import { RunHistory } from "./RunHistory";
import { WorkflowDialogs } from "./WorkflowDialogs";
import type { SettingsProps, SettingsValue, WorkflowRecord, Capabilities, Rule, OperationMode } from "../types";
const AUTOMATION_HELP =
  "Automatic rules run after each successful library scan. A Stash tab must be open to notice the scan; queued work continues without it. The first matching rule wins, even when it is Manual.";
export function Settings(props: SettingsProps) {
  const { useState, useRef, useEffect } = React;
  const settings = hub.react.useSettingsDraft<SettingsValue, Partial<SettingsValue>, SettingsValue, unknown>({
    initialValue: normalize(props.configuration || {}),
    load: () => hub.getPluginSettings(ID),
    normalize,
    validate: validation,
    comparable: JSON.stringify,
    serialize: copy,
    save: value => hub.configurePlugin(ID, value),
    delay: 500,
    onDirtyChange: dirty => props.onDirtyChange?.(ID, dirty),
    onSaved: () => setError(""),
  });
  const { draft, setDraft, dirty, invalid } = settings;
  const status =
    settings.status.state === "loading"
      ? "Loading…"
      : settings.status.state === "saving"
        ? "Saving…"
        : settings.status.state === "saved"
          ? "Saved"
          : settings.status.state === "pending"
            ? "Pending save"
            : "Save failed";
  const [workflowError, setError] = useState("");
  const error = settings.error || workflowError;
  const mounted = useRef(true);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [preview, setPreview] = useState<WorkflowRecord | null>(null);
  const [previewId, setPreviewId] = useState("");
  const [run, setRun] = useState<WorkflowRecord | null>(null);
  const [runId, setRunId] = useState("");
  const [history, setHistory] = useState<WorkflowRecord[]>([]);
  const [page, setPage] = useState(1);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [review, setReview] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState("");
  const [openRule, setOpenRule] = useState("");
  const [removing, setRemoving] = useState("");
  let capture = hub.captureEnabled(window.location.search);
  ui.usePageTitle("DirtyCompactor", "Settings");
  function load() {
    setError("");
    return settings.reload();
  }
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    // The preview itself is stored; reopen it after the tab was closed.
    operation("latestPreview")
      .then(latest => {
        if (mounted.current && latest && latest.id) setPreviewId(current => current || latest.id);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let active = true,
      running = false;
    function refresh() {
      if (running) return;
      running = true;
      Promise.all([
        operation("listRuns"),
        previewId ? operation("getPreview", { id: previewId, page }) : Promise.resolve(null),
        runId ? operation("getRun", { id: runId, page }) : Promise.resolve(null),
      ])
        .then(values => {
          if (!active) return;
          setHistory(values[0]);
          setPreview(values[1]);
          setRun(values[2]);
          if (!runId) {
            let current = values[0].find(r => FINISHED.indexOf(r.status) < 0);
            if (current) setRunId(current.id);
          }
        })
        .catch(failure => {
          if (active) setError(failure.message);
        })
        .finally(() => {
          running = false;
        });
    }
    refresh();
    let timer = setInterval(refresh, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [previewId, runId, page]);
  function changed(next: SettingsValue) {
    setDraft(next);
    setPreviewId("");
    setPreview(null);
    setExcluded([]);
  }
  function updateRule(index: number, value: Rule) {
    let next = copy(draft);
    next.rules[index] = value;
    changed(next);
  }
  function act(mode: OperationMode, args?: Record<string, unknown>) {
    setBusy(mode);
    setError("");
    return operation(mode, args)
      .then(value => {
        if (mode === "preview") {
          setPreviewId((value as WorkflowRecord).id);
          setPage(1);
          setOpenRule("");
        }
        if (mode === "startRun") {
          setRunId((value as WorkflowRecord).id);
          setPreviewId("");
          setConfirm(false);
          setLater(false);
        }
        if (mode === "capabilities") setCaps(value as Capabilities);
        if (args && args.id === runId) return operation("getRun", { id: runId, page }).then(setRun);
        return value;
      })
      .catch(failure => {
        setError(failure.message || String(failure));
      })
      .finally(() => {
        setBusy("");
      });
  }
  function addRule() {
    let next = copy(draft),
      rule = newRule();
    next.rules.push(rule);
    changed(next);
    setOpenRule(rule.id);
  }
  let readyCount = (preview && preview.counts && preview.counts.ready) || 0;
  let actions = (preview && preview.readyActions) || { resize: 0, reencode: 0, delete: 0 };
  let removeIndex = draft.rules.findIndex(r => r.id === removing);
  let runActive = run && FINISHED.indexOf(run.status) < 0;
  return (
    <div className={"dirty-compactor" + (capture ? " dirty-compactor-capture" : "")}>
      <div className="dirty-ui-toolbar">
        <h3>Rules</h3>
        <span title={AUTOMATION_HELP}>
          <ui.SettingsToggle
            checked={!draft.automationPaused}
            label="Automatic runs"
            onChange={v => {
              changed(Object.assign({}, draft, { automationPaused: !v }));
            }}
          />
        </span>
        <ui.SaveStatus
          state={invalid ? "invalid" : error ? "error" : dirty ? "pending" : "saved"}
          message={invalid || status}
        />
        <span className="dirty-ui-spacer" />
        <ui.Button onClick={addRule}>Add rule</ui.Button>
        <ui.Button
          tone="primary"
          busy={busy === "preview"}
          disabled={Boolean(busy) || dirty || Boolean(invalid) || !draft.rules.length}
          onClick={() => {
            act("preview");
          }}
        >
          Preview
        </ui.Button>
      </div>
      {error && (
        <ui.StateView
          title="DirtyCompactor needs attention"
          detail={error}
          actions={<ui.Button onClick={load}>Reload saved settings</ui.Button>}
        />
      )}
      {run && run.review && !later && (
        <OutputReview
          key={run.review.operationId}
          run={run}
          act={act}
          capture={capture}
          settingsPending={dirty || Boolean(invalid)}
          onLater={() => {
            setLater(true);
          }}
        />
      )}
      {run && run.review && later && (
        <ui.StateView
          title="An encoded file is waiting for your review"
          detail={"Original unchanged · temporary output " + bytes(run.review.outputSize)}
          actions={
            <ui.Button
              onClick={() => {
                setLater(false);
              }}
            >
              Review now
            </ui.Button>
          }
        />
      )}
      {!draft.rules.length ? (
        <ui.StateView
          title="Start with a rule"
          detail="A rule picks scenes with a Stash filter and resizes, reencodes, or deletes them. Nothing runs until you preview and confirm."
          actions={
            <ui.Button tone="primary" onClick={addRule}>
              Add rule
            </ui.Button>
          }
        />
      ) : (
        <div className="dirty-ui-row-list">
          {draft.rules.map((r, index) => {
            return (
              <RuleRow
                key={r.id}
                rule={r}
                index={index}
                capture={capture}
                last={index === draft.rules.length - 1}
                capabilities={caps}
                open={openRule === r.id}
                onToggle={() => {
                  setOpenRule(openRule === r.id ? "" : r.id);
                }}
                detecting={busy === "capabilities"}
                onDetect={() => {
                  act("capabilities");
                }}
                onChange={value => {
                  updateRule(index, value);
                }}
                onMove={direction => {
                  let next = copy(draft),
                    other = index + direction;
                  let temp = next.rules[index];
                  next.rules[index] = next.rules[other];
                  next.rules[other] = temp;
                  changed(next);
                }}
                onDuplicate={() => {
                  let next = copy(draft),
                    duplicate = copy(r);
                  duplicate.id = newRule().id;
                  duplicate.enabled = false;
                  duplicate.mode = "manual";
                  duplicate.name += " copy";
                  next.rules.splice(index + 1, 0, duplicate);
                  changed(next);
                  setOpenRule(duplicate.id);
                }}
                onRemove={() => {
                  setRemoving(r.id);
                }}
              />
            );
          })}
        </div>
      )}
      {preview && (
        <Results
          kind="preview"
          record={preview}
          title="Preview"
          description={previewDescription(preview)}
          onPage={setPage}
          capture={capture}
          excluded={excluded}
          onExclude={(id, remove) => {
            setExcluded(current =>
              remove ? current.concat(id).filter((v, i, a) => a.indexOf(v) === i) : current.filter(v => v !== id),
            );
          }}
          actions={
            PLANNING.indexOf(preview.status) >= 0 ? (
              <ui.Button
                busy={busy === "cancelPreview"}
                disabled={Boolean(preview.cancelRequested)}
                onClick={() => {
                  act("cancelPreview", { id: preview.id }).then(() => {
                    setPreview(Object.assign({}, preview, { cancelRequested: true }));
                  });
                }}
              >
                {preview.cancelRequested ? "Stopping…" : "Cancel preview"}
              </ui.Button>
            ) : (
              <React.Fragment>
                <ui.Button
                  tone="quiet"
                  onClick={() => {
                    let id = preview.id;
                    setPreviewId("");
                    setPreview(null);
                    setExcluded([]);
                    if (["ready", "cancelled", "failed"].indexOf(preview.status) >= 0)
                      operation("discardPreview", { id }).catch(() => {});
                  }}
                >
                  Discard
                </ui.Button>
                {preview.status === "ready" && (
                  <ui.Button
                    tone="primary"
                    disabled={Boolean(busy) || dirty || !readyCount}
                    onClick={() => {
                      setConfirm(true);
                    }}
                  >
                    {readyCount ? "Run…" : "Nothing to run"}
                  </ui.Button>
                )}
              </React.Fragment>
            )
          }
        />
      )}
      {run && (
        <Results
          kind="run"
          record={run}
          onPage={setPage}
          capture={capture}
          title={
            (run.automatic ? "Automatic run" : "Manual run") +
            (run.created ? " · " + new Date(run.created * 1000).toLocaleString() : "")
          }
          description={"Status: " + run.status}
          actions={
            runActive ? (
              <React.Fragment>
                {run.status === "recovery" ? (
                  <React.Fragment>
                    <ui.Button
                      disabled={Boolean(busy)}
                      onClick={() => {
                        act("retryRecovery", { id: run.id });
                      }}
                    >
                      Retry recovery
                    </ui.Button>
                    <ui.Button
                      tone="primary"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        act("restoreOriginal", { id: run.id });
                      }}
                    >
                      Restore original
                    </ui.Button>
                  </React.Fragment>
                ) : (
                  <ui.Button
                    disabled={Boolean(busy)}
                    onClick={() => {
                      act("cancelRun", { id: run.id });
                    }}
                  >
                    Cancel run
                  </ui.Button>
                )}
                {run.status !== "recovery" && RECOVERABLE.indexOf(run.status) >= 0 && (
                  <ui.ActionMenu
                    ariaLabel="More run actions"
                    items={[
                      {
                        label: "Recover interrupted run",
                        disabled: Boolean(busy),
                        onSelect: () => {
                          act("retryRecovery", { id: run.id });
                        },
                      },
                    ]}
                  />
                )}
              </React.Fragment>
            ) : (
              <ui.Button
                tone="quiet"
                onClick={() => {
                  setRunId("");
                  setRun(null);
                  setPage(1);
                }}
              >
                Close
              </ui.Button>
            )
          }
        />
      )}
      <RunHistory
        history={history}
        onSelect={id => {
          setRunId(id);
          setPage(1);
          setLater(false);
        }}
      />
      <WorkflowDialogs
        confirm={confirm}
        removing={draft.rules[removeIndex]}
        readyCount={readyCount}
        excluded={excluded}
        actions={actions}
        review={review}
        busy={Boolean(busy)}
        dirty={dirty}
        onReview={setReview}
        onCloseRun={() => {
          setConfirm(false);
        }}
        onCloseRemove={() => {
          setRemoving("");
        }}
        onStart={() => {
          act("startRun", { id: previewId, reviewOutputs: review, excludedScenes: excluded });
        }}
        onRemove={() => {
          let next = copy(draft);
          next.rules.splice(removeIndex, 1);
          changed(next);
          setRemoving("");
        }}
      />
    </div>
  );
}
