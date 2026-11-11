import { hub, React, ui } from "../../DirtyPlugins/src/shared/host";
import { asObject } from "../../DirtyPlugins/src/shared/values";
import type { PanelProps } from "../../DirtyPlugins/src/types";
import { Settings as Organization } from "./organization/components/Settings";
import { Settings as Encoding } from "./encoding/components/Settings";
import { loadSettings, saveSettings } from "./settings";
import { TriggerSelect } from "./TriggerSelect";
import { OrganizationRecovery } from "./OrganizationRecovery";
import { Backup } from "./Backup";
import { SCHEDULES_CHANGED } from "./schedules";
import {
  DEFAULT_SCHEDULE,
  normalizeExecution,
  type ExecutionSettings,
  type OrganizationAction,
  type RunMode,
} from "./execution";

export function Settings(props: PanelProps) {
  const mounted = React.useRef(true);
  const pending = React.useRef({ organization: false, encoding: false, execution: false, backup: false });
  const report = React.useCallback(
    (section: keyof typeof pending.current, dirty: boolean) => {
      pending.current[section] = dirty;
      props.onDirtyChange?.("dirtyTasks", Object.values(pending.current).some(Boolean));
    },
    [props.onDirtyChange],
  );
  const execution = hub.react.useSettingsDraft<ExecutionSettings, Record<string, unknown>, ExecutionSettings, unknown>({
    initialValue: normalizeExecution(asObject(props.configuration.execution)),
    load: () => loadSettings("execution"),
    normalize: normalizeExecution,
    validate: () => "",
    comparable: JSON.stringify,
    serialize: value => ({ ...value }),
    save: value => saveSettings("execution", value),
    // This tab's scheduler checks again at once, instead of at its next due time.
    onSaved: () => window.dispatchEvent(new Event(SCHEDULES_CHANGED)),
    delay: 500,
    onDirtyChange: dirty => report("execution", dirty),
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
  const organizationDirty = React.useCallback((_id: string, dirty: boolean) => report("organization", dirty), [report]);
  const encodingDirty = React.useCallback((_id: string, dirty: boolean) => report("encoding", dirty), [report]);
  const backupDirty = React.useCallback((dirty: boolean) => report("backup", dirty), [report]);
  /** A trigger selector; choosing a schedule starts from the default time until one is picked. */
  const trigger = (
    key: string,
    label: string,
    value: RunMode,
    apply: (mode: RunMode, current: ExecutionSettings) => Partial<ExecutionSettings>,
  ) => (
    <TriggerSelect
      key={key}
      label={label}
      value={value}
      schedule={execution.draft.schedules[key]}
      disabled={execution.status.state === "loading"}
      onChange={mode =>
        execution.setDraft(current => ({
          ...current,
          ...apply(mode, current),
          schedules:
            mode === "schedule" && !current.schedules[key]
              ? { ...current.schedules, [key]: { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] } }
              : current.schedules,
        }))
      }
      onSchedule={schedule =>
        execution.setDraft(current => ({ ...current, schedules: { ...current.schedules, [key]: schedule } }))
      }
    />
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
        <span>
          Choose a trigger for each action. Scan, Generate and scheduled runs start from an open Stash tab; a schedule
          missed while Stash was closed asks before it runs.
        </span>
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
              trigger(
                key,
                { move: "Move into folders", rename: "Rename files", tags: "Update scene tags" }[key],
                execution.draft[key],
                mode => ({ [key]: mode }),
              ),
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
          renderTrigger={rule =>
            trigger(
              "encoding:" + rule.id,
              rule.name,
              execution.draft.encoding[rule.id] || "manual",
              (mode, current) => ({
                encoding: { ...current.encoding, [rule.id]: mode },
              }),
            )
          }
        />
      </ui.SettingsSection>
      <ui.SettingsSection
        title="Backup"
        description="Save the Stash database and the parts you choose into one zip, through Stash's task queue."
      >
        <Backup
          configuration={asObject(props.configuration.backup)}
          onDirtyChange={backupDirty}
          trigger={trigger("backup", "Back up library data", execution.draft.backup, mode => ({ backup: mode }))}
        />
      </ui.SettingsSection>
    </div>
  );
}
