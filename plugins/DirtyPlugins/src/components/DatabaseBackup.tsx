import { captureEnabled } from "../capture";
import { React } from "../runtime";
import { runSharedOperation } from "../transport";
import { Button } from "./Controls";
export function DatabaseBackupControl() {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ error: boolean; message: string } | null>(null);
  function createBackup() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    runSharedOperation<{ path?: string }>({ mode: "backupDatabase" })
      .then(response => {
        setResult({ error: false, message: (response && response.path) || "Backup created." });
      })
      .catch(error => {
        setResult({ error: true, message: error.message || String(error) });
      })
      .then(() => setBusy(false));
  }
  const capture = captureEnabled(window.location && window.location.search);
  return (
    <section className="dirty-plugins-backup dirty-ui-settings-section" aria-labelledby="dirty-plugins-backup-title">
      <h3 id="dirty-plugins-backup-title">Database backup</h3>
      <p>Create a copy of the shared Dirty Plugins database in the installed DirtyPlugins folder.</p>
      <Button busy={busy} disabled={busy} onClick={createBackup}>
        {busy ? "Creating backup…" : "Create backup"}
      </Button>
      {result && (
        <p
          className={result.error ? "dirty-ui-text-error" : "dirty-plugins-backup-result"}
          role={result.error ? "alert" : "status"}
        >
          {result.error
            ? result.message
            : "Backup saved: " + (capture ? "Path hidden for documentation" : result.message)}
        </p>
      )}
    </section>
  );
}
