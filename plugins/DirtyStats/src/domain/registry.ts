import type { StatsDefinition } from "../types";
export function createRegistry() {

  var route = "/plugins/dirty-stats";

  var FREE_COUNT = "freeCount";


  var entries: Record<string, Required<StatsDefinition>> = {
    origin: { label: "Performer origin", route: route, entity: "performers", group: "performers", size: "medium", options: { showNumbers: false }, choices: { showNumbers: [false, true] } },
    growth: { label: "Content growth", route: route + "/scenes", entity: "scenes", group: "growth", size: "large", options: { dateBasis: "created_at", grouping: "month", showCapacity: true, showForecast: false }, choices: { dateBasis: ["created_at", "mod_time", "scene_date"], grouping: ["day", "month", "year"], showCapacity: [false, true], showForecast: [false, true] } },
    ages: { label: "Age at scene", route: route + "/ages", entity: "scenes", group: "cast", size: "medium", options: { showPerformerCount: true, showModeAge: true, showMedianAge: false, showAverageAge: false }, choices: { showPerformerCount: [false, true], showModeAge: [false, true], showMedianAge: [false, true], showAverageAge: [false, true] } },
    ratings: { label: "Scene ratings", route: route + "/ratings", entity: "scenes", group: "scenes", size: "medium", options: { rounding: 0.5 }, choices: { rounding: [0, 0.5, 1] } },
    performerRatings: { label: "Performer ratings", route: route + "/performer-ratings", entity: "performers", group: "performers", size: "medium", options: { rounding: 0.5 }, choices: { rounding: [0, 0.5, 1] } },
    performerScatter: { label: "Rating vs scenes", route: route + "/performer-scatter", entity: "performers", group: "performers", size: "medium", options: { minRating: 9, maxScenes: 10 }, choices: { minRating: [0, 5, 6, 7, 8, 9], maxScenes: [0, 5, 10, 20, 50, 100] } },
    performerCards: { label: "Performer cards", route: route, entity: "performers", group: "performerCards", size: "large", options: { cardCount: 8 }, choices: { cardCount: FREE_COUNT } },
    countRating: { label: "Count vs rating", route: route + "/count-rating", entity: "scenes", group: "scenes", size: "medium", options: { metric: "play_count" }, choices: { metric: ["play_count", "o_counter"] } },
    repeatOffenders: { label: "Repeat-offender curve", route: route + "/repeat-offenders", entity: "scenes", group: "scenes", size: "medium", options: {}, choices: {} },
    qualityEfficiency: { label: "Quality efficiency", route: route + "/quality-efficiency", entity: "scenes", group: "scenes", size: "medium", options: {}, choices: {} },
    studios: { label: "Studio value map", route: route + "/studios", entity: "scenes", group: "scenes", size: "medium", options: { minScenes: 1 }, choices: { minScenes: [1, 2, 5, 10, 20] } },
    tags: { label: "Tag DNA", route: route + "/tags", entity: "scenes", group: "tags", size: "medium", options: { metric: "rating", maxTags: 50 }, choices: { metric: ["rating", "play_count"], maxTags: [0, 25, 50, 100, 200] } },
    constellation: { label: "Cast constellation", route: route + "/constellation", entity: "scenes", group: "cast", size: "large", options: { maxPerformers: 100, minShared: 1 }, choices: { maxPerformers: [0, 50, 100, 200, 500, 1000], minShared: [1, 2, 3, 5, 10] } },
    birthdays: { label: "Performer birthdays", route: route + "/birthdays", entity: "performers", group: "performers", size: "medium", options: { upcomingCount: 6 }, choices: { upcomingCount: [3, 6, 12] } }
  };

  var widgetOrder = Object.keys(entries);

  widgetOrder.forEach(function (name) {
    entries[name].options.showHeader = true;
    entries[name].choices.showHeader = [false, true];
  });

  var widgets = Object.assign({}, entries);

  const allEntries: Record<string, StatsDefinition> = Object.assign({}, entries, { dashboard: { label: "Dashboard", route: route + "/dashboard" } });

  var statisticOrder = ["dashboard"].concat(widgetOrder.filter(function (key) { return key !== "performerCards"; }));
  return { route, entries: allEntries, widgets, statisticOrder, widgetOrder };
}
