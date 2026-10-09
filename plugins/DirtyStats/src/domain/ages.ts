import type { BirthdayEntry, StatsPerformer, StatsScene } from "../types";


/** @param {string} value @returns {Date | null} */
export function fullDate(value: string | null | undefined) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

export function ageAtScene(birthdate: string | null | undefined, sceneDate: string | null | undefined) {
  const birth = fullDate(birthdate), scene = fullDate(sceneDate);
  if (!birth || !scene || birth > scene) return null;
  let age = scene.getUTCFullYear() - birth.getUTCFullYear();
  if (scene.getUTCMonth() < birth.getUTCMonth() || (scene.getUTCMonth() === birth.getUTCMonth() && scene.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

// Birthdays recur every year, so the year is stripped and Feb 29 falls back to
// Feb 28 in non-leap years instead of silently rolling into March.
export function birthdayInYear(year: number, month: number, day: number) {
  let date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) date = new Date(Date.UTC(year, month - 1, day - 1));
  return date;
}

export function daysUntilBirthday(month: number, day: number, now?: Date | null) {
  now = now == null ? new Date() : now;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let next = birthdayInYear(today.getUTCFullYear(), month, day);
  if (next < today) next = birthdayInYear(today.getUTCFullYear() + 1, month, day);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export function performerImageSource(performer: StatsPerformer | null | undefined) {
  const path = performer && performer.image_path ? String(performer.image_path).trim() : "";
  if (path) return path;
  return performer && performer.id != null && performer.id !== "" ? "/performer/" + encodeURIComponent(performer.id) + "/image" : "";
}

export function aggregateBirthdays(performers: StatsPerformer[], now?: Date | null) {
  now = now == null ? new Date() : now;
  let entries: BirthdayEntry[] = [], seen = new Set(), missing = 0;
  performers.forEach(performer => {
    const id = String(performer.id == null ? "" : performer.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const birth = fullDate(performer.birthdate);
    if (!birth) { missing++; return; }
    const month = birth.getUTCMonth() + 1, day = birth.getUTCDate();
    const daysUntil = daysUntilBirthday(month, day, now);
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + daysUntil * 86400000);
    entries.push({
      id,
      name: String(performer.name || "Performer #" + id),
      birthdate: String(performer.birthdate || ""),
      deathDate: String(performer.death_date || "").trim(),
      deceased: Boolean(String(performer.death_date || "").trim()),
      month,
      day,
      turns: next.getUTCFullYear() - birth.getUTCFullYear(),
      daysUntil,
      image: performerImageSource(performer)
    });
  });
  entries.sort((a, b) => a.month - b.month || a.day - b.day || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    entries,
    total: seen.size,
    valid: entries.length,
    missing,
    today: entries.filter(entry => entry.daysUntil === 0).length,
    upcoming: entries.filter(entry => entry.daysUntil <= 30).length
  };
}

export function birthdayEntriesFor(entries: BirthdayEntry[], month: number, day: number, _today?: boolean) {
  const today = arguments.length > 3 && arguments[3];
  return entries.filter(entry => today ? entry.daysUntil === 0 : entry.month === month && entry.day === day);
}

export function birthdayDefaultSelection(stats: { today: number } | null, now?: Date | null) {
  if (!stats || !stats.today) return null;
  now = now == null ? new Date() : now;
  return { month: now.getUTCMonth() + 1, day: now.getUTCDate(), today: true };
}

export function birthdayAgeText(entry: BirthdayEntry | null) {
  return (entry && entry.deceased ? "would have turned " : "turns ") + (entry ? entry.turns : "");
}

export function birthdayMonthCounts(entries: BirthdayEntry[]) {
  const counts = [];
  for (let month = 1; month <= 12; month++) counts.push(entries.filter(entry => entry.month === month).length);
  return counts;
}

export function aggregateAges(scenes: StatsScene[]) {
  let buckets = new Map<number, Set<string>>(), performers = new Set(), seen = new Set(), missingSceneDates = 0, missingBirthdates = 0;
  scenes.forEach(scene => {
    if (seen.has(scene.id)) return;
    seen.add(scene.id);
    if (!fullDate(scene.date)) { missingSceneDates++; return; }
    const scenePerformers = new Set();
    (scene.performers || []).forEach(performer => {
      if (scenePerformers.has(performer.id)) return;
      scenePerformers.add(performer.id);
      const age = ageAtScene(performer.birthdate, scene.date);
      if (age == null) { missingBirthdates++; return; }
      if (!buckets.has(age)) buckets.set(age, new Set());
      buckets.get(age)!.add(performer.id); performers.add(performer.id);
    });
  });
  const ages = Array.from(buckets.keys()).sort((a, b) => a - b), rows: Array<{ age: number; count: number }> = [];
  if (ages.length) for (let age = ages[0];age <= ages[ages.length - 1];age++) rows.push({ age, count: buckets.has(age) ? buckets.get(age)!.size : 0 });
  let total = 0, sum = 0;
  /** @type {{age: number, count: number} | null} */
  let mode: { age: number, count: number } | null = null;
  rows.forEach(row => {
    total += row.count; sum += row.age * row.count;
    if (!mode || row.count > mode.count) mode = row;
  });
  /** @type {number | null} */
  let median: number | null = null;
  /** @type {number | null} */
  let lower: number | null = null;
  /** @type {number | null} */
  let upper: number | null = null;
  let cumulative = 0;
  if (total) {
    const lowerPosition = Math.floor((total + 1) / 2), upperPosition = Math.floor(total / 2) + 1;
    rows.forEach(row => {
      cumulative += row.count;
      if (lower === null && cumulative >= lowerPosition) lower = row.age;
      if (upper === null && cumulative >= upperPosition) upper = row.age;
    });
    median = (lower! + upper!) / 2;
  }
  return { rows, performers: performers.size, scenes: seen.size, modeAge: (mode as { age: number; count: number } | null)?.age ?? null, modeCount: (mode as { age: number; count: number } | null)?.count ?? 0, medianAge: median, averageAge: total ? sum / total : null, missingSceneDates, missingBirthdates };
}

export function performersAtAge(scenes: StatsScene[], selectedAge?: number | null) {
  const found = new Map();
  scenes.forEach(scene => {
    (scene.performers || []).forEach(performer => {
      const age = ageAtScene(performer.birthdate, scene.date);
      if (age != null && (selectedAge == null || age === selectedAge)) found.set(performer.id, { id: performer.id });
    });
  });
  return Array.from(found.values());
}