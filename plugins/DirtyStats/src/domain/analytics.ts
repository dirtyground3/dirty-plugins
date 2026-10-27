import { world } from "../runtime";
import { CONSTELLATION_EDGE_BUDGET, displayedConstellationLinks } from "./constellationLinks";
import { statsTheme, themeColor } from "../settings";
import type { StatsFilter } from "../runtime";
import type {
  ChartEvent,
  ChartInstance,
  ChartOption,
  ConstellationSelection,
  StatsConstellationLink,
  StatsConstellationNode,
  StatsCountRatingPoint,
  StatsPerformer,
  StatsPerformerSceneRatingPoint,
  StatsPerformerWithSceneRatings,
  StatsQualityPoint,
  StatsRepeatRow,
  StatsScatterPoint,
  StatsScene,
  StatsStudioPoint,
  TagRow,
  WorldData,
  WorldFeature,
} from "../types";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const eckertIV = {
  project: (point: number[]) => {
    const radians = Math.PI / 180,
      lambda = point[0] * radians;
    const phi = Math.max(-90, Math.min(90, point[1])) * radians;
    let theta = phi / 2,
      target = (2 + Math.PI / 2) * Math.sin(phi);
    if (Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-10) theta = phi;
    else
      for (let i = 0; i < 30; i++) {
        const sin = Math.sin(theta),
          cos = Math.cos(theta);
        const delta = (theta + sin * cos + 2 * sin - target) / (2 * cos * (1 + cos));
        theta -= delta;
        if (Math.abs(delta) < 1e-12) break;
      }
    return [
      (2 * lambda * (1 + Math.cos(theta))) / Math.sqrt(Math.PI * (4 + Math.PI)),
      -2 * Math.sqrt(Math.PI / (4 + Math.PI)) * Math.sin(theta),
    ];
  },
  unproject: (point: number[]) => {
    const theta = Math.asin(Math.max(-1, Math.min(1, -point[1] / (2 * Math.sqrt(Math.PI / (4 + Math.PI))))));
    const sin = Math.sin(theta),
      cos = Math.cos(theta);
    const phi = Math.asin(Math.max(-1, Math.min(1, (theta + sin * cos + 2 * sin) / (2 + Math.PI / 2))));
    const lambda = (point[0] * Math.sqrt(Math.PI * (4 + Math.PI))) / (2 * (1 + cos));
    return [(lambda * 180) / Math.PI, (phi * 180) / Math.PI];
  },
};
const constellationGenderStyles: Record<string, { label: string; color: string }> = {
  FEMALE: { label: "Female", color: "#f29aaa" },
  MALE: { label: "Male", color: "#8eb8f5" },
  TRANSGENDER_FEMALE: { label: "Transgender female", color: "#d9a6e8" },
  TRANSGENDER_MALE: { label: "Transgender male", color: "#8fd5dd" },
  NON_BINARY: { label: "Non-binary", color: "#f4df86" },
  INTERSEX: { label: "Intersex", color: "#b9a2e8" },
  UNKNOWN: { label: "Unknown", color: "#aeb8c2" },
};
const studioImagePromises: Record<string, Promise<HTMLImageElement | null>> = Object.create(null);
const studioImages: Record<string, HTMLImageElement> = Object.create(null);
const studioLogoSymbols: Record<string, string> = Object.create(null);
/** Items once each by string ID, in first-seen order; items without an ID are skipped. */
function uniqueById<T extends { id?: unknown }>(items: T[]) {
  const byId = new Map<string, T>();
  items.forEach(item => {
    const id = String(item && item.id != null ? item.id : "");
    if (id && !byId.has(id)) byId.set(id, item);
  });
  return byId;
}
/** Counts such as views and O counts; missing or invalid values count as zero. */
function countValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function countryIndex(features: WorldFeature[]) {
  const index: Record<string, string> = Object.create(null);
  const display = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
  features.forEach(feature => {
    const p = feature.properties;
    [p.name, p.iso2, p.iso3].concat(p.aliases || []).forEach(name => {
      if (name && name !== "-99") index[normalize(name)] = p.name;
    });
    if (display && /^[A-Z]{2}$/.test(p.iso2)) index[normalize(display.of(p.iso2))] = p.name;
  });
  const aliases: Record<string, string> = {
    USA: "United States of America",
    US: "United States of America",
    "United States": "United States of America",
    UK: "United Kingdom",
    "Great Britain": "United Kingdom",
    "Czech Republic": "Czechia",
    "Russian Federation": "Russia",
    "South Korea": "South Korea",
    "Republic of Korea": "South Korea",
    "North Korea": "North Korea",
    "Ivory Coast": "Ivory Coast",
    "Cote d'Ivoire": "Ivory Coast",
    "Democratic Republic of the Congo": "Democratic Republic of the Congo",
    "DR Congo": "Democratic Republic of the Congo",
    "Republic of the Congo": "Republic of the Congo",
  };
  Object.keys(aliases).forEach(name => {
    const target = index[normalize(aliases[name])];
    if (target) index[normalize(name)] = target;
  });
  return index;
}

function countryPlaceholder(value: unknown) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (!text) return true;
  if (text === "unknown" || text === "none" || text === "?") return true;
  if (/^[-\u2013\u2014]+$/.test(text)) return true;
  // Only a bare 2-3 letter code may stand in for an ISO code: "N/A" and its
  // punctuation variants must not collapse into Namibia's "NA".
  return normalize(text) === "na" && text !== "na";
}

export function countryName(value: unknown, index: Record<string, string>) {
  const text = String(value || "").trim();
  if (!text || countryPlaceholder(text)) return null;
  return index[normalize(text)] || null;
}

export function aggregate(performers: StatsPerformer[], index: Record<string, string>) {
  const counts: Record<string, number> = Object.create(null);
  let missing = 0;
  performers.forEach(p => {
    const country = countryName(p.country, index);
    if (!country) {
      missing++;
      return;
    }
    counts[country] = (counts[country] || 0) + 1;
  });
  return {
    rows: Object.keys(counts)
      .map(name => ({ name, value: counts[name] }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
    missing,
    total: performers.length,
  };
}

export function filterAgeScenes(scenes: StatsScene[], ids: Array<string | number> | null) {
  if (ids == null) return scenes;
  const allowed = new Set(ids.map(String));
  return scenes.map(scene =>
    Object.assign({}, scene, {
      performers: (scene.performers || []).filter(performer => allowed.has(String(performer.id))),
    }),
  );
}

export function sceneVariables(filter: StatsFilter, page: number) {
  return {
    filter: Object.assign({}, filter.makeFindFilter(), { page, per_page: 500 }),
    sceneFilter: filter.makeFilter(),
  };
}

export function mapLayout(node: Pick<HTMLElement, "clientWidth" | "clientHeight"> | null, showLegend: boolean) {
  const width = Math.max(1, node!.clientWidth - 8);
  const height = Math.max(1, node!.clientHeight - (showLegend ? 30 : 8));
  return { layoutCenter: ["50%", height / 2 + 4], layoutSize: Math.min(width, height * 2) };
}

export function originMapOption(
  stats: { rows: Array<{ name: string; value: number }> },
  features: WorldFeature[],
  options: ChartOption,
) {
  const counts = new Map(stats.rows.map(row => [row.name, row.value]));
  const maximum = stats.rows.reduce((max, row) => Math.max(max, row.value), 1);
  // Compress large outliers for colour only; labels and tooltips retain counts.
  const primary = /^#([0-9a-f]{6})$/i.exec(themeColor("primary"));
  const channels = primary
    ? [0, 2, 4].map(offset => parseInt(primary![1].slice(offset, offset + 2), 16))
    : [84, 213, 202];
  const colors = [
    [0.3, 0],
    [0.7, 0.1],
    [0.45, 0.55],
  ].map(shade => "rgb(" + channels.map(channel => Math.round(channel * shade[0] + 255 * shade[1])).join(",") + ")");
  function countLabel(p: ChartEvent) {
    return p.data && p.data.count > 0 ? String(p.data.count) : "";
  }
  return {
    backgroundColor: options.backgroundColor || "transparent",
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      formatter: (p: ChartEvent) => p.name + ": " + (p.data ? p.data.count : 0) + " performers",
    },
    visualMap: {
      show: options.showLegend,
      min: 0,
      max: Math.log(1 + maximum),
      left: 8,
      bottom: 4,
      calculable: false,
      orient: "horizontal",
      itemWidth: 8,
      itemHeight: 70,
      textGap: 5,
      padding: 0,
      text: [String(maximum), "0"],
      formatter: (value: number) => String(Math.round(Math.exp(value) - 1)),
      textStyle: { color: themeColor("text"), fontSize: 10 },
      inRange: { color: colors },
    },
    series: [
      {
        type: "map",
        map: options.map,
        projection: eckertIV,
        roam: options.roam,
        selectedMode: options.selectable ? "single" : false,
        select: { label: { color: "#fff" }, itemStyle: { areaColor: themeColor("highlight") } },
        scaleLimit: { min: 1, max: 12 },
        label: {
          show: options.showNumbers,
          color: "#fff",
          textBorderColor: "#000",
          textBorderWidth: 2,
          fontSize: 10,
          formatter: countLabel,
        },
        itemStyle: { borderColor: themeColor("border"), borderWidth: 0.5 },
        emphasis: {
          label: { show: options.showNumbers, formatter: countLabel },
          itemStyle: { areaColor: themeColor("highlight") },
        },
        data: features.map(feature => {
          const name = feature.properties.name,
            count = counts.get(name) || 0;
          // Null bypasses ECharts' continuous scale; zero stays a neutral fill.
          return {
            name,
            count,
            value: count ? Math.log(1 + count) : null,
            selected: options.selectedCountry === name,
            itemStyle: count ? undefined : { areaColor: themeColor("grid") },
          };
        }),
      },
    ],
  };
}

export function performerVariables(filter: StatsFilter, page: number) {
  return {
    filter: Object.assign({}, filter.makeFindFilter(), { page, per_page: 500 }),
    performerFilter: filter.makeFilter(),
  };
}

export function orderedCards(cards: Array<StatsScene & StatsPerformer>, ids: Array<string | number>) {
  // Compare as strings: Stash serializes IDs as strings, and numeric coercion
  // would map every non-numeric ID to NaN and collapse them onto one key.
  const byId = new Map(cards.map(card => [String(card.id), card]));
  return ids.map(id => byId.get(String(id))).filter((card): card is StatsScene & StatsPerformer => Boolean(card));
}

export function countryPerformers(performers: StatsPerformer[], country: string) {
  return country ? performers.filter(p => countryName(p.country, countries()) === country) : performers;
}

export function constellationGender(value: unknown) {
  const key =
    String(value || "UNKNOWN")
      .trim()
      .toUpperCase()
      .replace(/[ -]+/g, "_") || "UNKNOWN";
  if (constellationGenderStyles[key]) return Object.assign({ key }, constellationGenderStyles[key]);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return {
    key,
    label: key
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/(^|\s)\S/g, letter => letter.toUpperCase()),
    color: "hsl(" + (hash % 360) + ", 55%, 72%)",
  };
}

export function constellationLayout(count: number) {
  if (count > 500)
    return {
      symbolMin: 6,
      symbolRange: 24,
      labelLimit: 8,
      repulsion: [280, 1200],
      edgeLength: [85, 250],
      gravity: 0.018,
      zoom: 0.52,
      edgeOpacity: 0.1,
    };
  if (count > 200)
    return {
      symbolMin: 8,
      symbolRange: 28,
      labelLimit: 10,
      repulsion: [240, 980],
      edgeLength: [78, 225],
      gravity: 0.024,
      zoom: 0.62,
      edgeOpacity: 0.13,
    };
  if (count > 80)
    return {
      symbolMin: 10,
      symbolRange: 32,
      labelLimit: 12,
      repulsion: [190, 760],
      edgeLength: [70, 205],
      gravity: 0.032,
      zoom: 0.76,
      edgeOpacity: 0.18,
    };
  return {
    symbolMin: 13,
    symbolRange: 35,
    labelLimit: 15,
    repulsion: [150, 620],
    edgeLength: [65, 185],
    gravity: 0.04,
    zoom: 0.9,
    edgeOpacity: 0.24,
  };
}

export function aggregateConstellation(
  scenes: StatsScene[],
  maxPerformers: number,
  minShared: number,
  edgeBudget = CONSTELLATION_EDGE_BUDGET,
) {
  const uniqueScenes = new Map<string, StatsScene>(),
    performers = new Map<string, StatsConstellationNode>();
  scenes.forEach(scene => {
    if (!uniqueScenes.has(String(scene.id))) uniqueScenes.set(String(scene.id), scene);
  });
  uniqueScenes.forEach(scene => {
    const seen = new Set();
    (scene.performers || []).forEach(performer => {
      const id = String(performer.id == null ? "" : performer.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      const gender = constellationGender(performer.gender);
      if (!performers.has(id))
        performers.set(id, {
          id,
          name: String(performer.name || "Performer #" + id),
          gender: gender.key,
          genderLabel: gender.label,
          genderColor: gender.color,
          value: 0,
          collaborators: 0,
        });
      const saved = performers.get(id)!;
      if (saved.gender === "UNKNOWN" && gender.key !== "UNKNOWN") {
        saved.gender = gender.key;
        saved.genderLabel = gender.label;
        saved.genderColor = gender.color;
      }
      saved.value++;
    });
  });
  const ranked = Array.from(performers.values()).sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const requestedLimit = Number(maxPerformers);
  let limit = requestedLimit === 0 ? ranked.length : Math.max(1, requestedLimit || 100),
    nodes = ranked.slice(0, limit),
    visible = new Set(nodes.map(node => node.id)),
    pairs = new Map<string, StatsConstellationLink & { id: string }>();
  uniqueScenes.forEach(scene => {
    const scenePerformers = new Map<string, string>();
    (scene.performers || []).forEach(performer => {
      const id = String(performer.id == null ? "" : performer.id);
      if (id && visible.has(id) && !scenePerformers.has(id))
        scenePerformers.set(id, String(performer.name || performers.get(id)!.name));
    });
    const ids = Array.from(scenePerformers.keys()).sort();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = ids[i] + "\u0000" + ids[j];
        if (!pairs.has(key))
          pairs.set(key, {
            id: key,
            source: ids[i],
            target: ids[j],
            sourceName: scenePerformers.get(ids[i])!,
            targetName: scenePerformers.get(ids[j])!,
            value: 0,
          });
        pairs.get(key)!.value++;
      }
  });
  const threshold = Math.max(1, Number(minShared) || 1);
  const links = Array.from(pairs.values())
    .filter(link => link.value >= threshold)
    .sort(
      (a, b) =>
        b.value - a.value || a.sourceName.localeCompare(b.sourceName) || a.targetName.localeCompare(b.targetName),
    );
  const collaborators = new Map<string, number>();
  links.forEach(link => {
    collaborators.set(link.source, (collaborators.get(link.source) || 0) + 1);
    collaborators.set(link.target, (collaborators.get(link.target) || 0) + 1);
  });
  nodes = nodes.map(node => Object.assign({}, node, { collaborators: collaborators.get(node.id) || 0 }));
  const displayed = displayedConstellationLinks(
    links,
    Math.max(1, Math.floor(edgeBudget) || CONSTELLATION_EDGE_BUDGET),
  );
  return {
    nodes,
    links: displayed,
    totalConnections: links.length,
    hiddenConnections: links.length - displayed.length,
    totalScenes: uniqueScenes.size,
    totalPerformers: performers.size,
  };
}

export function constellationScenes(scenes: StatsScene[], selection: ConstellationSelection | null) {
  const seen = new Set(),
    ids = selection ? new Set(selection.ids.map(String)) : null;
  return scenes.filter(scene => {
    const sceneId = String(scene.id);
    if (seen.has(sceneId)) return false;
    seen.add(sceneId);
    if (!ids) return true;
    const present = new Set((scene.performers || []).map(performer => String(performer.id)));
    return Array.from(ids).every(id => present.has(id));
  });
}

function ratingNumber(scene: Pick<StatsScene, "rating100">) {
  const rating = scene.rating100 == null || scene.rating100 === "" ? NaN : Number(scene.rating100);
  return Number.isFinite(rating) && rating >= 0 && rating <= 100 ? rating / 10 : null;
}

export function roundRating(value: number, step: number = 0) {
  if (!step) return value;
  return Math.min(10, Math.max(0, Math.round(value / step) * step));
}

export function sceneRating(scene: Pick<StatsScene, "rating100">, step: number) {
  const rating = ratingNumber(scene);
  return rating == null ? "Unrated" : String(roundRating(rating, step));
}

export function aggregateRatings(scenes: Array<Pick<StatsScene, "id" | "rating100">>, step: number) {
  const counts = new Map(),
    seen = new Set();
  scenes.forEach(scene => {
    if (seen.has(scene.id)) return;
    seen.add(scene.id);
    const rating = sceneRating(scene, step);
    counts.set(rating, (counts.get(rating) || 0) + 1);
  });
  return {
    total: seen.size,
    rows: Array.from(counts, item => ({ name: item[0], value: item[1] })).sort((a, b) =>
      a.name === "Unrated" ? 1 : b.name === "Unrated" ? -1 : Number(a.name) - Number(b.name),
    ),
  };
}

function scatterBound(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function aggregateScatter(performers: StatsPerformer[], minRating: number, maxScenes: number) {
  const floor = scatterBound(minRating),
    ceiling = scatterBound(maxScenes);
  const hasBounds = floor != null || ceiling != null;
  const unique = uniqueById(performers),
    points: StatsScatterPoint[] = [];
  let missingRating = 0,
    missingScenes = 0;
  unique.forEach((performer, id) => {
    const rating = ratingNumber(performer);
    const scenes = performer.scene_count == null || performer.scene_count === "" ? NaN : Number(performer.scene_count);
    if (rating == null) {
      missingRating++;
      return;
    }
    if (!Number.isFinite(scenes) || scenes < 0) {
      missingScenes++;
      return;
    }
    const highlight = hasBounds && (floor == null || rating >= floor) && (ceiling == null || scenes <= ceiling);
    points.push({ id, name: String(performer.name || "Performer #" + id), rating, scenes, highlight });
  });
  return {
    points,
    total: unique.size,
    missingRating,
    missingScenes,
    highlights: points.filter(point => point.highlight).length,
  };
}

export function aggregatePerformerSceneRatings(performers: StatsPerformerWithSceneRatings[]) {
  const unique = new Map(performers.map(performer => [String(performer.id), performer]));
  const points: StatsPerformerSceneRatingPoint[] = [];
  let missingRating = 0,
    missingScenes = 0;
  unique.forEach((performer, id) => {
    const rating = ratingNumber(performer);
    if (rating == null) {
      missingRating++;
      return;
    }
    const scenes = new Map((performer.scenes || []).map(scene => [String(scene.id), scene]));
    let sum = 0,
      ratedScenes = 0;
    scenes.forEach(scene => {
      const value = ratingNumber(scene);
      if (value != null) {
        sum += value;
        ratedScenes++;
      }
    });
    if (!ratedScenes) {
      missingScenes++;
      return;
    }
    points.push({
      id,
      name: String(performer.name || "Performer #" + id),
      rating,
      averageRating: sum / ratedScenes,
      ratedScenes,
      unratedScenes: scenes.size - ratedScenes,
    });
  });
  return { points, missingRating, missingScenes };
}

function studioSymbolSize(bytes: number, maxBytes: number) {
  if (!(maxBytes > 0) || !(bytes > 0)) return 10;
  return 10 + 34 * Math.sqrt(bytes / maxBytes);
}

function studioImageSource(studio: StatsScene["studio"]) {
  const path = studio && studio.image_path ? String(studio.image_path).trim() : "";
  if (path) return path;
  return studio && studio.id != null && studio.id !== "" ? "/studio/" + encodeURIComponent(studio.id) + "/image" : "";
}

export function loadStudioImage(path: string) {
  if (!path) return Promise.resolve(null);
  if (!studioImagePromises[path]) {
    studioImagePromises[path] = new Promise<HTMLImageElement | null>(resolve => {
      const image = new Image();
      image.onload = () => {
        studioImages[path] = image;
        resolve(image);
      };
      image.onerror = () => resolve(null);
      image.src = path;
    });
  }
  return studioImagePromises[path];
}

function renderStudioLogo(image: HTMLImageElement, active: boolean) {
  const size = 96,
    radius = size / 2 - 3,
    sourceWidth = image.naturalWidth || image.width,
    sourceHeight = image.naturalHeight || image.height;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return "";
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.save();
  context.beginPath();
  context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  const scale = Math.max(size / sourceWidth, size / sourceHeight);
  const width = sourceWidth * scale,
    height = sourceHeight * scale;
  context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  context.restore();
  context.beginPath();
  context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  context.lineWidth = 5;
  context.strokeStyle = active ? "#fff" : themeColor("primary");
  context.stroke();
  return canvas.toDataURL("image/png");
}

function studioLogoSymbol(path: string, active: boolean) {
  if (!path || !studioImages[path]) return "";
  const key = path + (active ? "|active" : "");
  if (studioLogoSymbols[key] == null) {
    try {
      studioLogoSymbols[key] = renderStudioLogo(studioImages[path], active) || "";
    } catch (err) {
      studioLogoSymbols[key] = "";
    }
  }
  return studioLogoSymbols[key];
}

export function studioSeriesData(points: StatsStudioPoint[], maxBytes: number, selected: string | null) {
  return points.map(point => {
    const active = point.id === selected,
      logo = studioLogoSymbol(point.image, active);
    const item: ChartOption = {
      id: point.id,
      name: point.name,
      bytes: point.bytes,
      unrated: point.unrated,
      value: [point.scenes, Math.round(point.rating! * 10) / 10],
      symbolSize: studioSymbolSize(point.bytes, maxBytes),
    };
    if (logo) item.symbol = "image://" + logo;
    else
      item.itemStyle = {
        color: themeColor("primary"),
        opacity: 0.8,
        borderColor: active ? "#fff" : "transparent",
        borderWidth: active ? 2 : 0,
      };
    return item;
  });
}

export function aggregateStudios(scenes: StatsScene[]) {
  let seen = new Set(),
    studios = new Map<
      string,
      { id: string; name: string; image: string; scenes: number; rated: number; ratingSum: number; bytes: number }
    >(),
    missingStudio = 0,
    missingSizes = 0;
  scenes.forEach(scene => {
    if (seen.has(scene.id)) return;
    seen.add(scene.id);
    if (!scene.studio || scene.studio.id == null || !String(scene.studio.name || "").trim()) {
      missingStudio++;
      return;
    }
    const id = String(scene.studio.id);
    if (!studios.has(id))
      studios.set(id, {
        id,
        name: String(scene.studio.name),
        image: studioImageSource(scene.studio),
        scenes: 0,
        rated: 0,
        ratingSum: 0,
        bytes: 0,
      });
    const entry = studios.get(id)!;
    entry.scenes++;
    const rating = ratingNumber(scene);
    if (rating != null) {
      entry.rated++;
      entry.ratingSum += rating;
    }
    const files = new Set();
    (scene.files || []).forEach(file => {
      if (file.id != null) {
        if (files.has(file.id)) return;
        files.add(file.id);
      }
      const size = file.size == null || file.size === "" ? NaN : Number(file.size);
      if (!Number.isFinite(size) || size < 0) {
        missingSizes++;
        return;
      }
      entry.bytes += size;
    });
  });
  const points = Array.from(studios.values())
    .map(entry => ({
      id: entry.id,
      name: entry.name,
      image: entry.image,
      scenes: entry.scenes,
      rated: entry.rated,
      unrated: entry.scenes - entry.rated,
      rating: entry.rated ? entry.ratingSum / entry.rated : null,
      bytes: entry.bytes,
    }))
    .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name));
  return {
    points,
    total: seen.size,
    studios: points.length,
    missingStudio,
    missingSizes,
    totalBytes: points.reduce((sum, point) => sum + point.bytes, 0),
  };
}

export function aggregateTagDna(scenes: StatsScene[]) {
  const uniqueScenes = uniqueById(scenes),
    tags = new Map<
      string,
      { id: string; name: string; scenes: number; rated: number; ratingSum: number; plays: number }
    >();
  let taggedScenes = 0,
    assignments = 0;
  uniqueScenes.forEach(scene => {
    const sceneTags = new Map<string, string>();
    (scene.tags || []).forEach(tag => {
      const id = String(tag && tag.id != null ? tag.id : "");
      if (id && !sceneTags.has(id)) sceneTags.set(id, String(tag.name || "Tag #" + id).trim() || "Tag #" + id);
    });
    if (sceneTags.size) taggedScenes++;
    const rating = ratingNumber(scene),
      plays = countValue(scene.play_count);
    sceneTags.forEach((name, id) => {
      if (!tags.has(id)) tags.set(id, { id, name, scenes: 0, rated: 0, ratingSum: 0, plays: 0 });
      const entry = tags.get(id)!;
      entry.scenes++;
      entry.plays += plays;
      assignments++;
      if (rating != null) {
        entry.rated++;
        entry.ratingSum += rating;
      }
    });
  });
  const rows = Array.from(tags.values())
    .map(entry => ({
      id: entry.id,
      name: entry.name,
      scenes: entry.scenes,
      rated: entry.rated,
      unrated: entry.scenes - entry.rated,
      rating: entry.rated ? entry.ratingSum / entry.rated : null,
      plays: entry.plays,
      playsPerScene: entry.scenes ? entry.plays / entry.scenes : 0,
    }))
    .sort((a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    rows,
    totalScenes: uniqueScenes.size,
    taggedScenes,
    untaggedScenes: uniqueScenes.size - taggedScenes,
    tags: rows.length,
    assignments,
  };
}

function tagDnaMetricValue(row: TagRow, metric: string) {
  return metric === "play_count" ? row.playsPerScene : row.rating;
}

export function tagDnaMetricLabel(metric: string) {
  return metric === "play_count" ? "Views per scene" : "Average rating";
}

function tagDnaColor(row: TagRow, metric: string, maximum: number) {
  const value = tagDnaMetricValue(row, metric);
  if (value == null || !Number.isFinite(value)) return themeColor("grid");
  let ratio = metric === "play_count" ? (maximum > 0 ? Math.log(1 + value) / Math.log(1 + maximum) : 0) : value / 10;
  ratio = Math.max(0, Math.min(1, ratio));
  const low = statsTheme().tagLow,
    high = statsTheme().tagHigh;
  return "rgb(" + low.map((channel, index) => Math.round(channel + (high[index] - channel) * ratio)).join(",") + ")";
}

function chartLabelColor(background: string) {
  const value = String(background || "");
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  const channels = hex
    ? [1, 3, 5].map(offset => parseInt(hex![1].slice(offset - 1, offset + 1), 16))
    : rgb
      ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      : null;
  if (!channels) return themeColor("text");
  const linear = channels.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.179 ? "#000" : "#fff";
}

export function tagDnaSeriesData(stats: { rows: TagRow[] }, metric: string, maxTags: number, selected: string | null) {
  const limit = Number(maxTags);
  const rows = Number.isFinite(limit) && limit > 0 ? stats.rows.slice(0, limit) : stats.rows.slice();
  const maximum = metric === "play_count" ? Math.max.apply(null, [0].concat(rows.map(row => row.playsPerScene))) : 10;
  return rows.map(row => {
    const fill = tagDnaColor(row, metric, maximum);
    const labelColor = chartLabelColor(fill);
    return {
      id: row.id,
      name: row.name,
      value: row.scenes,
      rating: row.rating,
      rated: row.rated,
      unrated: row.unrated,
      plays: row.plays,
      playsPerScene: row.playsPerScene,
      label: {
        color: labelColor,
        textBorderColor: labelColor === "#fff" ? "rgba(0,0,0,.65)" : "rgba(255,255,255,.65)",
        textBorderWidth: 1,
      },
      itemStyle: {
        color: fill,
        borderColor: row.id === selected ? themeColor("selection") : themeColor("background"),
        borderWidth: row.id === selected ? 4 : 2,
      },
    };
  });
}

export function tagDnaScenes(scenes: StatsScene[], tagId: string | null) {
  const seen = new Set();
  return scenes.filter(scene => {
    const sceneId = String(scene && scene.id != null ? scene.id : "");
    if (!sceneId || seen.has(sceneId)) return false;
    seen.add(sceneId);
    return (
      tagId == null || (scene.tags || []).some(tag => String(tag && tag.id != null ? tag.id : "") === String(tagId))
    );
  });
}

export function birthdayDayLabel(month: number, day: number) {
  return MONTHS[month - 1] + " " + day;
}

export function scatterSeriesData(stats: { points: StatsScatterPoint[] }, selected: string | null) {
  return stats.points.map(point => {
    const active = point.id === selected;
    return {
      id: point.id,
      name: point.name,
      value: [point.rating, point.scenes],
      itemStyle: {
        color: point.highlight ? themeColor("accent") : themeColor("primary"),
        opacity: 0.85,
        borderColor: active ? "#fff" : "transparent",
        borderWidth: active ? 2 : 0,
      },
    };
  });
}

export function nearestScatterOption(options: number[], value: number) {
  let best = options[0];
  for (let index = 1; index < options.length; index += 1) {
    if (Math.abs(options[index] - value) < Math.abs(best - value)) best = options[index];
  }
  return best;
}

export function scatterGuideLines(minRating: number, maxScenes: number) {
  const lines: Array<{ axis: "x" | "y"; value: number; active: boolean }> = [];
  [0, 5, 6, 7, 8, 9].forEach(value => {
    if (value > 0) lines.push({ axis: "x", value, active: value === minRating });
  });
  [0, 5, 10, 20, 50, 100].forEach(value => {
    if (value > 0) lines.push({ axis: "y", value, active: value === maxScenes });
  });
  return lines;
}

export function scatterGuideForClick(rect: { x: number; y: number; width: number; height: number }, pixel: number[]) {
  if (!rect || !pixel) return null;
  // The x-axis is horizontal at the bottom (rating) and the y-axis vertical
  // at the left (scenes); the nearer axis decides which guide to move.
  const distanceToXAxis = rect.y + rect.height - pixel[1];
  const distanceToYAxis = pixel[0] - rect.x;
  return distanceToXAxis <= distanceToYAxis ? "scatterMinRating" : "scatterMaxScenes";
}

export function scatterClickHitsPoint(chart: ChartInstance, points: StatsScatterPoint[], pixel: number[]) {
  for (let index = 0; index < points.length; index += 1) {
    const pointPixel = chart.convertToPixel({ gridIndex: 0 }, [points[index].rating, points[index].scenes]);
    if (!pointPixel) continue;
    if (Math.abs(pointPixel[0] - pixel[0]) <= 7 && Math.abs(pointPixel[1] - pixel[1]) <= 7) return true;
  }
  return false;
}

export function countRatingLabel(metric: string) {
  return metric === "o_counter" ? "O count" : "View count";
}

export function countRatingSeriesData(stats: { points: StatsCountRatingPoint[] }, selected: string | null) {
  return stats.points.map(point => {
    const active = point.id === selected;
    return {
      id: point.id,
      title: point.title,
      value: [point.rating, point.count],
      itemStyle: {
        color: themeColor("primary"),
        opacity: 0.85,
        borderColor: active ? "#fff" : "transparent",
        borderWidth: active ? 2 : 0,
      },
    };
  });
}

export function aggregateCountRating(scenes: StatsScene[], metric: string) {
  const unique = uniqueById(scenes),
    points: StatsCountRatingPoint[] = [];
  let missingRating = 0;
  unique.forEach((scene, id) => {
    const rating = ratingNumber(scene);
    if (rating == null) {
      missingRating++;
      return;
    }
    points.push({
      id,
      title: String(scene.title || "Scene #" + id),
      rating,
      count: countValue(metric === "o_counter" ? scene.o_counter : scene.play_count),
    });
  });
  return { points, total: unique.size, missingRating };
}

export function aggregateRepeatOffenders(scenes: StatsScene[]) {
  const rows: StatsRepeatRow[] = [];
  let totalViews = 0;
  uniqueById(scenes).forEach((scene, id) => {
    const views = countValue(scene.play_count);
    rows.push({
      id,
      title: String(scene.title || "Scene #" + id),
      views,
      rank: 0,
      cumulativeViews: 0,
      sceneShare: 0,
      viewShare: 0,
    });
    totalViews += views;
  });
  rows.sort(
    (left, right) =>
      right.views - left.views || left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
  let cumulativeViews = 0,
    totalScenes = rows.length;
  rows.forEach((row, index) => {
    cumulativeViews += row.views;
    row.rank = index + 1;
    row.sceneShare = totalScenes ? (row.rank * 100) / totalScenes : 0;
    row.cumulativeViews = cumulativeViews;
    row.viewShare = totalViews ? (cumulativeViews * 100) / totalViews : 0;
  });
  const topCount = totalScenes ? Math.max(1, Math.ceil(totalScenes * 0.05)) : 0;
  const topViews = rows.slice(0, topCount).reduce((sum, row) => sum + row.views, 0);
  return {
    rows,
    totalScenes,
    viewedScenes: rows.filter(row => row.views > 0).length,
    totalViews,
    topCount,
    topViews,
    topShare: totalViews ? (topViews * 100) / totalViews : 0,
  };
}

export function repeatOffenderSeriesData(stats: { rows: StatsRepeatRow[] }, selected: string | null) {
  return [{ value: [0, 0], rank: 0, views: 0, cumulativeViews: 0 }].concat(
    stats.rows.map(row => ({
      id: row.id,
      title: row.title,
      rank: row.rank,
      views: row.views,
      cumulativeViews: row.cumulativeViews,
      value: [row.sceneShare, row.viewShare],
      symbolSize: row.id === selected ? 10 : 5,
      itemStyle: {
        color: row.id === selected ? themeColor("accent") : themeColor("primary"),
        borderColor: row.id === selected ? "#fff" : "transparent",
        borderWidth: row.id === selected ? 2 : 0,
      },
    })),
  );
}

export function repeatOffenderRowAtShare(stats: { rows: StatsRepeatRow[] }, share: number) {
  if (!stats || !stats.rows || !stats.rows.length || !Number.isFinite(Number(share))) return null;
  const index = Math.round((Math.max(0, Math.min(100, Number(share))) * stats.rows.length) / 100) - 1;
  return stats.rows[Math.max(0, Math.min(stats.rows.length - 1, index))];
}

export function aggregateQualityEfficiency(scenes: StatsScene[]) {
  const unique = uniqueById(scenes),
    points: StatsQualityPoint[] = [];
  let missingRating = 0,
    missingFileData = 0;
  unique.forEach((scene, id) => {
    const rating = ratingNumber(scene);
    if (rating == null) {
      missingRating++;
      return;
    }
    let fileIds = new Set(),
      bytes = 0,
      duration = 0,
      usableFiles = 0;
    (scene.files || []).forEach(file => {
      const fileId = file && file.id != null ? String(file.id) : "";
      if (fileId && fileIds.has(fileId)) return;
      if (fileId) fileIds.add(fileId);
      const size = Number(file && file.size),
        seconds = Number(file && file.duration);
      if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(seconds) || seconds <= 0) return;
      bytes += size;
      duration += seconds;
      usableFiles++;
    });
    if (!usableFiles || !(bytes > 0) || !(duration > 0)) {
      missingFileData++;
      return;
    }
    points.push({
      id,
      title: String(scene.title || "Scene #" + id),
      rating,
      efficiency: duration / 60 / (bytes / Math.pow(1024, 3)),
      bytes,
      duration,
    });
  });
  points.sort(
    (left, right) =>
      left.efficiency - right.efficiency || left.rating - right.rating || left.title.localeCompare(right.title),
  );
  return { points, total: unique.size, missingRating, missingFileData };
}

export function qualityEfficiencySeriesData(stats: { points: StatsQualityPoint[] }) {
  const maxBytes = stats.points.reduce((maximum, point) => Math.max(maximum, point.bytes), 0);
  return stats.points.map(point => ({
    id: point.id,
    title: point.title,
    bytes: point.bytes,
    duration: point.duration,
    value: [point.efficiency, point.rating],
    symbolSize: qualityEfficiencySymbolSize(point.bytes, maxBytes),
    itemStyle: { color: themeColor("primary"), opacity: 0.72 },
  }));
}

export function qualityEfficiencySymbolSize(bytes: number, maxBytes: number) {
  if (!(bytes > 0) || !(maxBytes > 0)) return 6;
  return Math.max(6, 36 * Math.sqrt(bytes / maxBytes));
}
let countryLookup: Record<string, string> | null = null;
/** The country index of the loaded world map; empty until the map has loaded. */
export function countries() {
  if (!world) return {};
  return (countryLookup ||= countryIndex(world.features));
}
