import { React, hubApi, transport } from "../runtime";
import { Button } from "./Controls";
export function DatabaseBackupControl() {
  var busyState = React.useState(false);
  var busy = busyState[0];
  var setBusy = busyState[1];
  var resultState = React.useState<{ error: boolean; message: string; } | null>(null);
  var result = resultState[0];
  var setResult = resultState[1];
  function createBackup() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    transport.runSharedOperation<{ path?: string; }>({ mode: "backupDatabase" }).then(function(response) {
      setResult({ error: false, message: response && response.path || "Backup created." });
    }).catch(function(error) {
      setResult({ error: true, message: error.message || String(error) });
    }).then(function() { setBusy(false); });
  }
  var capture = hubApi.captureEnabled(window.location && window.location.search);
  return (<section
    className="dirty-plugins-backup dirty-ui-settings-section"
    aria-labelledby="dirty-plugins-backup-title">
    <h3
      id="dirty-plugins-backup-title">
      {"Database backup"}
    </h3>
    <p>
      {"Create a copy of the shared Dirty Plugins database in the installed DirtyPlugins folder."}
    </p>
    <Button
      busy={busy}
      disabled={busy}
      onClick={createBackup}>
      {busy ? "Creating backup…" : "Create backup"}
    </Button>
    {result && (<p
      className={result.error ? "dirty-ui-text-error" : "dirty-plugins-backup-result"}
      role={result.error ? "alert" : "status"}>
      {result.error ? result.message : "Backup saved: " + (capture ? "Path hidden for documentation" : result.message)}
    </p>)}
  </section>);
}
