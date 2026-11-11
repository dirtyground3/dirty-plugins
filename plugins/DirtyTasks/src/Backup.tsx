import type { ReactNode } from "react";
import { constants } from "@generated/dirtyTasks.settings";
import { hub, PluginApi, React, ui } from "../../DirtyPlugins/src/shared/host";
import { asObject } from "../../DirtyPlugins/src/shared/values";
import { loadSettings, saveSettings } from "./settings";

const DEFAULTS = constants.backup.defaultSettings;
const KEEP_MAX = constants.backup.keepMax;
const PARTS = [
  ["blobs", "Blobs: covers and images, when Stash stores them as files"],
  ["configuration", "Stash configuration with custom CSS, JavaScript and locales"],
  ["scrapers", "Scrapers folder"],
  ["dirtyPlugins", "DirtyPlugins database: plugin settings, DirtyRank ratings, caption index and task journals"],
] as const;
type Part = (typeof PARTS)[number][0];
/** The number of backups stays text while edited so an invalid entry is visible instead of replaced. */
export interface BackupDraft extends Record<Part, boolean> {
  folder: string;
  keep: string;
}
interface BackupStatus {
  success?: { time: number; size: number; files: number; removed?: number };
  failure?: { time: number; error: string };
}

export function normalizeBackup(value: Record<string, unknown>): BackupDraft {
  const keep = Number.isInteger(value.keep) ? Number(value.keep) : DEFAULTS.keep;
  const part = (key: Part) => (typeof value[key] === "boolean" ? Boolean(value[key]) : DEFAULTS[key]);
  return {
    folder: typeof value.folder === "string" ? value.folder.trim() : "",
    keep: String(Math.max(0, Math.min(KEEP_MAX, keep))),
    blobs: part("blobs"),
    configuration: part("configuration"),
    scrapers: part("scrapers"),
    dirtyPlugins: part("dirtyPlugins"),
  };
}

const folderProblem = (value: BackupDraft) =>
  value.folder.trim() && !/^([a-zA-Z]:[\\/]|[\\/])/.test(value.folder.trim())
    ? "Enter a full folder path, or leave it empty for Stash's backup folder."
    : "";
const keepProblem = (value: BackupDraft) =>
  !/^\d+$/.test(value.keep) || Number(value.keep) > KEEP_MAX ? "Keep between 0 and " + KEEP_MAX + " backups." : "";

export function validateBackup(value: BackupDraft) {
  return folderProblem(value) || keepProblem(value);
}

const megabytes = (size: number) => (size / 1048576).toFixed(1) + " MB";
const when = (time: number) => new Date(time * 1000).toLocaleString();

export function Backup(props: {
  configuration: Record<string, unknown>;
  trigger: ReactNode;
  onDirtyChange(dirty: boolean): void;
}) {
  const mounted = React.useRef(true);
  const capture = hub.captureEnabled(window.location.search);
  const backup = hub.react.useSettingsDraft<BackupDraft, Record<string, unknown>, Record<string, unknown>, unknown>({
    initialValue: normalizeBackup(props.configuration),
    load: () => loadSettings("backup"),
    normalize: normalizeBackup,
    validate: validateBackup,
    comparable: JSON.stringify,
    serialize: value => ({ ...value, folder: value.folder.trim(), keep: Number(value.keep) }),
    save: value => saveSettings("backup", value),
    delay: 500,
    onDirtyChange: props.onDirtyChange,
  });
  const [status, setStatus] = React.useState<BackupStatus>({});
  const [statusError, setStatusError] = React.useState("");
  const [queueing, setQueueing] = React.useState(false);
  const refresh = React.useCallback(async () => {
    try {
      const result = await hub.runPluginOperation<BackupStatus>("dirtyTasks", { mode: "backupStatus" });
      if (mounted.current) {
        setStatus(result || {});
        setStatusError("");
      }
    } catch {
      if (mounted.current) setStatusError("Could not load the last backup.");
    }
  }, []);
  React.useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const event = PluginApi.GQL.useJobsSubscribeSubscription().data?.jobsSubscribe;
  const job = event?.job;
  React.useEffect(() => {
    const description = job?.description || "";
    if (description.includes("DirtyTasks: backup:") || description.includes("Back up library data")) void refresh();
  }, [event?.type, job?.id, job?.status, job?.description, refresh]);
  async function backUpNow() {
    setQueueing(true);
    try {
      const result = await hub.graphql<{ runPluginTask: string }>(
        "mutation DirtyTasksBackUpNow($pluginId:ID!,$description:String,$args:Map){runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
        { pluginId: "dirtyTasks", description: "DirtyTasks: backup: back up now", args: { task: "backup" } },
      );
      if (!result.runPluginTask) throw new Error("Stash did not return a task ID.");
      if (mounted.current) hub.ui.notify("DirtyTasks backup queued as Stash job " + result.runPluginTask + ".");
    } catch {
      if (mounted.current) hub.ui.notify("Could not queue the backup. Try again.", "error");
    } finally {
      if (mounted.current) setQueueing(false);
    }
  }
  const draft = backup.draft;
  const set = (change: Partial<BackupDraft>) => backup.setDraft(current => ({ ...current, ...change }));
  const success = status.success;
  const failure = status.failure;
  return (
    <div className="dirty-tasks-backup">
      <div className="dirty-ui-row-main dirty-tasks-backup-row">
        <span className="dirty-tasks-backup-title">
          <span className="dirty-ui-row-title">Back up library data</span>
          <span className="dirty-ui-row-detail" role={statusError ? "alert" : undefined}>
            {statusError ||
              (success
                ? "Last backup " + when(success.time) + " · " + megabytes(success.size)
                : "No backup yet from DirtyTasks")}
          </span>
        </span>
        {props.trigger}
        <ui.Button
          busy={queueing}
          disabled={queueing || backup.dirty || Boolean(backup.invalid)}
          title={backup.dirty ? "Waiting for the backup settings to save" : undefined}
          onClick={backUpNow}
        >
          Back up now
        </ui.Button>
      </div>
      {failure && (!success || failure.time > success.time) && (
        <p className="dirty-ui-text-error" role="alert">
          {"Last attempt failed " + when(failure.time) + ": " + (capture ? "Details hidden" : failure.error)}
        </p>
      )}
      <div className="dirty-tasks-backup-options">
        <ui.Field
          id="dirty-tasks-backup-folder"
          label="Backup folder"
          help="Without a chosen folder, backups go to Stash's backup folder: Backup directory path in Stash's settings, or the database's folder."
          error={folderProblem(draft)}
          action={
            <span className="dirty-tasks-folder-actions">
              <ui.Button
                onClick={event =>
                  hub.ui.pickFolder({
                    title: "Choose backup folder",
                    opener: event.currentTarget,
                    initialPath: () => draft.folder,
                    onSelect: folder => {
                      if (mounted.current) set({ folder });
                    },
                  })
                }
              >
                Browse…
              </ui.Button>
              {draft.folder && (
                <ui.Button tone="quiet" onClick={() => set({ folder: "" })}>
                  Use Stash's folder
                </ui.Button>
              )}
            </span>
          }
        >
          <input
            type="text"
            readOnly
            className={"form-control" + (capture ? " dirty-tasks-capture-blur" : "")}
            placeholder="Stash's backup folder"
            value={draft.folder}
          />
        </ui.Field>
        <ui.Field
          id="dirty-tasks-backup-keep"
          label="Keep newest backups"
          help="After a successful backup, older DirtyTasks backups in that folder are deleted. 0 keeps all of them."
          error={keepProblem(draft)}
        >
          <input
            type="number"
            min={0}
            max={KEEP_MAX}
            step={1}
            className="form-control dirty-tasks-backup-keep"
            value={draft.keep}
            onChange={event => set({ keep: event.target.value })}
          />
        </ui.Field>
        <div className="dirty-tasks-backup-parts" role="group" aria-label="Included in each backup">
          <span className="dirty-ui-field-help">The Stash database is always included. Also include:</span>
          {PARTS.map(([key, label]) => (
            <ui.SettingsToggle key={key} checked={draft[key]} label={label} onChange={value => set({ [key]: value })} />
          ))}
        </div>
      </div>
      <div className="dirty-ui-toolbar">
        <span className="dirty-ui-field-help">
          Backups contain Stash's API key, password hash and stash-box keys; keep them private.
        </span>
        <span className="dirty-ui-spacer" />
        <ui.SaveStatus
          state={backup.error ? "error" : backup.invalid ? "error" : backup.dirty ? "pending" : "saved"}
          message={
            backup.error || (backup.invalid ? "Not saved" : backup.dirty ? "Saving backup settings..." : "Saved")
          }
        />
        {backup.error && <ui.Button onClick={() => backup.reload()}>Reload backup settings</ui.Button>}
      </div>
    </div>
  );
}
