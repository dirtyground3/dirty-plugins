// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyCaptionsTracks";
  if (window[INSTANCE_KEY]) return;
  /** @type {any} */
  var hub = window.DirtyPlugins;
  if (!hub || !hub.values) return;
  /** @typedef {{index:number, codec:string, language:string, title:string, default:boolean, forced:boolean, vtt:string}} CaptionTrack */
  /** @typedef {{tracks:CaptionTrack[], warnings:string[], retryable?:boolean, sceneId:string, fileId:string}} CaptionResult */
  /** @typedef {{enabled:boolean, showByDefault:boolean, preferredLanguage:string}} CaptionSettings */
  /** @type {Map<string, Promise<CaptionResult>>} */
  var pending = new Map();
  // FFmpeg commonly reports ISO 639-2 codes; browsers use ISO 639-1/BCP 47.
  var languageAliases = {
    eng: "en", fra: "fr", fre: "fr", deu: "de", ger: "de", spa: "es", ita: "it",
    por: "pt", jpn: "ja", zho: "zh", chi: "zh", kor: "ko", rus: "ru", nld: "nl",
    dut: "nl", ara: "ar", hin: "hi", pol: "pl", tur: "tr", swe: "sv", nor: "no",
    dan: "da", fin: "fi", ces: "cs", cze: "cs", ell: "el", gre: "el", hun: "hu",
    ron: "ro", rum: "ro", ukr: "uk", heb: "he", tha: "th", vie: "vi", ind: "id"
  };

  /** @param {string} code */
  function language(code) {
    var value = String(code || "und").trim().toLowerCase().replace(/_/g, "-");
    var parts = value.split("-");
    parts[0] = languageAliases[parts[0]] || parts[0];
    return parts.join("-");
  }

  /** @param {Record<string, *>} raw @returns {CaptionSettings} */
  function settings(raw) {
    return {
      enabled: hub.values.coerceBoolean(raw.enabled, true),
      showByDefault: hub.values.coerceBoolean(raw.showByDefault, true),
      preferredLanguage: String(raw.preferredLanguage || "").trim()
    };
  }

  /** @param {{id:string, files?:Array<{id?:string, size?:number, mod_time?:string}>}} scene */
  function sceneKey(scene) {
    var file = scene.files && scene.files[0] || {};
    return [scene.id, file.id || "", file.size || "", file.mod_time || ""].join(":");
  }

  /** @param {*} scene @returns {Promise<CaptionResult>} */
  function requestCaptions(scene) {
    var key = sceneKey(scene);
    if (pending.has(key)) return pending.get(key);
    var file = scene.files && scene.files[0];
    var request = hub.runPluginOperation("dirtyCaptions", {
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

  /** @param {CaptionTrack[]} tracks @param {string} preferred */
  function preferredTrack(tracks, preferred) {
    var wanted = language(preferred).split("-")[0];
    return tracks.find(function (track) { return language(track.language).split("-")[0] === wanted; }) ||
      tracks.find(function (track) { return track.default; }) ||
      tracks.find(function (track) { return track.forced; }) || tracks[0];
  }

  /** @param {CaptionTrack} track */
  function label(track) {
    var name = language(track.language);
    if (name === "und") name = "Unknown language";
    try {
      var DisplayNames = Intl["DisplayNames"];
      if (typeof DisplayNames === "function" && name !== "Unknown language") {
        name = new DisplayNames([window.navigator.language || "en"], { type: "language" }).of(name) || name;
      }
    } catch (_error) { /* Unusual language tags still have a usable label. */ }
    return name + (track.title ? " — " + track.title : "") +
      " (embedded" + (track.forced ? ", forced" : "") + ", track " + track.index + ")";
  }

  /**
   * Use remote tracks so Stash's middleware owns transcode/seek offsets.
   * Data URLs work with Stash's default connect-src policy (Blob XHR does not).
   * The session owns only its tracks, never player disposal.
   * @param {*} player @param {CaptionResult} result @param {CaptionSettings} config
   * @param {(message:string) => void} onError @returns {() => void}
   */
  function attachTracks(player, result, config, onError) {
    var disposed = false, updating = false, timer = null;
    var records = [];
    var existing = Array.prototype.slice.call(player.textTracks());
    var externalShowing = existing.some(function (track) {
      return (track.kind === "subtitles" || track.kind === "captions") && track.mode === "showing";
    });
    var chosen = config.showByDefault && !externalShowing ? preferredTrack(result.tracks,
      config.preferredLanguage || window.navigator.language || "en") : null;

    function alive() { return !disposed && !player.isDisposed(); }
    function rememberModes() {
      if (!alive() || updating) return;
      records.forEach(function (record) { if (record.element) record.mode = record.element.track.mode; });
    }
    function add(record) {
      var selector = player.sourceSelector && player.sourceSelector();
      var options = { kind: "captions", src: record.url, srclang: language(record.data.language),
        label: label(record.data), default: false };
      record.element = selector && selector.addTextTrack ? selector.addTextTrack(options, true) :
        player.addRemoteTextTrack(options, true);
      record.remove = function () {
        if (!alive()) return;
        if (selector && selector.removeTextTrack) selector.removeTextTrack(record.element);
        else player.removeRemoteTextTrack(record.element);
      };
      record.loaded = function () {
        if (alive()) record.element.track.mode = record.mode;
      };
      record.failed = function () {
        if (alive()) onError("The player could not load embedded captions. Check browser permissions and retry.");
      };
      record.element.addEventListener("load", record.loaded);
      record.element.addEventListener("error", record.failed);
      record.element.track.mode = record.mode;
    }
    function reconcile() {
      if (!alive()) return;
      updating = true;
      try {
        var current = Array.prototype.slice.call(player.remoteTextTracks());
        records.forEach(function (record) {
          if (current.indexOf(record.element.track) === -1) {
            record.element.removeEventListener("load", record.loaded);
            record.element.removeEventListener("error", record.failed);
            record.remove();
            add(record);
          }
        });
      } finally { updating = false; }
    }
    function schedule() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(function () { timer = null; reconcile(); }, 0);
    }
    function cleanup() {
      if (disposed) return;
      if (timer !== null) window.clearTimeout(timer);
      if (!player.isDisposed()) {
        player.off("loadstart", schedule);
        player.off("loadedmetadata", schedule);
        player.textTracks().removeEventListener("change", rememberModes);
      }
      records.forEach(function (record) {
        if (record.element) {
          record.element.removeEventListener("load", record.loaded);
          record.element.removeEventListener("error", record.failed);
          record.remove();
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
        var record = { data: track, mode: track === chosen ? "showing" : "disabled",
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

  window[INSTANCE_KEY] = { settings: settings, sceneKey: sceneKey, language: language,
    label: label, preferredTrack: preferredTrack, requestCaptions: requestCaptions, attachTracks: attachTracks };
})();
