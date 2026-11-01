import type { LibraryStats } from "../types";

export const LIBRARY_STATS_QUERY =
  "query DirtyStatsLibraryTotals{stats{scene_count scenes_size scenes_duration image_count images_size gallery_count performer_count studio_count group_count tag_count total_o_count total_play_duration total_play_count scenes_played}}";

const SIZE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
// Stash's own duration units: a month is 30 days and a year 365.
const DURATION_UNITS: Array<[string, number]> = [
  ["Y", 31536000],
  ["M", 2592000],
  ["W", 604800],
  ["D", 86400],
  ["h", 3600],
  ["m", 60],
  ["s", 1],
];

const count = (value: number) => Number(value || 0).toLocaleString("en");

/** Sizes as the native statistics page shows them: one decimal from GiB up, whole numbers below. */
export function formatLibrarySize(bytes: number) {
  let size = Number(bytes) || 0,
    unit = 0;
  while (size >= 1024 && unit + 1 < SIZE_UNITS.length) {
    size /= 1024;
    unit += 1;
  }
  return size.toLocaleString("en", { maximumFractionDigits: unit >= 3 ? 1 : 0 }) + " " + SIZE_UNITS[unit];
}

/** Durations as the native statistics page shows them: the three largest non-zero units, or a dash. */
export function formatLibraryDuration(seconds: number) {
  let remaining = Number(seconds) || 0;
  const parts: string[] = [];
  for (const [unit, length] of DURATION_UNITS) {
    const amount = Math.floor(remaining / length);
    if (!amount) continue;
    remaining %= length;
    parts.push(amount + unit);
  }
  return parts.slice(0, 3).join(" ") || "-";
}

/** The figures of Stash's statistics page, in its order. */
export function libraryTotals(stats: LibraryStats) {
  return [
    { label: "Scenes size", value: formatLibrarySize(stats.scenes_size) },
    { label: "Scenes", value: count(stats.scene_count) },
    { label: "Groups", value: count(stats.group_count) },
    { label: "Scenes duration", value: formatLibraryDuration(stats.scenes_duration) },
    { label: "Performers", value: count(stats.performer_count) },
    { label: "Images size", value: formatLibrarySize(stats.images_size) },
    { label: "Galleries", value: count(stats.gallery_count) },
    { label: "Images", value: count(stats.image_count) },
    { label: "Studios", value: count(stats.studio_count) },
    { label: "Tags", value: count(stats.tag_count) },
    { label: "Total O-count", value: count(stats.total_o_count) },
    { label: "Total play count", value: count(stats.total_play_count) },
    { label: "Scenes played", value: count(stats.scenes_played) },
    { label: "Total play duration", value: formatLibraryDuration(stats.total_play_duration) },
  ];
}
