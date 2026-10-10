import { coerceBoolean } from "../../../DirtyPlugins/src/shared/values";
import type { CaptionTrack, CaptionSettings, Scene } from "../types";
// FFmpeg commonly reports ISO 639-2 codes; browsers use ISO 639-1/BCP 47.
const languageAliases: Record<string, string> = {
  eng: "en",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  spa: "es",
  ita: "it",
  por: "pt",
  jpn: "ja",
  zho: "zh",
  chi: "zh",
  kor: "ko",
  rus: "ru",
  nld: "nl",
  dut: "nl",
  ara: "ar",
  hin: "hi",
  pol: "pl",
  tur: "tr",
  swe: "sv",
  nor: "no",
  dan: "da",
  fin: "fi",
  ces: "cs",
  cze: "cs",
  ell: "el",
  gre: "el",
  hun: "hu",
  ron: "ro",
  rum: "ro",
  ukr: "uk",
  heb: "he",
  tha: "th",
  vie: "vi",
  ind: "id",
};

export function language(code: string) {
  const value = String(code || "und")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  const parts = value.split("-");
  parts[0] = languageAliases[parts[0]] || parts[0];
  return parts.join("-");
}

export function settings(raw: Record<string, unknown>): CaptionSettings {
  return {
    enabled: coerceBoolean(raw.enabled, true),
    showByDefault: coerceBoolean(raw.showByDefault, true),
    preferredLanguage: String(raw.preferredLanguage || "").trim(),
  };
}

export function sceneKey(scene: Scene) {
  const file = (scene.files && scene.files[0]) || {};
  return [scene.id, file.id || "", file.size || "", file.mod_time || ""].join(":");
}

export function preferredTrack(tracks: CaptionTrack[], preferred: string) {
  const wanted = language(preferred).split("-")[0];
  return (
    tracks.find(track => language(track.language).split("-")[0] === wanted) ||
    tracks.find(track => track.default) ||
    tracks.find(track => track.forced) ||
    tracks[0]
  );
}

export function label(track: CaptionTrack, browserLanguage: string) {
  let name = language(track.language);
  if (name === "und") name = "Unknown language";
  try {
    const DisplayNames = (
      Intl as unknown as {
        DisplayNames?: new (languages: string[], options: { type: string }) => { of(code: string): string | undefined };
      }
    ).DisplayNames;
    if (typeof DisplayNames === "function" && name !== "Unknown language") {
      name = new DisplayNames([browserLanguage || "en"], { type: "language" }).of(name) || name;
    }
  } catch (_error) {
    /* Unusual language tags still have a usable label. */
  }
  return (
    name +
    (track.title ? " — " + track.title : "") +
    " (embedded" +
    (track.forced ? ", forced" : "") +
    ", track " +
    track.index +
    ")"
  );
}
