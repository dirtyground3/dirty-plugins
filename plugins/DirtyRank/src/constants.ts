export const PLUGIN_ID = "dirtyRank";
export const ROUTE_PATH = "/plugins/dirty-rank";
export const GAUNTLET_ROUTE_PATH = "/plugins/dirty-rank/gauntlet/:performerId";
export const BATTLE_CATEGORY_ROUTE_PATH = ROUTE_PATH + "/category/:categoryId/:mode?";
export const LEADERBOARDS_ROUTE_PATH = "/plugins/dirty-rank-leaderboards";
export const PERFORMERS_ROUTE_PATH = "/performers";
export const OVERALL_SORT_VALUE = "dirty_rank_overall";
export const OVERALL_SORT_LABEL = "Overall score";
export const OVERALL_SORT_MESSAGE_ID = "dirty_rank.overall_elo";
export const OVERALL_LEADERBOARD_ID = "__overall__";
export const OVERALL_SORT_ACTIVE = "__dirtyRankOverallSortActive";
export const OVERALL_SORT_PAGE = "__dirtyRankOverallSortPage";
export const OVERALL_SORT_PAGE_SIZE = "__dirtyRankOverallSortPageSize";
export const OVERALL_SORT_DIRECTION = "__dirtyRankOverallSortDirection";
export const GLICKO_SCALE = 173.7178;
export const UNDO_HISTORY_LIMIT = 25;
export const LEADERBOARD_TOP_OPTIONS = [
  { count: 3, name: "Podium" },
  { count: 4, name: "Mount Rushmore", theme: "rushmore" },
  { count: 5, name: "Fingers", theme: "fingers" },
];
export const COHORTS = [["FEMALE", "Female"], ["MALE", "Male"], ["TRANSGENDER_FEMALE", "Transgender female"], ["TRANSGENDER_MALE", "Transgender male"], ["INTERSEX", "Intersex"], ["NON_BINARY", "Non-binary"]];
