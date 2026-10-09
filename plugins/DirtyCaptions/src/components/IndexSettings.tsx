import { IndexStatus } from "./IndexStatus";
import type { Dependencies, IndexStatus as Status } from "../types";
export function createIndexSettings({ api, hub, lifetime }: Dependencies) {
  const React = api.React, { SettingsSection, Button } = hub.react;
  return function IndexSettings() {
    const [status, setStatus] = React.useState<Status | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
    const alive = React.useRef(true), locked = React.useRef(false), revision = React.useRef(0), request = React.useRef(0);
    React.useEffect(() => {
      function poll() {
        if (!alive.current || !lifetime.active || locked.current) return;
        const version = revision.current, id = ++request.current;
        hub.runPluginOperation<Status>("dirtyCaptions", { mode: "indexStatus" }).then(result => {
          if (alive.current && lifetime.active && version === revision.current && id === request.current) setStatus(result);
        }, failure => {
          if (alive.current && lifetime.active && version === revision.current && id === request.current) setError(failure.message);
        });
      }
      poll();
      // This polls only worker status while the settings addon is mounted.
      // Library discovery is event-driven; no recurring refresh is scheduled.
      const timer = window.setInterval(poll, 3000);
      const release = () => { alive.current = false; request.current++; window.clearInterval(timer); lifetime.effects.delete(release); };
      lifetime.effects.add(release); return release;
    }, []);
    function action(mode: string, args: Record<string, unknown> = {}) {
      if (locked.current || !alive.current || !lifetime.active) return;
      locked.current = true; revision.current++; setBusy(true); setError("");
      hub.runPluginOperation<Status>("dirtyCaptions", { mode, ...args }).then(result => {
        if (alive.current && lifetime.active) setStatus(result);
      }, failure => { if (alive.current && lifetime.active) setError(failure.message); }).then(() => {
        locked.current = false; if (alive.current && lifetime.active) setBusy(false);
      });
    }
    const running = status?.status === "Running" || status?.status === "Queued";
    if (!lifetime.active) return null;
    return <SettingsSection title="Caption index" description="Refresh indexes new or changed files using the saved file map. Enable refresh after Scan above and keep a Stash tab open until Scan completes; queued caption jobs continue after the browser closes.">
      <IndexStatus react={React} status={status} />
      <div className="dirty-ui-control-row">
        <Button disabled={busy || running} busy={busy} onClick={() => action("indexRefresh")}>Refresh caption index</Button>
        {running && <Button disabled={busy} onClick={() => action("indexCancel")}>Stop refresh</Button>}
        <Button tone="quiet" disabled={busy || running} onClick={() => action("indexRefresh", { force: true })}>Reprobe all files</Button>
      </div>
      <p>Known unchanged files are skipped without opening the media. Reprobe all files bypasses the saved map, including previous failed checks.</p>
      <p>Open Edit filters on a scene list and choose Embedded captions, then Any captions, Text captions, Bitmap / other, None, Verified, or Unverified. None includes only successfully checked files. Save the filter with Stash’s bookmark menu.</p>
      {error && <p className="dirty-ui-text-error" role="alert">{error}</p>}
    </SettingsSection>;
  };
}
