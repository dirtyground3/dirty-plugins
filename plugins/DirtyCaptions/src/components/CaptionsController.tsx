import { sceneKey, settings as captionSettings } from "../domain/captions";
import { hub, PLUGIN_ID, React, ui } from "../runtime";
import { createTracksService } from "../tracks";
import type { Scene, Player, CaptionSettings, CaptionResult } from "../types";

const tracks = createTracksService(hub);

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
      timer: number | null = null;
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
          setStatus({ message: "Loading embedded captions…", retry: false });
          tracks.requestCaptions(scene).then(data => {
            if (!alive()) return;
            result = data;
            hub.debugLog(PLUGIN_ID, "Embedded captions loaded", {
              sceneId: scene.id,
              tracks: data.tracks.length,
              warnings: data.warnings.length,
            });
            apply();
          }, fail);
        });
      }
    }
    hub.getPluginSettings(PLUGIN_ID).then(raw => {
      if (!alive()) return;
      settings = captionSettings(raw);
      if (!settings.enabled) return;
      observer = new MutationObserver(findPlayer);
      observer.observe(root, { childList: true, subtree: true });
      findPlayer();
      // Video.js may assign element.player after insertion. This discovers only
      // the mounted player's element; it never checks the library or index.
      timer = window.setInterval(findPlayer, 1000);
    }, fail);
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (timer !== null) window.clearInterval(timer);
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
