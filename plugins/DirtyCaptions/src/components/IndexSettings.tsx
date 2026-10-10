import { IndexStatus } from "./IndexStatus";
import { hub, PLUGIN_ID, React, ui } from "../runtime";
import type { IndexStatus as Status } from "../types";

/** Caption index status and actions, shown as an addon of the hub's Captions settings. */
export function IndexSettings() {
  const { SettingsSection, Button } = ui;
  const [status, setStatus] = React.useState<Status | null>(null),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState("");
  const alive = React.useRef(true),
    locked = React.useRef(false),
    revision = React.useRef(0),
    request = React.useRef(0);
  React.useEffect(() => {
    function poll() {
      if (!alive.current || locked.current) return;
      const version = revision.current,
        id = ++request.current;
      hub.runPluginOperation<Status>(PLUGIN_ID, { mode: "indexStatus" }).then(
        result => {
          if (alive.current && version === revision.current && id === request.current) setStatus(result);
        },
        failure => {
          if (alive.current && version === revision.current && id === request.current) setError(failure.message);
        },
      );
    }
    poll();
    // This polls only worker status while the settings addon is mounted.
    // Library discovery is event-driven; no recurring refresh is scheduled.
    const timer = window.setInterval(poll, 3000);
    return () => {
      alive.current = false;
      request.current++;
      window.clearInterval(timer);
    };
  }, []);
  function action(mode: string, args: Record<string, unknown> = {}) {
    if (locked.current || !alive.current) return;
    locked.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    hub
      .runPluginOperation<Status>(PLUGIN_ID, { mode, ...args })
      .then(
        result => {
          if (alive.current) setStatus(result);
        },
        failure => {
          if (alive.current) setError(failure.message);
        },
      )
      .then(() => {
        locked.current = false;
        if (alive.current) setBusy(false);
      });
  }
  const running = status?.status === "Running" || status?.status === "Queued";
  return (
    <SettingsSection
      title="Caption index"
      description="Refresh indexes new or changed files using the saved file map. Enable refresh after Scan above and keep a Stash tab open until Scan completes; queued caption jobs continue after the browser closes."
    >
      <IndexStatus status={status} />
      <div className="dirty-ui-control-row">
        <Button disabled={busy || running} busy={busy} onClick={() => action("indexRefresh")}>
          Refresh caption index
        </Button>
        {running && (
          <Button disabled={busy} onClick={() => action("indexCancel")}>
            Stop refresh
          </Button>
        )}
        <Button tone="quiet" disabled={busy || running} onClick={() => action("indexRefresh", { force: true })}>
          Reprobe all files
        </Button>
      </div>
      <p>
        Known unchanged files are skipped without opening the media. Reprobe all files bypasses the saved map, including
        previous failed checks.
      </p>
      <p>
        Open Edit filters on a scene list and choose Embedded captions, then Any captions, Text captions, Bitmap /
        other, None, Verified, or Unverified. None includes only successfully checked files. Save the filter with
        Stash’s bookmark menu.
      </p>
      {error && (
        <p className="dirty-ui-text-error" role="alert">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}
