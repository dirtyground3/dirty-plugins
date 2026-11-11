import { hub, React, ui } from "../../DirtyPlugins/src/shared/host";

/** Dispatched after this tab saves triggers, so its schedule check runs at once. */
export const SCHEDULES_CHANGED = "dirtyTasks:scheduleschanged";
/** Bounds the wait for a schedule another tab may have changed. */
const LONGEST_WAIT = 5 * 60 * 1000;

interface Missed {
  key: string;
  label: string;
  slot: number;
}
interface ScheduleCheck {
  queued: string[];
  missed: Missed[];
  next: number | null;
}

const slotKey = (item: Missed) => item.key + "@" + item.slot;
const when = (slot: number) =>
  new Date(slot * 1000).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Asks the backend what is due: on-time slots run there, missed ones come back for the user. */
function useSchedules() {
  const mounted = React.useRef(true);
  const timer = React.useRef<number>();
  const running = React.useRef(false);
  const again = React.useRef(false);
  const [missed, setMissed] = React.useState<Missed[]>([]);
  const check = React.useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    window.clearTimeout(timer.current);
    let wait = LONGEST_WAIT;
    try {
      const result = await hub.runPluginOperation<ScheduleCheck>("dirtyTasks", { mode: "checkSchedules" });
      if (!mounted.current) return;
      setMissed(result.missed || []);
      if (result.next) wait = Math.min(LONGEST_WAIT, Math.max(1000, result.next * 1000 - Date.now() + 1000));
    } catch {
      // Stash may be restarting; the next check retries.
    } finally {
      running.current = false;
    }
    if (!mounted.current) return;
    if (again.current) {
      again.current = false;
      void check();
    } else timer.current = window.setTimeout(() => void check(), wait);
  }, []);
  React.useEffect(() => {
    const onChange = () => void check();
    void check();
    window.addEventListener(SCHEDULES_CHANGED, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
      window.removeEventListener(SCHEDULES_CHANGED, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [check]);
  return { missed, check, setMissed };
}

function MissedSchedules({
  missed,
  onResolved,
}: {
  missed: Missed[];
  onResolved(items: Missed[], error?: string): void;
}) {
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [closed, setClosed] = React.useState<string[]>([]);
  const visible = missed.filter(item => !closed.includes(slotKey(item)));
  if (!visible.length) return null;
  const selected = visible.filter(item => !skipped.includes(slotKey(item))).length;
  const resolve = async (run: boolean) => {
    setBusy(true);
    try {
      await hub.runPluginOperation("dirtyTasks", {
        mode: "resolveMissedSchedules",
        choices: visible.map(item => ({
          key: item.key,
          slot: item.slot,
          run: run && !skipped.includes(slotKey(item)),
        })),
      });
      onResolved(visible);
    } catch (error) {
      onResolved([], error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dirty-ui-panel dirty-tasks-missed" role="dialog" aria-labelledby="dirty-tasks-missed-title">
      <div className="dirty-tasks-missed-heading">
        <strong id="dirty-tasks-missed-title">Missed scheduled tasks</strong>
        <ui.IconButton
          ariaLabel="Ask again later"
          fallback="×"
          compact
          onClick={() => setClosed(current => [...current, ...visible.map(slotKey)])}
        />
      </div>
      <p className="dirty-ui-field-help">Stash was not open when these were due. Run them now?</p>
      {visible.map(item => (
        <ui.SettingsToggle
          key={slotKey(item)}
          checked={!skipped.includes(slotKey(item))}
          disabled={busy}
          label={item.label + " · " + when(item.slot)}
          onChange={value =>
            setSkipped(current => (value ? current.filter(key => key !== slotKey(item)) : [...current, slotKey(item)]))
          }
        />
      ))}
      <p className="dirty-ui-field-help">Unselected tasks wait for their next scheduled time.</p>
      <div className="dirty-ui-control-row">
        <ui.Button tone="quiet" disabled={busy} onClick={() => void resolve(false)}>
          Skip all
        </ui.Button>
        <ui.Button tone="primary" busy={busy} disabled={busy || !selected} onClick={() => void resolve(true)}>
          {selected === visible.length ? "Run now" : "Run selected"}
        </ui.Button>
      </div>
    </section>
  );
}

/** Mounted once per page: runs schedules that are due and asks about missed ones. */
export function ScheduleMonitor() {
  const schedules = useSchedules();
  // Documentation captures never show the prompt.
  if (hub.captureEnabled(window.location.search)) return null;
  return (
    <MissedSchedules
      missed={schedules.missed}
      onResolved={(items, error) => {
        if (error) hub.ui.notify("DirtyTasks could not run the missed tasks: " + error, "error");
        schedules.setMissed(current => current.filter(item => !items.some(done => slotKey(done) === slotKey(item))));
        void schedules.check();
      }}
    />
  );
}
