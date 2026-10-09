import { language, label, preferredTrack, sceneKey, settings } from "./domain/captions";
import type { Hub, CaptionResult, CaptionSettings, CaptionTrack, Scene, Player, TrackElement } from "./types";
interface TrackRecord { data: CaptionTrack | null; mode: string; url: string; element: TrackElement | null; remove?(): void; loaded?: () => void; failed?: () => void; }
export interface TrackEnvironment { language(): string; setTimeout(handler: () => void, delay: number): number; clearTimeout(id: number): void; }
export function createTracksService(hub: Pick<Hub, "values" | "runPluginOperation">, environment: TrackEnvironment = {
  language: () => window.navigator.language || "en", setTimeout: (handler, delay) => window.setTimeout(handler, delay), clearTimeout: id => window.clearTimeout(id),
}) {
  const pending = new Map<string, Promise<CaptionResult>>();
  function requestCaptions(scene: Scene): Promise<CaptionResult> {
    var key = sceneKey(scene);
    if (pending.has(key)) return pending.get(key)!;
    var file = scene.files && scene.files[0];
    var request = hub.runPluginOperation<CaptionResult>("dirtyCaptions", {
      mode: "captions", sceneId: String(scene.id), fileId: file && file.id ? String(file.id) : undefined
    }).then(function (result) {
      if (!result || !Array.isArray(result.tracks) || !Array.isArray(result.warnings)) {
        throw new Error("DirtyCaptions returned an invalid response.");
      }
      return result;
    });
    pending.set(key, request);
    // Share concurrent players, but release subtitle text after they receive it.
    request.then(function () { pending.delete(key); }, function () { pending.delete(key); });
    return request;
  }

  /**
   * Use remote tracks so Stash's middleware owns transcode/seek offsets.
   * Data URLs work with Stash's default connect-src policy (Blob XHR does not).
   * The session owns only its tracks, never player disposal.
   * @param {*} player @param {CaptionResult} result @param {CaptionSettings} config
   * @param {(message:string) => void} onError @returns {() => void}
   */
  function attachTracks(player: Player, result: CaptionResult, config: CaptionSettings, onError: (message: string) => void) {
    var disposed = false, updating = false; var timer: number | null = null;
    var records: TrackRecord[] = [];
    var existing = Array.from(player.textTracks());
    var externalShowing = existing.some(function (track) {
      return (track.kind === "subtitles" || track.kind === "captions") && track.mode === "showing";
    });
    var chosen = config.showByDefault && !externalShowing ? preferredTrack(result.tracks,
      config.preferredLanguage || environment.language() || "en") : null;

    function alive() { return !disposed && !player.isDisposed(); }
    function rememberModes() {
      if (!alive() || updating) return;
      records.forEach(function (record) { if (record.element) record.mode = record.element.track.mode; });
    }
    function add(record: TrackRecord) {
      var selector = player.sourceSelector && player.sourceSelector();
      const data = record.data!;
      var options = { kind: "captions", src: record.url, srclang: language(data.language),
        label: label(data, environment.language()), default: false };
      record.element = selector && selector.addTextTrack ? selector.addTextTrack(options, true) :
        player.addRemoteTextTrack(options, true);
      record.remove = function () {
        if (!alive()) return;
        if (selector && selector.removeTextTrack) selector.removeTextTrack(record.element!);
        else player.removeRemoteTextTrack(record.element!);
      };
      record.loaded = function () {
        if (alive()) record.element!.track.mode = record.mode;
      };
      record.failed = function () {
        if (alive()) onError("The player could not load embedded captions. Check browser permissions and retry.");
      };
      record.element.addEventListener("load", record.loaded);
      record.element.addEventListener("error", record.failed);
      record.element!.track.mode = record.mode;
    }
    function reconcile() {
      if (!alive()) return;
      updating = true;
      try {
        var current = Array.from(player.remoteTextTracks());
        records.forEach(function (record) {
          if (current.indexOf(record.element!.track) === -1) {
            record.element!.removeEventListener("load", record.loaded!);
            record.element!.removeEventListener("error", record.failed!);
            record.remove?.();
            add(record);
          }
        });
      } finally { updating = false; }
    }
    function schedule() {
      if (timer !== null) environment.clearTimeout(timer);
      timer = environment.setTimeout(function () { timer = null; reconcile(); }, 0);
    }
    function cleanup() {
      if (disposed) return;
      if (timer !== null) environment.clearTimeout(timer);
      if (!player.isDisposed()) {
        player.off("loadstart", schedule);
        player.off("loadedmetadata", schedule);
        player.textTracks().removeEventListener("change", rememberModes);
      }
      records.forEach(function (record) {
        if (record.element) {
          record.element!.removeEventListener("load", record.loaded!);
          record.element!.removeEventListener("error", record.failed!);
          record.remove?.();
        }
        record.url = "";
        record.data = null;
      });
      records = [];
      disposed = true;
    }
    try {
      updating = true;
      result.tracks.forEach(function (track) {
        var record: TrackRecord = { data: track, mode: track === chosen ? "showing" : "disabled",
          url: "data:text/vtt;charset=utf-8," + encodeURIComponent(track.vtt), element: null };
        records.push(record);
        add(record);
      });
      updating = false;
      player.textTracks().addEventListener("change", rememberModes);
      player.on("loadstart", schedule);
      player.on("loadedmetadata", schedule);
    } catch (error) { cleanup(); throw error; }
    return cleanup;
  }

  return { requestCaptions, attachTracks, settings: (raw: Record<string, unknown>) => settings(raw, hub.values) };
}
export type TracksService = ReturnType<typeof createTracksService>;
