import { hub, React, ui } from "../../DirtyPlugins/src/shared/host";
import { asObject } from "../../DirtyPlugins/src/shared/values";
import type { PanelProps } from "../../DirtyPlugins/src/types";
import { Settings as Organization } from "./organization/components/Settings";
import { Settings as Encoding } from "./encoding/components/Settings";
import { loadSettings, saveSettings } from "./settings";
import { TriggerSelect } from "./TriggerSelect";
import { OrganizationRecovery } from "./OrganizationRecovery";
import { normalizeExecution, type ExecutionSettings, type OrganizationAction } from "./execution";

export function Settings(props: PanelProps) {
  const mounted = React.useRef(true);
  const pending = React.useRef({ organization: false, encoding: false, execution: false });
  const execution = hub.react.useSettingsDraft<ExecutionSettings, Record<string, unknown>, ExecutionSettings, unknown>({
    initialValue: normalizeExecution(asObject(props.configuration.execution)),
    load: () => loadSettings("execution"),
    normalize: normalizeExecution,
    validate: () => "",
    comparable: JSON.stringify,
    serialize: value => ({ ...value }),
    save: value => saveSettings("execution", value),
    delay: 500,
    onDirtyChange: dirty => {
      pending.current.execution = dirty;
      props.onDirtyChange?.("dirtyTasks", dirty || pending.current.organization || pending.current.encoding);
    },
  });
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState("");
  const [migration, setMigration] = React.useState<{
    removedDeleteRules?: number;
    discardedReviews?: number;
    imported?: boolean;
    dismissed?: boolean;
  }>();
  const dismissMigration = React.useCallback(() => {
    setMigration(current => ({ ...current, dismissed: true }));
    hub.runPluginOperation("dirtyTasks", { mode: "dismissMigrationNotice" }).catch(() => {
      if (mounted.current) setMigration(current => ({ ...current, dismissed: false }));
    });
  }, []);
  const load = React.useCallback(async () => {
    setError("");
    try {
      const result = await hub.runPluginOperation<typeof migration>("dirtyTasks", { mode: "migrationStatus" });
      if (!mounted.current) return;
      setMigration(result);
      setReady(true);
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  React.useEffect(() => {
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  const organizationDirty = React.useCallback(
    (_id: string, dirty: boolean) => {
      pending.current.organization = dirty;
      props.onDirtyChange?.("dirtyTasks", dirty || pending.current.encoding || pending.current.execution);
    },
    [props.onDirtyChange],
  );
  const encodingDirty = React.useCallback(
    (_id: string, dirty: boolean) => {
      pending.current.encoding = dirty;
      props.onDirtyChange?.("dirtyTasks", dirty || pending.current.organization || pending.current.execution);
    },
    [props.onDirtyChange],
  );
  React.useEffect(() => () => props.onDirtyChange?.("dirtyTasks", false), [props.onDirtyChange]);
  ui.usePageTitle("DirtyTasks", "Settings");
  if (error)
    return (
      <ui.StateView
        title="DirtyTasks needs attention"
        detail={hub.captureEnabled(window.location.search) ? "Details hidden" : error}
        actions={<ui.Button onClick={load}>Retry</ui.Button>}
      />
    );
  if (!ready) return <ui.StateView title="Loading task settings…" />;
  return (
    <div className="dirty-tasks">
      {migration?.imported && !migration.dismissed && (
        <div className="dirty-ui-toolbar" role="status">
          <span>
            Existing task settings imported.
            {migration.removedDeleteRules ? " Removed Delete rules: " + migration.removedDeleteRules + "." : ""}
            {migration.discardedReviews ? " Discarded pending reviews: " + migration.discardedReviews + "." : ""}
          </span>
          <span className="dirty-ui-spacer" />
          <ui.IconButton ariaLabel="Dismiss import summary" fallback="×" onClick={dismissMigration} />
        </div>
      )}
      <div className="dirty-ui-toolbar">
        <span>Choose a trigger for each action. Keep a Stash tab open until Scan or Generate finishes.</span>
        <ui.SaveStatus
          state={execution.error ? "error" : execution.dirty ? "pending" : "saved"}
          message={execution.error || (execution.dirty ? "Saving triggers..." : "Triggers saved")}
        />
        {execution.error && <ui.Button onClick={() => execution.reload()}>Reload triggers</ui.Button>}
      </div>
      <ui.SettingsSection
        title="File organization and tags"
        description="Organize files with a confirmed preview, and optionally merge tags from a selected tagger."
      >
        <OrganizationRecovery />
        <Organization
          {...props}
          configuration={asObject(props.configuration.organization)}
          onDirtyChange={organizationDirty}
          executionMode={[execution.draft.move, execution.draft.rename].find(mode => mode !== "manual") || "manual"}
          triggers={Object.fromEntries(
            (["move", "rename", "tags"] as OrganizationAction[]).map(key => [
              key,
              <TriggerSelect
                key={key}
                label={{ move: "Move into folders", rename: "Rename files", tags: "Update scene tags" }[key]}
                value={execution.draft[key]}
                disabled={execution.status.state === "loading"}
                onChange={value => execution.setDraft(current => ({ ...current, [key]: value }))}
              />,
            ]),
          )}
        />
      </ui.SettingsSection>
      <ui.SettingsSection
        title="Encoding"
        description="Add resized or reencoded versions to the same scene. Original files stay on disk and remain attached."
      >
        <Encoding
          configuration={asObject(props.configuration.encoding)}
          onDirtyChange={encodingDirty}
          renderTrigger={rule => (
            <TriggerSelect
              label={rule.name}
              value={execution.draft.encoding[rule.id] || "manual"}
              disabled={execution.status.state === "loading"}
              onChange={value =>
                execution.setDraft(current => ({
                  ...current,
                  encoding: { ...current.encoding, [rule.id]: value },
                }))
              }
            />
          )}
        />
      </ui.SettingsSection>
    </div>
  );
}
