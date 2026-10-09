import type { StatsFilter } from "../runtime";
import type { Settings } from "../settings";
import type { ChartInstance, ChartOption, ConstellationSelection, StatsCountRatingPoint, StatsPerformer, StatsQualityPoint, StatsRepeatRow, StatsScatterPoint, StatsScene, StatsStudioPoint, TagRow, WorldData, WorldFeature } from "../types";
export function createAnalytics(dependencies: Pick<Settings, "themeColor" | "statsTheme"> & { world: WorldData }) {
  const { themeColor, statsTheme, world } = dependencies;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var eckertIV = {
    project: function (point: number[]) {
      var radians = Math.PI / 180, lambda = point[0] * radians;
      var phi = Math.max(-90, Math.min(90, point[1])) * radians;
      var theta = phi / 2, target = (2 + Math.PI / 2) * Math.sin(phi);
      if (Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-10) theta = phi;
      else for (var i = 0;i < 30;i++) {
        var sin = Math.sin(theta), cos = Math.cos(theta);
        var delta = (theta + sin * cos + 2 * sin - target) / (2 * cos * (1 + cos));
        theta -= delta;
        if (Math.abs(delta) < 1e-12) break;
      }
      return [2 * lambda * (1 + Math.cos(theta)) / Math.sqrt(Math.PI * (4 + Math.PI)), -2 * Math.sqrt(Math.PI / (4 + Math.PI)) * Math.sin(theta)];
    },
    unproject: function (point: number[]) {
      var theta = Math.asin(Math.max(-1, Math.min(1, -point[1] / (2 * Math.sqrt(Math.PI / (4 + Math.PI))))));
      var sin = Math.sin(theta), cos = Math.cos(theta);
      var phi = Math.asin(Math.max(-1, Math.min(1, (theta + sin * cos + 2 * sin) / (2 + Math.PI / 2))));
      var lambda = point[0] * Math.sqrt(Math.PI * (4 + Math.PI)) / (2 * (1 + cos));
      return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
    }
  };
  var constellationGenderStyles: Record<string, { label: string; color: string }> = {
    FEMALE: { label: "Female", color: "#f29aaa" },
    MALE: { label: "Male", color: "#8eb8f5" },
    TRANSGENDER_FEMALE: { label: "Transgender female", color: "#d9a6e8" },
    TRANSGENDER_MALE: { label: "Transgender male", color: "#8fd5dd" },
    NON_BINARY: { label: "Non-binary", color: "#f4df86" },
    INTERSEX: { label: "Intersex", color: "#b9a2e8" },
    UNKNOWN: { label: "Unknown", color: "#aeb8c2" }
  };
  let disposed = false; const pendingImages = new Set<() => void>();
  var studioImagePromises: Record<string, Promise<HTMLImageElement | null>> = Object.create(null);
  var studioImages: Record<string, HTMLImageElement> = Object.create(null);
  var studioLogoSymbols: Record<string, string> = Object.create(null);
  function normalize(value: unknown) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function countryIndex(features: WorldFeature[]) {
    var index: Record<string, string> = Object.create(null);
    var display = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
    features.forEach(function (feature) {
      var p = feature.properties;
      [p.name, p.iso2, p.iso3].concat(p.aliases || []).forEach(function (name) {
        if (name && name !== "-99") index[normalize(name)] = p.name;
      });
      if (display && /^[A-Z]{2}$/.test(p.iso2)) index[normalize(display.of(p.iso2))] = p.name;
    });
    var aliases: Record<string, string> = { USA: "United States of America", US: "United States of America", "United States": "United States of America", UK: "United Kingdom", "Great Britain": "United Kingdom", "Czech Republic": "Czechia", "Russian Federation": "Russia", "South Korea": "South Korea", "Republic of Korea": "South Korea", "North Korea": "North Korea", "Ivory Coast": "Ivory Coast", "Cote d'Ivoire": "Ivory Coast", "Democratic Republic of the Congo": "Democratic Republic of the Congo", "DR Congo": "Democratic Republic of the Congo", "Republic of the Congo": "Republic of the Congo" };
    Object.keys(aliases).forEach(function (name) {
      var target = index[normalize(aliases[name])];
      if (target) index[normalize(name)] = target;
    });
    return index;
  }

  function countryPlaceholder(value: unknown) {
    var text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    if (text === "unknown" || text === "none" || text === "?") return true;
    if (/^[-\u2013\u2014]+$/.test(text)) return true;
    // Only a bare 2-3 letter code may stand in for an ISO code: "N/A" and its
    // punctuation variants must not collapse into Namibia's "NA".
    return normalize(text) === "na" && text !== "na";
  }

  function countryName(value: unknown, index: Record<string, string>) {
    var text = String(value || "").trim();
    if (!text || countryPlaceholder(text)) return null;
    return index[normalize(text)] || null;
  }

  function aggregate(performers: StatsPerformer[], index: Record<string, string>) {
    var counts: Record<string, number> = Object.create(null);
    var missing = 0;
    performers.forEach(function (p) {
      var country = countryName(p.country, index);
      if (!country) { missing++; return; }
      counts[country] = (counts[country] || 0) + 1;
    });
    return { rows: Object.keys(counts).map(function (name) { return { name: name, value: counts[name] }; }).sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); }), missing: missing, total: performers.length };
  }

  function filterAgeScenes(scenes: StatsScene[], ids: Array<string | number> | null) {
    if (ids == null) return scenes;
    var allowed = new Set(ids.map(String));
    return scenes.map(function (scene) { return Object.assign({}, scene, { performers: (scene.performers || []).filter(function (performer) { return allowed.has(String(performer.id)); }) }); });
  }

  function sceneVariables(filter: StatsFilter, page: number) {
    return { filter: Object.assign({}, filter.makeFindFilter(), { page: page, per_page: 500 }), sceneFilter: filter.makeFilter() };
  }

  function mapLayout(node: Pick<HTMLElement, "clientWidth" | "clientHeight"> | null, showLegend: boolean) {
    var width = Math.max(1, node!.clientWidth - 8);
    var height = Math.max(1, node!.clientHeight - (showLegend ? 30 : 8));
    return { layoutCenter: ["50%", height / 2 + 4], layoutSize: Math.min(width, height * 2) };
  }

  function originMapOption(stats: { rows: Array<{ name: string; value: number }> }, features: WorldFeature[], options: ChartOption) {
    var counts = new Map(stats.rows.map(function (row) { return [row.name, row.value]; }));
    var maximum = stats.rows.reduce(function (max, row) { return Math.max(max, row.value); }, 1);
    // Compress large outliers for colour only; labels and tooltips retain counts.
    var primary = /^#([0-9a-f]{6})$/i.exec(themeColor("primary"));
    var channels = primary ? [0, 2, 4].map(function (offset) { return parseInt(primary![1].slice(offset, offset + 2), 16); }) : [84, 213, 202];
    var colors = [[.3, 0], [.7, .1], [.45, .55]].map(function (shade) {
      return "rgb(" + channels.map(function (channel) { return Math.round(channel * shade[0] + 255 * shade[1]); }).join(",") + ")";
    });
    function countLabel(p: import("../types").ChartEvent) { return p.data && p.data.count > 0 ? String(p.data.count) : ""; }
    return {
      backgroundColor: options.backgroundColor || "transparent",
      tooltip: { trigger: "item", renderMode: "richText", formatter: function (p: import("../types").ChartEvent) { return p.name + ": " + (p.data ? p.data.count : 0) + " performers"; } },
      visualMap: { show: options.showLegend, min: 0, max: Math.log(1 + maximum), left: 8, bottom: 4, calculable: false, orient: "horizontal", itemWidth: 8, itemHeight: 70, textGap: 5, padding: 0, text: [String(maximum), "0"], formatter: function (value: number) { return String(Math.round(Math.exp(value) - 1)); }, textStyle: { color: themeColor("text"), fontSize: 10 }, inRange: { color: colors } },
      series: [{
        type: "map", map: options.map, projection: eckertIV, roam: options.roam, selectedMode: options.selectable ? "single" : false,
        select: { label: { color: "#fff" }, itemStyle: { areaColor: themeColor("highlight") } }, scaleLimit: { min: 1, max: 12 },
        label: { show: options.showNumbers, color: "#fff", textBorderColor: "#000", textBorderWidth: 2, fontSize: 10, formatter: countLabel },
        itemStyle: { borderColor: themeColor("border"), borderWidth: .5 }, emphasis: { label: { show: options.showNumbers, formatter: countLabel }, itemStyle: { areaColor: themeColor("highlight") } },
        data: features.map(function (feature) {
          var name = feature.properties.name, count = counts.get(name) || 0;
          // Null bypasses ECharts' continuous scale; zero stays a neutral fill.
          return { name: name, count: count, value: count ? Math.log(1 + count) : null, selected: options.selectedCountry === name, itemStyle: count ? undefined : { areaColor: themeColor("grid") } };
        })
      }]
    };
  }

  function performerVariables(filter: StatsFilter, page: number) {
    return { filter: Object.assign({}, filter.makeFindFilter(), { page: page, per_page: 500 }), performerFilter: filter.makeFilter() };
  }

  function orderedCards(cards: Array<StatsScene & StatsPerformer>, ids: Array<string | number>) {
    // Compare as strings: Stash serializes IDs as strings, and numeric coercion
    // would map every non-numeric ID to NaN and collapse them onto one key.
    var byId = new Map(cards.map(function (card) { return [String(card.id), card]; }));
    return ids.map(function (id) { return byId.get(String(id)); }).filter((card): card is StatsScene & StatsPerformer => Boolean(card));
  }

  function countryPerformers(performers: StatsPerformer[], country: string) {
    return country ? performers.filter(function (p) { return countryName(p.country, countries) === country; }) : performers;
  }

  function constellationGender(value: unknown) {
    var key = String(value || "UNKNOWN").trim().toUpperCase().replace(/[ -]+/g, "_") || "UNKNOWN";
    if (constellationGenderStyles[key]) return Object.assign({ key: key }, constellationGenderStyles[key]);
    var hash = 0;
    for (var i = 0;i < key.length;i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return { key: key, label: key.toLowerCase().replace(/_/g, " ").replace(/(^|\s)\S/g, function (letter) { return letter.toUpperCase(); }), color: "hsl(" + (hash % 360) + ", 55%, 72%)" };
  }

  function constellationLayout(count: number) {
    if (count > 500) return { symbolMin: 6, symbolRange: 24, labelLimit: 8, repulsion: [280, 1200], edgeLength: [85, 250], gravity: .018, zoom: .52, edgeOpacity: .1 };
    if (count > 200) return { symbolMin: 8, symbolRange: 28, labelLimit: 10, repulsion: [240, 980], edgeLength: [78, 225], gravity: .024, zoom: .62, edgeOpacity: .13 };
    if (count > 80) return { symbolMin: 10, symbolRange: 32, labelLimit: 12, repulsion: [190, 760], edgeLength: [70, 205], gravity: .032, zoom: .76, edgeOpacity: .18 };
    return { symbolMin: 13, symbolRange: 35, labelLimit: 15, repulsion: [150, 620], edgeLength: [65, 185], gravity: .04, zoom: .9, edgeOpacity: .24 };
  }

  function aggregateConstellation(scenes: StatsScene[], maxPerformers: number, minShared: number) {
    var uniqueScenes = new Map<string, StatsScene>(), performers = new Map<string, import("../types").StatsConstellationNode>();
    scenes.forEach(function (scene) { if (!uniqueScenes.has(String(scene.id))) uniqueScenes.set(String(scene.id), scene); });
    uniqueScenes.forEach(function (scene) {
      var seen = new Set();
      (scene.performers || []).forEach(function (performer) {
        var id = String(performer.id == null ? "" : performer.id);
        if (!id || seen.has(id)) return;
        seen.add(id);
        var gender = constellationGender(performer.gender);
        if (!performers.has(id)) performers.set(id, { id: id, name: String(performer.name || "Performer #" + id), gender: gender.key, genderLabel: gender.label, genderColor: gender.color, value: 0, collaborators: 0 });
        var saved = performers.get(id)!;
        if (saved.gender === "UNKNOWN" && gender.key !== "UNKNOWN") { saved.gender = gender.key; saved.genderLabel = gender.label; saved.genderColor = gender.color; }
        saved.value++;
      });
    });
    var ranked = Array.from(performers.values()).sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });
    var requestedLimit = Number(maxPerformers);
    var limit = requestedLimit === 0 ? ranked.length : Math.max(1, requestedLimit || 100), nodes = ranked.slice(0, limit), visible = new Set(nodes.map(function (node) { return node.id; })), pairs = new Map<string, import("../types").StatsConstellationLink & { id: string; sceneIds: string[] }>();
    uniqueScenes.forEach(function (scene) {
      var scenePerformers = new Map<string, string>();
      (scene.performers || []).forEach(function (performer) {
        var id = String(performer.id == null ? "" : performer.id);
        if (id && visible.has(id) && !scenePerformers.has(id)) scenePerformers.set(id, String(performer.name || performers.get(id)!.name));
      });
      var ids = Array.from(scenePerformers.keys()).sort();
      for (var i = 0;i < ids.length;i++) for (var j = i + 1;j < ids.length;j++) {
        var key = ids[i] + "\u0000" + ids[j];
        if (!pairs.has(key)) pairs.set(key, { id: key, source: ids[i], target: ids[j], sourceName: scenePerformers.get(ids[i])!, targetName: scenePerformers.get(ids[j])!, value: 0, sceneIds: [] });
        var pair = pairs.get(key)!; pair.value++; pair.sceneIds.push(String(scene.id));
      }
    });
    var threshold = Math.max(1, Number(minShared) || 1);
    var links = Array.from(pairs.values()).filter(function (link) { return link.value >= threshold; }).sort(function (a, b) { return b.value - a.value || a.sourceName.localeCompare(b.sourceName) || a.targetName.localeCompare(b.targetName); });
    var collaborators = new Map<string, Set<string>>();
    links.forEach(function (link) {
      if (!collaborators.has(link.source)) collaborators.set(link.source, new Set());
      if (!collaborators.has(link.target)) collaborators.set(link.target, new Set());
      collaborators.get(link.source)!.add(link.target); collaborators.get(link.target)!.add(link.source);
    });
    nodes = nodes.map(function (node) { return Object.assign({}, node, { collaborators: collaborators.has(node.id) ? collaborators.get(node.id)!.size : 0 }); });
    return { nodes: nodes, links: links, totalScenes: uniqueScenes.size, totalPerformers: performers.size };
  }

  function constellationScenes(scenes: StatsScene[], selection: ConstellationSelection | null) {
    var seen = new Set(), ids = selection ? new Set(selection.ids.map(String)) : null;
    return scenes.filter(function (scene) {
      var sceneId = String(scene.id);
      if (seen.has(sceneId)) return false;
      seen.add(sceneId);
      if (!ids) return true;
      var present = new Set((scene.performers || []).map(function (performer) { return String(performer.id); }));
      return Array.from(ids).every(function (id) { return present.has(id); });
    });
  }

  function ratingNumber(scene: Pick<StatsScene, "rating100">) {
    var rating = scene.rating100 == null || scene.rating100 === "" ? NaN : Number(scene.rating100);
    return Number.isFinite(rating) && rating >= 0 && rating <= 100 ? rating / 10 : null;
  }

  function roundRating(value: number, step: number = 0) {
    if (!step) return value;
    return Math.min(10, Math.max(0, Math.round(value / step) * step));
  }

  function sceneRating(scene: Pick<StatsScene, "rating100">, step: number) {
    var rating = ratingNumber(scene);
    return rating == null ? "Unrated" : String(roundRating(rating, step));
  }

  function aggregateRatings(scenes: Array<Pick<StatsScene, "id" | "rating100">>, step: number) {
    var counts = new Map(), seen = new Set();
    scenes.forEach(function (scene) {
      if (seen.has(scene.id)) return;
      seen.add(scene.id);
      var rating = sceneRating(scene, step);
      counts.set(rating, (counts.get(rating) || 0) + 1);
    });
    return { total: seen.size, rows: Array.from(counts, function (item) { return { name: item[0], value: item[1] }; }).sort(function (a, b) { return a.name === "Unrated" ? 1 : b.name === "Unrated" ? -1 : Number(a.name) - Number(b.name); }) };
  }

  function scatterBound(value: unknown) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function aggregateScatter(performers: StatsPerformer[], minRating: number, maxScenes: number) {
    var floor = scatterBound(minRating), ceiling = scatterBound(maxScenes);
    var hasBounds = floor != null || ceiling != null;
    var seen = new Set(), points: StatsScatterPoint[] = [], missingRating = 0, missingScenes = 0;
    performers.forEach(function (performer) {
      var id = String(performer.id == null ? "" : performer.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      var rating = ratingNumber(performer);
      var scenes = performer.scene_count == null || performer.scene_count === "" ? NaN : Number(performer.scene_count);
      if (rating == null) { missingRating++; return; }
      if (!Number.isFinite(scenes) || scenes < 0) { missingScenes++; return; }
      var highlight = hasBounds && (floor == null || rating >= floor) && (ceiling == null || scenes <= ceiling);
      points.push({ id: id, name: String(performer.name || "Performer #" + id), rating: rating, scenes: scenes, highlight: highlight });
    });
    return { points: points, total: seen.size, missingRating: missingRating, missingScenes: missingScenes, highlights: points.filter(function (point) { return point.highlight; }).length };
  }

  function studioSymbolSize(bytes: number, maxBytes: number) {
    if (!(maxBytes > 0) || !(bytes > 0)) return 10;
    return 10 + 34 * Math.sqrt(bytes / maxBytes);
  }

  function studioImageSource(studio: StatsScene["studio"]) {
    var path = studio && studio.image_path ? String(studio.image_path).trim() : "";
    if (path) return path;
    return studio && studio.id != null && studio.id !== "" ? "/studio/" + encodeURIComponent(studio.id) + "/image" : "";
  }

  function loadStudioImage(path: string) {
    if (!path || disposed) return Promise.resolve(null);
    if (!studioImagePromises[path]) {
      studioImagePromises[path] = new Promise<HTMLImageElement | null>(function (resolve) {
        var image = new Image();
        const release = () => { image.onload = null; image.onerror = null; pendingImages.delete(cancel) };
        const cancel = () => { release(); image.src = ""; resolve(null) }; pendingImages.add(cancel);
        image.onload = function () { if (!disposed) studioImages[path] = image; release(); resolve(image); };
        image.onerror = function () { release(); resolve(null); };
        image.src = path;
      });
    }
    return studioImagePromises[path];
  }

  function renderStudioLogo(image: HTMLImageElement, active: boolean) {
    var size = 96, radius = size / 2 - 3, sourceWidth = image.naturalWidth || image.width, sourceHeight = image.naturalHeight || image.height;
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) return "";
    var canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    var context = canvas.getContext("2d");
    if (!context) return "";
    context.save();
    context.beginPath();
    context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    context.closePath();
    context.clip();
    var scale = Math.max(size / sourceWidth, size / sourceHeight);
    var width = sourceWidth * scale, height = sourceHeight * scale;
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
    var key = path + (active ? "|active" : "");
    if (studioLogoSymbols[key] == null) {
      try { studioLogoSymbols[key] = renderStudioLogo(studioImages[path], active) || ""; }
      catch (err) { studioLogoSymbols[key] = ""; }
    }
    return studioLogoSymbols[key];
  }

  function studioSeriesData(points: StatsStudioPoint[], maxBytes: number, selected: string | null) {
    return points.map(function (point) {
      var active = point.id === selected, logo = studioLogoSymbol(point.image, active);
      var item: ChartOption = { id: point.id, name: point.name, bytes: point.bytes, unrated: point.unrated, value: [point.scenes, Math.round(point.rating! * 10) / 10], symbolSize: studioSymbolSize(point.bytes, maxBytes) };
      if (logo) item.symbol = "image://" + logo;
      else item.itemStyle = { color: themeColor("primary"), opacity: .8, borderColor: active ? "#fff" : "transparent", borderWidth: active ? 2 : 0 };
      return item;
    });
  }

  function aggregateStudios(scenes: StatsScene[]) {
    var seen = new Set(), studios = new Map<string, { id: string; name: string; image: string; scenes: number; rated: number; ratingSum: number; bytes: number }>(), missingStudio = 0, missingSizes = 0;
    scenes.forEach(function (scene) {
      if (seen.has(scene.id)) return;
      seen.add(scene.id);
      if (!scene.studio || scene.studio.id == null || !String(scene.studio.name || "").trim()) { missingStudio++; return; }
      var id = String(scene.studio.id);
      if (!studios.has(id)) studios.set(id, { id: id, name: String(scene.studio.name), image: studioImageSource(scene.studio), scenes: 0, rated: 0, ratingSum: 0, bytes: 0 });
      var entry = studios.get(id)!;
      entry.scenes++;
      var rating = ratingNumber(scene);
      if (rating != null) { entry.rated++; entry.ratingSum += rating; }
      var files = new Set();
      (scene.files || []).forEach(function (file) {
        if (file.id != null) { if (files.has(file.id)) return; files.add(file.id); }
        var size = file.size == null || file.size === "" ? NaN : Number(file.size);
        if (!Number.isFinite(size) || size < 0) { missingSizes++; return; }
        entry.bytes += size;
      });
    });
    var points = Array.from(studios.values()).map(function (entry) {
      return { id: entry.id, name: entry.name, image: entry.image, scenes: entry.scenes, rated: entry.rated, unrated: entry.scenes - entry.rated, rating: entry.rated ? entry.ratingSum / entry.rated : null, bytes: entry.bytes };
    }).sort(function (a, b) { return b.scenes - a.scenes || a.name.localeCompare(b.name); });
    return { points: points, total: seen.size, studios: points.length, missingStudio: missingStudio, missingSizes: missingSizes, totalBytes: points.reduce(function (sum, point) { return sum + point.bytes; }, 0) };
  }

  function aggregateTagDna(scenes: StatsScene[]) {
    var uniqueScenes = new Map<string, StatsScene>(), tags = new Map<string, { id: string; name: string; scenes: number; rated: number; ratingSum: number; plays: number; sceneIds: string[] }>(), taggedScenes = 0, assignments = 0;
    scenes.forEach(function (scene) {
      var sceneId = String(scene && scene.id != null ? scene.id : "");
      if (sceneId && !uniqueScenes.has(sceneId)) uniqueScenes.set(sceneId, scene);
    });
    uniqueScenes.forEach(function (scene, sceneId) {
      var sceneTags = new Map<string, string>();
      (scene.tags || []).forEach(function (tag) {
        var id = String(tag && tag.id != null ? tag.id : "");
        if (id && !sceneTags.has(id)) sceneTags.set(id, String(tag.name || "Tag #" + id).trim() || "Tag #" + id);
      });
      if (sceneTags.size) taggedScenes++;
      var rating = ratingNumber(scene);
      var plays = Number(scene.play_count);
      if (!Number.isFinite(plays) || plays < 0) plays = 0;
      sceneTags.forEach(function (name, id) {
        if (!tags.has(id)) tags.set(id, { id: id, name: name, scenes: 0, rated: 0, ratingSum: 0, plays: 0, sceneIds: [] });
        var entry = tags.get(id)!;
        entry.scenes++; entry.plays += plays; entry.sceneIds.push(sceneId); assignments++;
        if (rating != null) { entry.rated++; entry.ratingSum += rating; }
      });
    });
    var rows = Array.from(tags.values()).map(function (entry) {
      return { id: entry.id, name: entry.name, scenes: entry.scenes, rated: entry.rated, unrated: entry.scenes - entry.rated, rating: entry.rated ? entry.ratingSum / entry.rated : null, plays: entry.plays, playsPerScene: entry.scenes ? entry.plays / entry.scenes : 0, sceneIds: entry.sceneIds };
    }).sort(function (a, b) { return b.scenes - a.scenes || a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });
    return { rows: rows, totalScenes: uniqueScenes.size, taggedScenes: taggedScenes, untaggedScenes: uniqueScenes.size - taggedScenes, tags: rows.length, assignments: assignments };
  }

  function tagDnaMetricValue(row: TagRow, metric: string) {
    return metric === "play_count" ? row.playsPerScene : row.rating;
  }

  function tagDnaMetricLabel(metric: string) {
    return metric === "play_count" ? "Views per scene" : "Average rating";
  }

  function tagDnaColor(row: TagRow, metric: string, maximum: number) {
    var value = tagDnaMetricValue(row, metric);
    if (value == null || !Number.isFinite(value)) return themeColor("grid");
    var ratio = metric === "play_count" ? (maximum > 0 ? Math.log(1 + value) / Math.log(1 + maximum) : 0) : value / 10;
    ratio = Math.max(0, Math.min(1, ratio));
    var low = statsTheme().tagLow, high = statsTheme().tagHigh;
    return "rgb(" + low.map(function (channel, index) { return Math.round(channel + (high[index] - channel) * ratio); }).join(",") + ")";
  }

  function chartLabelColor(background: string) {
    var value = String(background || "");
    var hex = /^#([0-9a-f]{6})$/i.exec(value);
    var rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
    var channels = hex ? [1, 3, 5].map(function (offset) { return parseInt(hex![1].slice(offset - 1, offset + 1), 16); }) :
      rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
    if (!channels) return themeColor("text");
    var linear = channels.map(function (channel) {
      var normalized = channel / 255;
      return normalized <= .04045 ? normalized / 12.92 : Math.pow((normalized + .055) / 1.055, 2.4);
    });
    var luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    return luminance > .179 ? "#000" : "#fff";
  }

  function tagDnaSeriesData(stats: { rows: TagRow[] }, metric: string, maxTags: number, selected: string | null) {
    var limit = Number(maxTags);
    var rows = Number.isFinite(limit) && limit > 0 ? stats.rows.slice(0, limit) : stats.rows.slice();
    var maximum = metric === "play_count" ? Math.max.apply(null, [0].concat(rows.map(function (row) { return row.playsPerScene; }))) : 10;
    return rows.map(function (row) {
      var fill = tagDnaColor(row, metric, maximum);
      var labelColor = chartLabelColor(fill);
      return {
        id: row.id, name: row.name, value: row.scenes, rating: row.rating, rated: row.rated, unrated: row.unrated, plays: row.plays, playsPerScene: row.playsPerScene, sceneIds: row.sceneIds,
        label: { color: labelColor, textBorderColor: labelColor === "#fff" ? "rgba(0,0,0,.65)" : "rgba(255,255,255,.65)", textBorderWidth: 1 },
        itemStyle: { color: fill, borderColor: row.id === selected ? themeColor("selection") : themeColor("background"), borderWidth: row.id === selected ? 4 : 2 }
      };
    });
  }

  function tagDnaScenes(scenes: StatsScene[], tagId: string | null) {
    var seen = new Set();
    return scenes.filter(function (scene) {
      var sceneId = String(scene && scene.id != null ? scene.id : "");
      if (!sceneId || seen.has(sceneId)) return false;
      seen.add(sceneId);
      return tagId == null || (scene.tags || []).some(function (tag) { return String(tag && tag.id != null ? tag.id : "") === String(tagId); });
    });
  }

  function birthdayDayLabel(month: number, day: number) {
    return MONTHS[month - 1] + " " + day;
  }

  function scatterSeriesData(stats: { points: StatsScatterPoint[] }, selected: string | null) {
    return stats.points.map(function (point) {
      var active = point.id === selected;
      return { id: point.id, name: point.name, value: [point.rating, point.scenes], itemStyle: { color: point.highlight ? themeColor("accent") : themeColor("primary"), opacity: .85, borderColor: active ? "#fff" : "transparent", borderWidth: active ? 2 : 0 } };
    });
  }

  function nearestScatterOption(options: number[], value: number) {
    var best = options[0];
    for (var index = 1;index < options.length;index += 1) {
      if (Math.abs(options[index] - value) < Math.abs(best - value)) best = options[index];
    }
    return best;
  }

  function scatterGuideLines(minRating: number, maxScenes: number) {
    var lines: Array<{ axis: "x" | "y"; value: number; active: boolean }> = [];
    [0, 5, 6, 7, 8, 9].forEach(function (value) {
      if (value > 0) lines.push({ axis: "x", value: value, active: value === minRating });
    });
    [0, 5, 10, 20, 50, 100].forEach(function (value) {
      if (value > 0) lines.push({ axis: "y", value: value, active: value === maxScenes });
    });
    return lines;
  }

  function scatterGuideForClick(rect: { x: number; y: number; width: number; height: number }, pixel: number[]) {
    if (!rect || !pixel) return null;
    // The x-axis is horizontal at the bottom (rating) and the y-axis vertical
    // at the left (scenes); the nearer axis decides which guide to move.
    var distanceToXAxis = rect.y + rect.height - pixel[1];
    var distanceToYAxis = pixel[0] - rect.x;
    return distanceToXAxis <= distanceToYAxis ? "scatterMinRating" : "scatterMaxScenes";
  }

  function scatterClickHitsPoint(chart: ChartInstance, points: StatsScatterPoint[], pixel: number[]) {
    for (var index = 0;index < points.length;index += 1) {
      var pointPixel = chart.convertToPixel({ gridIndex: 0 }, [points[index].rating, points[index].scenes]);
      if (!pointPixel) continue;
      if (Math.abs(pointPixel[0] - pixel[0]) <= 7 && Math.abs(pointPixel[1] - pixel[1]) <= 7) return true;
    }
    return false;
  }

  function countRatingLabel(metric: string) {
    return metric === "o_counter" ? "O count" : "View count";
  }

  function countRatingSeriesData(stats: { points: StatsCountRatingPoint[] }, selected: string | null) {
    return stats.points.map(function (point) {
      var active = point.id === selected;
      return { id: point.id, title: point.title, value: [point.rating, point.count], itemStyle: { color: themeColor("primary"), opacity: .85, borderColor: active ? "#fff" : "transparent", borderWidth: active ? 2 : 0 } };
    });
  }

  function aggregateCountRating(scenes: StatsScene[], metric: string) {
    var seen = new Set(), points: StatsCountRatingPoint[] = [], missingRating = 0;
    scenes.forEach(function (scene) {
      var id = String(scene.id == null ? "" : scene.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      var rating = ratingNumber(scene);
      if (rating == null) { missingRating++; return; }
      var raw = metric === "o_counter" ? scene.o_counter : scene.play_count;
      var count = Number(raw);
      if (!Number.isFinite(count) || count < 0) count = 0;
      points.push({ id: id, title: String(scene.title || "Scene #" + id), rating: rating, count: count });
    });
    return { points: points, total: seen.size, missingRating: missingRating };
  }

  function aggregateRepeatOffenders(scenes: StatsScene[]) {
    var seen = new Set(), rows: StatsRepeatRow[] = [], totalViews = 0;
    scenes.forEach(function (scene) {
      var id = String(scene && scene.id != null ? scene.id : "");
      if (!id || seen.has(id)) return;
      seen.add(id);
      var views = Number(scene.play_count);
      if (!Number.isFinite(views) || views < 0) views = 0;
      rows.push({ id: id, title: String(scene.title || "Scene #" + id), views: views, rank: 0, cumulativeViews: 0, sceneShare: 0, viewShare: 0 });
      totalViews += views;
    });
    rows.sort(function (left, right) { return right.views - left.views || left.title.localeCompare(right.title) || left.id.localeCompare(right.id); });
    var cumulativeViews = 0, totalScenes = rows.length;
    rows.forEach(function (row, index) {
      cumulativeViews += row.views;
      row.rank = index + 1;
      row.sceneShare = totalScenes ? row.rank * 100 / totalScenes : 0;
      row.cumulativeViews = cumulativeViews;
      row.viewShare = totalViews ? cumulativeViews * 100 / totalViews : 0;
    });
    var topCount = totalScenes ? Math.max(1, Math.ceil(totalScenes * .05)) : 0;
    var topViews = rows.slice(0, topCount).reduce(function (sum, row) { return sum + row.views; }, 0);
    return { rows: rows, totalScenes: totalScenes, viewedScenes: rows.filter(function (row) { return row.views > 0; }).length, totalViews: totalViews, topCount: topCount, topViews: topViews, topShare: totalViews ? topViews * 100 / totalViews : 0 };
  }

  function repeatOffenderSeriesData(stats: { rows: StatsRepeatRow[] }, selected: string | null) {
    return [{ value: [0, 0], rank: 0, views: 0, cumulativeViews: 0 }].concat(stats.rows.map(function (row) {
      return { id: row.id, title: row.title, rank: row.rank, views: row.views, cumulativeViews: row.cumulativeViews, value: [row.sceneShare, row.viewShare], symbolSize: row.id === selected ? 10 : 5, itemStyle: { color: row.id === selected ? themeColor("accent") : themeColor("primary"), borderColor: row.id === selected ? "#fff" : "transparent", borderWidth: row.id === selected ? 2 : 0 } };
    }));
  }

  function repeatOffenderRowAtShare(stats: { rows: StatsRepeatRow[] }, share: number) {
    if (!stats || !stats.rows || !stats.rows.length || !Number.isFinite(Number(share))) return null;
    var index = Math.round(Math.max(0, Math.min(100, Number(share))) * stats.rows.length / 100) - 1;
    return stats.rows[Math.max(0, Math.min(stats.rows.length - 1, index))];
  }

  function aggregateQualityEfficiency(scenes: StatsScene[]) {
    var seen = new Set(), points: StatsQualityPoint[] = [], missingRating = 0, missingFileData = 0;
    scenes.forEach(function (scene) {
      var id = String(scene && scene.id != null ? scene.id : "");
      if (!id || seen.has(id)) return;
      seen.add(id);
      var rating = ratingNumber(scene);
      if (rating == null) { missingRating++; return; }
      var fileIds = new Set(), bytes = 0, duration = 0, usableFiles = 0;
      (scene.files || []).forEach(function (file) {
        var fileId = file && file.id != null ? String(file.id) : "";
        if (fileId && fileIds.has(fileId)) return;
        if (fileId) fileIds.add(fileId);
        var size = Number(file && file.size), seconds = Number(file && file.duration);
        if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(seconds) || seconds <= 0) return;
        bytes += size; duration += seconds; usableFiles++;
      });
      if (!usableFiles || !(bytes > 0) || !(duration > 0)) { missingFileData++; return; }
      points.push({ id: id, title: String(scene.title || "Scene #" + id), rating: rating, efficiency: (duration / 60) / (bytes / Math.pow(1024, 3)), bytes: bytes, duration: duration });
    });
    points.sort(function (left, right) { return left.efficiency - right.efficiency || left.rating - right.rating || left.title.localeCompare(right.title); });
    return { points: points, total: seen.size, missingRating: missingRating, missingFileData: missingFileData };
  }

  function qualityEfficiencySeriesData(stats: { points: StatsQualityPoint[] }) {
    var maxBytes = stats.points.reduce(function (maximum, point) { return Math.max(maximum, point.bytes); }, 0);
    return stats.points.map(function (point) {
      return { id: point.id, title: point.title, bytes: point.bytes, duration: point.duration, value: [point.efficiency, point.rating], symbolSize: qualityEfficiencySymbolSize(point.bytes, maxBytes), itemStyle: { color: themeColor("primary"), opacity: .72 } };
    });
  }

  function qualityEfficiencySymbolSize(bytes: number, maxBytes: number) {
    if (!(bytes > 0) || !(maxBytes > 0)) return 6;
    return Math.max(6, 36 * Math.sqrt(bytes / maxBytes));
  }
  const countries = countryIndex(world.features);
  return { normalize, countryIndex, countryPlaceholder, countryName, aggregate, filterAgeScenes, sceneVariables, mapLayout, originMapOption, performerVariables, orderedCards, countryPerformers, constellationGender, constellationLayout, aggregateConstellation, constellationScenes, ratingNumber, roundRating, sceneRating, aggregateRatings, scatterBound, aggregateScatter, studioSymbolSize, studioImageSource, loadStudioImage, renderStudioLogo, studioLogoSymbol, studioSeriesData, aggregateStudios, aggregateTagDna, tagDnaMetricValue, tagDnaMetricLabel, tagDnaColor, chartLabelColor, tagDnaSeriesData, tagDnaScenes, birthdayDayLabel, scatterSeriesData, nearestScatterOption, scatterGuideLines, scatterGuideForClick, scatterClickHitsPoint, countRatingLabel, countRatingSeriesData, aggregateCountRating, aggregateRepeatOffenders, repeatOffenderSeriesData, repeatOffenderRowAtShare, aggregateQualityEfficiency, qualityEfficiencySeriesData, qualityEfficiencySymbolSize, eckertIV, countries, dispose() { disposed = true; Array.from(pendingImages).forEach(cancel => cancel()); pendingImages.clear(); studioImagePromises = {}; studioImages = {}; studioLogoSymbols = {}; } };
}
export type Analytics = ReturnType<typeof createAnalytics>;
