import { defaults, limits } from "@generated/dirtyRank.settings";
import { COHORTS, LEADERBOARD_TOP_OPTIONS, LEADERBOARDS_ROUTE_PATH, OVERALL_LEADERBOARD_ID, ROUTE_PATH } from "../constants";
import type { RankSettingsDraft } from "../types";
import { integer } from "./numbers";
export function cohortLabel(cohort: string | undefined) {
  var match = COHORTS.find(function (item) { return item[0] === cohort; });
  return match ? match[1] : cohort || "";
}
export function leaderboardTopCount(value: unknown) {
  var count = Number(value);
  return LEADERBOARD_TOP_OPTIONS.some(function (option) { return option.count === count; }) ? count : defaults.leaderboardTopCount;
}
/** The largest page size that is a whole number of featured rows. */
export function leaderboardPerformerCountMaximum(multiple: number) {
  return Math.floor(limits.leaderboardPerformerCount.max / multiple) * multiple;
}
export function leaderboardPerformerCount(value: unknown, topCount?: unknown) {
  var multiple = leaderboardTopCount(topCount);
  if (value === null || value === undefined || !String(value).trim())
    value = defaults.leaderboardPerformerCount;
  var count = integer(value, defaults.leaderboardPerformerCount, multiple * 2, limits.leaderboardPerformerCount.max);
  return Math.min(leaderboardPerformerCountMaximum(multiple), Math.ceil(count / multiple) * multiple);
}
export function leaderboardPerformerCountError(settings: RankSettingsDraft) {
  var multiple = leaderboardTopCount(settings.leaderboardTopCount);
  var count = Number(settings.leaderboardPerformerCount);
  var maximum = leaderboardPerformerCountMaximum(multiple);
  return !String(settings.leaderboardPerformerCount).trim() || !Number.isInteger(count) ||
    count < multiple * 2 || count > maximum || count % multiple !== 0
    ? "Choose a multiple of " + multiple + " between " + (multiple * 2) + " and " + maximum + "."
    : "";
}
export function battleCategoryPath(categoryId: string, kingsMode?: boolean, performerId?: string, cohort?: string) {
  var base = performerId ? ROUTE_PATH + "/gauntlet/" + encodeURIComponent(performerId) : ROUTE_PATH + "/category";
  return base + "/" + encodeURIComponent(categoryId) + (kingsMode && !performerId ? "/king-of-the-hill" : "") +
    (cohort ? "?box=" + encodeURIComponent(cohort) : "");
}
export function battleRouteFromPath(pathname: string) {
  if (pathname === ROUTE_PATH || pathname === ROUTE_PATH + "/")
    return { categoryId: "", kingsMode: false, performerId: "" };
  var match = pathname.match(/^\/plugins\/dirty-rank\/category\/([^/]+)(?:\/(king-of-the-hill))?\/?$/);
  var gauntlet = pathname.match(/^\/plugins\/dirty-rank\/gauntlet\/([^/]+)(?:\/([^/]+))?\/?$/);
  try {
    if (match)
      return { categoryId: decodeURIComponent(match[1]), kingsMode: Boolean(match[2]), performerId: "" };
    if (gauntlet)
      return { categoryId: gauntlet[2] ? decodeURIComponent(gauntlet[2]) : "", kingsMode: false, performerId: decodeURIComponent(gauntlet[1]) };
  }
  catch (_error) { }
  return null;
}
export function leaderboardStatPath(categoryId: string, cohort?: string) {
  return LEADERBOARDS_ROUTE_PATH + "/" + encodeURIComponent(categoryId === OVERALL_LEADERBOARD_ID ? "overall" : categoryId) +
    (cohort ? "?box=" + encodeURIComponent(cohort) : "");
}
export function leaderboardIdFromPath(pathname: string) {
  var prefix = LEADERBOARDS_ROUTE_PATH + "/";
  if (pathname.indexOf(prefix) !== 0)
    return OVERALL_LEADERBOARD_ID;
  var segment = pathname.slice(prefix.length);
  if (!segment || segment.indexOf("/") !== -1)
    return OVERALL_LEADERBOARD_ID;
  try {
    return segment === "overall" ? OVERALL_LEADERBOARD_ID : decodeURIComponent(segment);
  }
  catch (_error) {
    return OVERALL_LEADERBOARD_ID;
  }
}
export function battleId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function")
    return window.crypto.randomUUID();
  return "dirty-rank-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}
export function ratingDelta(after: number, before: number) {
  var value = Number(after) - Number(before);
  return (value >= 0 ? "+" : "") + value.toFixed(1);
}
