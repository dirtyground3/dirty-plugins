import { sceneKey, settings as captionSettings } from "../domain/captions";
import { hub, PLUGIN_ID, React, ui } from "../runtime";
import { createTracksService } from "../tracks";
import type { Scene, Player, CaptionSettings, CaptionResult } from "../types";

const tracks = createTracksService(hub);
/** Waits of 1, 2, 4, 8 and 16 seconds before repeating a request that got no answer. */
const RETRY_DELAY = 1000,
  RETRIES = 5;

/** fetch rejects with a TypeError when the connection failed before Stash answered. */
function unanswered(error: unknown) {
  return Boolean(error) && (error as { name?: string }).name === "TypeError";
}

/** Attaches embedded caption tracks to the native scene player. */
export function CaptionsController({ scene }: { scene: Scene; capture: boolean }) {
  const node = React.useRef<HTMLDivElement>(null),
    [status, setStatus] = React.useState({ message: "", retry: false });
  const [revision, refresh] = React.useState(0),
    key = sceneKey(scene);
  React.useEffect(() => {
    function changed(event: Event) {
      const detail = (event as CustomEvent<{ pluginId?: string }>).detail;
      if (!detail || detail.pluginId === PLUGIN_ID) refresh(value => value + 1);
    }
    window.addEventListener("dirty-plugins:configuration-changed", changed);
    return () => window.removeEventListener("dirty-plugins:configuration-changed", changed);
  }, []);
  React.useEffect(() => {
    const root = node.current?.parentElement;
    if (!root) return;
    let cancelled = false,
      player: Player | null = null,
      releaseTracks: (() => void) | null = null;
    let observer: MutationObserver | null = null,
      timer: number | null = null,
      retryTimer: number | null = null;
    let settings: CaptionSettings | null = null,
      result: CaptionResult | null = null,
      waiting = false;
    setStatus({ message: "", retry: false });
    const alive = () => !cancelled;
    function fail(error: unknown) {
      if (!alive()) return;
      const message = error && typeof error === "object" && "message" in error ? error.message : error;
      setStatus({ message: String(message || error), retry: true });
    }
    /**
     * Changing scenes quickly can drop a connection. Such a request is repeated with a doubled
     * wait and never reported; an error answered by Stash is shown at once.
     */
    function request<T>(send: () => Promise<T>, done: (value: T) => void, attempt = 0) {
      send().then(
        value => {
          if (alive()) done(value);
        },
        error => {
          if (!alive()) return;
          if (!unanswered(error)) return fail(error);
          hub.debugLog(PLUGIN_ID, "Request got no answer", { sceneId: scene.id, attempt, error: String(error) });
          if (attempt < RETRIES) {
            retryTimer = window.setTimeout(() => request(send, done, attempt + 1), RETRY_DELAY * 2 ** attempt);
          } else setStatus({ message: "", retry: false });
        },
      );
    }
    function apply() {
      if (!alive() || !player || player.isDisposed() || !result || !settings) return;
      try {
        releaseTracks = tracks.attachTracks(player, result, settings, message => fail(new Error(message)));
        setStatus({ message: result.warnings.join(" "), retry: Boolean(result.retryable) });
      } catch (error) {
        fail(error);
      }
    }
    function findPlayer() {
      if (!alive() || !settings?.enabled) return;
      const element = root!.querySelector("video-js") as (HTMLElement & { player?: Player }) | null,
        next = element?.player;
      if (next && !next.isDisposed() && next !== player) {
        releaseTracks?.();
        releaseTracks = null;
        player = next;
        next.ready(() => {
          if (!alive() || next !== player || next.isDisposed()) return;
          if (result) {
            apply();
            return;
          }
          if (waiting) return;
          waiting = true;
          request(
            () => tracks.requestCaptions(scene),
            data => {
              result = data;
              hub.debugLog(PLUGIN_ID, "Embedded captions loaded", {
                sceneId: scene.id,
                tracks: data.tracks.length,
                warnings: data.warnings.length,
              });
              apply();
            },
          );
        });
      }
    }
    request(
      () => hub.getPluginSettings(PLUGIN_ID),
      raw => {
        settings = captionSettings(raw);
        if (!settings.enabled) return;
        observer = new MutationObserver(findPlayer);
        observer.observe(root, { childList: true, subtree: true });
        findPlayer();
        // Video.js may assign element.player after insertion. This discovers only
        // the mounted player's element; it never checks the library or index.
        timer = window.setInterval(findPlayer, 1000);
      },
    );
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (timer !== null) window.clearInterval(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      releaseTracks?.();
      releaseTracks = null;
      result = null;
      settings = null;
      player = null;
    };
  }, [key, revision]);
  return (
    <div ref={node} className="dirty-captions-status dirty-ui-control-row" aria-live="polite">
      {status.message && <span role={status.retry ? "alert" : "status"}>{status.message}</span>}
      {status.retry && <ui.Button onClick={() => refresh(value => value + 1)}>Retry captions</ui.Button>}
    </div>
  );
}
