import { constants } from "@generated/dirtyCompactor.settings";
import type { Condition, Rule, SettingsValue, MediaFile, Sample, Option } from "../types";
// Quality tables are generated from schemas/dirtyCompactor.settings.json and shared with the
// Python backend. QUALITY_MBPS_1080P is the typical video Mbps of each constant-quality preset
// for a 1080p, 30 fps output.
export const QUALITY_MBPS_1080P: Record<string, Record<string, number>> = constants.qualityMbps1080p;
export const CRF: Record<string, Record<string, number>> = constants.crf;
export const QUALITIES: Option[] = constants.qualities.map((item): Option => [item.value, item.label]);
export const VMAF_TARGETS: Option[] = constants.vmafTargets.map((item): Option => [String(item.value), item.label]);
// Typical audio track, used only for the in-editor estimate; the planner
// measures the real audio and subtitle streams.
export const ESTIMATE_AUDIO_MBPS = 0.128;
export const RESOLUTIONS: Option[] = [
  ["854x480", "480p"],
  ["1280x720", "720p"],
  ["1920x1080", "1080p"],
  ["2560x1440", "1440p"],
  ["3840x2160", "2160p (4K)"],
];
export const ACTIONS: Record<string, string> = { resize: "Resize", reencode: "Reencode", delete: "Delete" };
export const CODECS: Record<string, string> = { h264: "H.264", hevc: "H.265" };

export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function bytes(value?: number): string {
  let amount = Number(value || 0),
    units = ["B", "KiB", "MiB", "GiB", "TiB"],
    index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return amount.toFixed(index ? 2 : 0) + " " + units[index];
}

export function newRule(): Rule {
  return {
    id: "rule-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2),
    name: "New rule",
    enabled: false,
    mode: "manual",
    condition: { scene: {}, find: {}, query: "", all: false },
    action: "resize",
    width: 1920,
    height: 1080,
    quality: "balanced",
    vmaf: 95,
    mbps: 4,
    codec: "h264",
    encoder: "auto",
    format: "keep",
  };
}

export function normalize(value: Partial<SettingsValue>): SettingsValue {
  let list = Array.isArray(value.rules) ? value.rules : [];
  return { schemaVersion: 1, rules: list.map(fitQuality), automationPaused: value.automationPaused !== false };
}

export function fitQuality(rule: Rule): Rule {
  return rule && rule.action === "resize" && rule.quality === "source"
    ? Object.assign({}, rule, { quality: "balanced" })
    : rule;
}

export function qualities(action: string): Option[] {
  return action === "resize" ? QUALITIES.filter(item => item[0] !== "source") : QUALITIES;
}

export function quality(rule: Pick<Rule, "quality">): string {
  return rule.quality || "custom";
}

export function validation(value: SettingsValue): string {
  let ids: Record<string, boolean> = {};
  for (let i = 0; i < value.rules.length; i++) {
    let r = value.rules[i],
      condition = r.condition || {};
    if (!r.id || ids[r.id]) return "Rules need unique IDs.";
    ids[r.id] = true;
    if (r.enabled && !r.name.trim()) return "Name each enabled rule.";
    if (r.enabled && !condition.all && !Object.keys(condition.scene || {}).length && !(condition.find || {}).q)
      return "Choose a filter or All scenes for “" + r.name + "”.";
    if (r.action !== "delete" && r.quality === "visual" && !VMAF_TARGETS.some(item => Number(item[0]) === r.vmaf))
      return "Choose a visual quality target for “" + r.name + "”.";
    if (
      r.action !== "delete" &&
      quality(r) === "custom" &&
      (!Number.isFinite(Number(r.mbps)) || Number(r.mbps) < 0.05 || Number(r.mbps) > 1000)
    )
      return "Target video bitrate must be 0.05–1000 Mbps.";
    if (
      r.action === "resize" &&
      [r.width, r.height].some(v => !Number.isInteger(Number(v)) || Number(v) < 2 || Number(v) > 16384)
    )
      return "Dimensions must be whole numbers from 2 to 16384.";
  }
  return "";
}

export function visualPreset(vmaf?: number): string {
  return Number(vmaf) >= 96 ? "high" : Number(vmaf) >= 94 ? "balanced" : "small";
}

export function targetMbps(rule: Rule, width: number, height: number, fps?: number, sourceBitrate?: number): number {
  if (quality(rule) === "custom") return Number(rule.mbps);
  if (rule.quality === "source") return Number(sourceBitrate || 0) / 1e6;
  let base = (QUALITY_MBPS_1080P[rule.codec] || QUALITY_MBPS_1080P.h264)[
    rule.quality === "visual" ? visualPreset(rule.vmaf) : rule.quality || ""
  ];
  let motion = Math.sqrt(Math.max(1, Math.min(Number(fps) || 30, 120) / 30));
  return (
    Math.round(Math.max(0.2, base * Math.pow(Math.max(1, width * height) / (1920 * 1080), 0.75) * motion) * 100) / 100
  );
}

export function outputSize(width: number, height: number, rule: Rule): [number, number] {
  if (rule.action !== "resize") return [width, height];
  let bw = Number(rule.width),
    bh = Number(rule.height);
  if (height > width && bw > bh) {
    let swap = bw;
    bw = bh;
    bh = swap;
  }
  let factor = Math.min(1, bw / width, bh / height);
  if (factor === 1) return [width, height];
  return [Math.max(2, Math.floor((width * factor) / 2) * 2), Math.max(2, Math.floor((height * factor) / 2) * 2)];
}

export function fileBitrates(rule: Rule, file: MediaFile): { source: number; target: number } | null {
  if (
    rule.action === "delete" ||
    quality(rule) === "source" ||
    !Number(file.size) ||
    !Number(file.duration) ||
    !file.width ||
    !file.height
  )
    return null;
  let output = outputSize(file.width, file.height, rule);
  if (rule.action === "resize" && output[0] === file.width && output[1] === file.height) return null;
  let target = targetMbps(rule, output[0], output[1], file.frame_rate);
  let source = Number(file.bit_rate) / 1e6 - ESTIMATE_AUDIO_MBPS;
  // The planner never raises a bitrate; such files are skipped or converted as-is.
  if (source > 0 && source <= target) return null;
  return { source, target };
}

export function fileSaving(rule: Rule, file: MediaFile): number {
  if (rule.action === "delete") return Number(file.size) || 0;
  let rates = fileBitrates(rule, file);
  if (!rates) return 0;
  return Math.max(
    0,
    Number(file.size) - (((rates.target + ESTIMATE_AUDIO_MBPS) * 1e6 * Number(file.duration)) / 8) * 1.02,
  );
}

export function estimate(rule: Rule, sample: Sample) {
  let sampledBytes = 0,
    savedBytes = 0,
    seconds = 0,
    sourceBits = 0,
    targetBits = 0;
  sample.scenes.forEach(scene => {
    (scene.files || []).forEach(file => {
      let rates = fileBitrates(rule, file),
        duration = Number(file.duration) || 0;
      sampledBytes += Number(file.size) || 0;
      savedBytes += fileSaving(rule, file);
      if (rates && rates.source > 0) {
        seconds += duration;
        sourceBits += rates.source * duration;
        targetBits += rates.target * duration;
      }
    });
  });
  let exact = rule.action === "delete" || sample.scenes.length >= sample.count;
  let saved =
    rule.action === "delete"
      ? sample.filesize
      : exact
        ? savedBytes
        : sampledBytes
          ? (sample.filesize * savedBytes) / sampledBytes
          : 0;
  // Duration-weighted average video bitrate of the files that would shrink.
  return {
    saved,
    total: sample.filesize,
    sampled: sample.scenes.length,
    exact,
    sourceMbps: seconds ? sourceBits / seconds : 0,
    targetMbps: seconds ? targetBits / seconds : 0,
  };
}

export function qualityHint(rule: Rule): string {
  if (quality(rule) === "custom")
    return "Video bitrate for every file, never above its original bitrate. Audio and subtitles are kept as they are.";
  if (rule.quality === "visual")
    return "When the run reaches each video, it test-encodes three short clips and keeps the smallest setting that still looks this close to the original, measured with VMAF. That adds about half a minute per video; Preview stays quick and shows typical estimates.";
  if (rule.quality === "source")
    return (
      "Keeps each video's bitrate, so files stay about the same size; a better codec then looks better, not smaller. " +
      "For the same look in less space, choose Match visual quality. Videos already in " +
      CODECS[rule.codec] +
      " are skipped."
    );
  let width = rule.action === "resize" ? Number(rule.width) : 1920,
    height = rule.action === "resize" ? Number(rule.height) : 1080;
  let label = (RESOLUTIONS.find(item => item[0] === width + "x" + height) || [0, width + "×" + height])[1];
  return (
    "Constant quality (CRF " +
    (CRF[rule.codec] || CRF.h264)[rule.quality || ""] +
    "): each scene gets the bits it needs, never more than the original. " +
    "Typically about " +
    targetMbps(rule, width, height) +
    " Mbps for " +
    label +
    " " +
    CODECS[rule.codec] +
    "; sizes vary with the content."
  );
}

export const FIELD_LABELS: Record<string, string> = {
  rating100: "Rating",
  o_counter: "O count",
  play_count: "Play count",
  play_duration: "Play time",
  resume_time: "Resume time",
  file_count: "File count",
  tag_count: "Tag count",
  performer_count: "Performer count",
  video_codec: "Video codec",
  audio_codec: "Audio codec",
  frame_rate: "Frame rate",
  average_resolution: "Average resolution",
  is_missing: "Missing",
  has_markers: "Has markers",
  performer_favorite: "Favorite performer",
  performer_tags: "Performer tags",
  performer_age: "Performer age",
  studios: "Studio",
  groups: "Groups",
  galleries: "Galleries",
  created_at: "Created",
  updated_at: "Updated",
  last_played_at: "Last played",
  stash_id_endpoint: "StashID",
  code: "Studio code",
  url: "URL",
};
export const NOUNS: Record<string, [string, string]> = {
  tags: ["tag", "tags"],
  performer_tags: ["tag", "tags"],
  performers: ["performer", "performers"],
  studios: ["studio", "studios"],
  groups: ["group", "groups"],
  galleries: ["gallery", "galleries"],
};
export const RESOLUTION_ENUMS: Record<string, string> = {
  VERY_LOW: "144p",
  LOW: "240p",
  R360P: "360p",
  STANDARD: "480p",
  WEB_HD: "540p",
  STANDARD_HD: "720p",
  FULL_HD: "1080p",
  QUAD_HD: "1440p",
  FOUR_K: "4K",
  FIVE_K: "5K",
  SIX_K: "6K",
  SEVEN_K: "7K",
  EIGHT_K: "8K",
  HUGE: "Huge",
};
export const OPERATORS: Record<string, string> = {
  EQUALS: "=",
  NOT_EQUALS: "≠",
  GREATER_THAN: ">",
  LESS_THAN: "<",
  INCLUDES: "contains",
  EXCLUDES: "doesn't contain",
  MATCHES_REGEX: "matches",
  NOT_MATCHES_REGEX: "doesn't match",
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1)).replace(/_/g, " ");
}

export function countLabel(type: string, count: number): string {
  let noun = NOUNS[type] || ["item", "items"];
  return count + " " + noun[count === 1 ? 0 : 1];
}

export function clock(seconds: number): string {
  let h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = Math.round(seconds % 60);
  return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

export function formatValue(type: string, value: unknown): string {
  if (value === true || value === "true") return "yes";
  if (value === false || value === "false") return "no";
  if (type === "rating100" && Number.isFinite(Number(value))) {
    let stars = Math.round(Number(value) / 2) / 10;
    return stars + (stars === 1 ? " star" : " stars");
  }
  if (/^(duration|play_duration|resume_time)$/.test(type) && Number.isFinite(Number(value)))
    return clock(Number(value));
  if (/resolution$/.test(type)) return RESOLUTION_ENUMS[String(value)] || String(value).replace(/k$/, "K");
  if (typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value)) return value.toLowerCase().replace(/_/g, " ");
  return typeof value === "string" ? "“" + value + "”" : String(value);
}

export function names(items: unknown[], type: string, hideNames: boolean): string {
  if (hideNames || items.some(item => !isRecord(item) || !item.label)) return countLabel(type, items.length);
  let labels = items.map(item => (isRecord(item) ? String(item.label) : ""));
  return labels.slice(0, 3).join(", ") + (labels.length > 3 ? " +" + (labels.length - 3) + " more" : "");
}

export function describeCriterion(
  type: string,
  modifier: string | undefined,
  value: unknown,
  hideNames: boolean,
): string {
  let label = fieldLabel(type);
  if (/^(AND|OR|NOT)$/.test(type)) return "Combined filter";
  if (modifier === "IS_NULL") return label + " is empty";
  if (modifier === "NOT_NULL") return label + " is set";
  let group = isRecord(value) && Array.isArray(value.items) ? value : null;
  if (group || Array.isArray(value)) {
    let included = group ? (group.items as unknown[]) : (value as unknown[]),
      excluded = group && Array.isArray(group.excluded) ? group.excluded : [];
    let prefix = modifier === "INCLUDES_ALL" ? "all of " : modifier === "EXCLUDES" ? "not " : "";
    let text = included.length ? label + ": " + prefix + names(included, type, hideNames) : label + ": any";
    return text + (excluded.length ? ", not " + names(excluded, type, hideNames) : "");
  }
  if (isRecord(value) && "value" in value) {
    if (modifier === "BETWEEN" || modifier === "NOT_BETWEEN")
      return (
        label +
        (modifier === "NOT_BETWEEN" ? " not" : "") +
        " between " +
        formatValue(type, value.value) +
        " and " +
        formatValue(type, value.value2)
      );
    value = value.value;
  }
  return modifier && OPERATORS[modifier]
    ? label + " " + OPERATORS[modifier] + " " + formatValue(type, value)
    : label + ": " + formatValue(type, value);
}

export function timeLeft(seconds: number): string {
  if (seconds < 60) return "less than a minute left";
  let minutes = Math.round(seconds / 60);
  if (minutes < 60) return "about " + minutes + " min left";
  let hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return "about " + hours + " h" + (rest ? " " + rest + " min" : "") + " left";
}

export function braces(text: string): string {
  let quoted = false,
    escaped = false,
    out = "";
  for (let i = 0; i < text.length; i++) {
    let c = text.charAt(i);
    if (escaped) escaped = false;
    else if (c === "\\" && quoted) escaped = true;
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") c = "{";
    else if (!quoted && c === ")") c = "}";
    out += c;
  }
  return out;
}

export function queryCriteria(query?: string): Criterion[] {
  return String(query || "")
    .split("&")
    .filter(part => part.indexOf("c=") === 0)
    .map(part => {
      try {
        return JSON.parse(braces(decodeURIComponent(part.slice(2).replace(/\+/g, " "))));
      } catch (error) {
        return null;
      }
    })
    .filter(criterion => criterion && typeof criterion.type === "string");
}

export function filterSummary(condition: Condition, hideNames?: boolean): string {
  if (condition.all) return "All scenes";
  let labels = queryCriteria(condition.query).map(c =>
    describeCriterion(c.type, c.modifier, c.value, Boolean(hideNames)),
  );
  if (!labels.length)
    labels = Object.keys(condition.scene || {}).map(key => {
      let entry = condition.scene![key],
        criterion = isRecord(entry) && "modifier" in entry ? entry : null;
      return describeCriterion(
        key,
        criterion ? String(criterion.modifier) : undefined,
        criterion ? ("value2" in criterion ? criterion : criterion.value) : entry,
        Boolean(hideNames),
      );
    });
  if (condition.find?.q) labels.unshift("Search “" + condition.find.q + "”");
  return labels.join(" · ") || "No condition selected";
}

export function actionSummary(rule: Rule): string {
  if (rule.action === "delete") return "Delete scene and files";
  let parts = [ACTIONS[rule.action]];
  if (rule.action === "resize")
    parts.push(
      "max " +
        (RESOLUTIONS.find(item => item[0] === rule.width + "x" + rule.height) || [
          0,
          rule.width + "×" + rule.height,
        ])[1],
    );
  parts.push(CODECS[rule.codec] || rule.codec);
  parts.push(
    quality(rule) === "custom"
      ? rule.mbps + " Mbps"
      : rule.quality === "source"
        ? "same bitrate"
        : rule.quality === "visual"
          ? "visual match VMAF " + rule.vmaf
          : (QUALITIES.find(item => item[0] === rule.quality) || ["", rule.quality || ""])[1].toLowerCase(),
  );
  return parts.join(" · ");
}

interface Criterion {
  type: string;
  modifier?: string;
  value?: unknown;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
