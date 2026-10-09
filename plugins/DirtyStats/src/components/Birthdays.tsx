import type * as R from "react";
import type { BirthdayCalendarProps, PageProps } from "../props";
import type { BirthdaySelection, StatsPerformer, StatsScene } from "../types";
import type { ViewDependencies } from "../view";
export function createBirthdays(dependencies: ViewDependencies) {
  const { docsCaptureEnabled, StatsState, pageToolbar, performerVariables, PerformerCards, birthdayDayLabel, React, dataLoader, aggregateBirthdays, birthdayEntriesFor, birthdayDefaultSelection, birthdayAgeText, birthdayMonthCounts, BIRTHDAY_MONTHS } = dependencies;
  const BIRTHDAY_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
  function BirthdayCalendar(props: BirthdayCalendarProps): R.ReactElement | null {
    const entries = props.entries, year = props.year, selected = props.selected, nowMonth = props.nowMonth, nowDay = props.nowDay;
    return (<div className="dirty-stats-calendar">
      {BIRTHDAY_MONTHS.map((name, index) => {
        const month = index + 1;
        let counts = Object.create(null), monthTotal = 0;
        entries.forEach(entry => { if (entry.month === month) { counts[entry.day] = (counts[entry.day] || 0) + 1; monthTotal++; } });
        const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const cells = [];
        // A factory keeps each day's click bound to its own number; a bare
        // closure in the loop would capture the final loop value.
        const selectDay = (targetDay: number) => (() => { props.onSelect(month, targetDay); });
        for (let blank = 0;blank < startWeekday;blank++) cells.push((<span key={"blank-" + blank} className="dirty-stats-calendar-blank" />));
        for (let day = 1;day <= daysInMonth;day++) {
          const count = counts[day] || 0;
          const isSelected = Boolean(selected && selected.month === month && selected.day === day);
          const classes = ["dirty-stats-calendar-day"];
          if (count) classes.push("has-birthday");
          if (month === nowMonth && day === nowDay) classes.push("today");
          if (isSelected) classes.push("selected");
          cells.push((<button
            key={"day-" + day}
            type="button"
            className={classes.join(" ")}
            disabled={!count}
            aria-pressed={isSelected}
            aria-label={name + " " + day + (count ? ": " + count + " birthday" + (count === 1 ? "" : "s") : ": no birthdays")}
            onClick={count ? selectDay(day) : undefined}>
            {String(day)}
            {count > 1 ? (<span className="dirty-stats-calendar-count">
              {count}
            </span>) : null}
          </button>));
        }
        return (<section
          key={name}
          className={"dirty-stats-calendar-month" + (month === nowMonth ? " is-current" : "")}
          aria-label={name + (monthTotal ? ", " + monthTotal + " birthdays" : ", no birthdays")}>
          <h3>
            <span>
              {name}
            </span>
            {monthTotal ? (<span className="dirty-stats-calendar-total">
              {monthTotal}
            </span>) : null}
          </h3>
          <div className="dirty-stats-calendar-grid">
            {BIRTHDAY_WEEKDAYS.map((label, weekday) => {
              return (<span key={"weekday-" + weekday} className="dirty-stats-calendar-weekday" aria-hidden={true}>
                {label}
              </span>);
            })}
            {cells}
          </div>
        </section>);
      })}
    </div>);
  }

  function BirthdayPage(props: PageProps): R.ReactElement | null {
    const pageData = dataLoader.usePageData<StatsScene & StatsPerformer>(), performers = pageData.rows, loading = pageData.loading, error = pageData.error;
    const [selected, setSelected] = React.useState<BirthdaySelection | null>(null);
    const [refresh, setRefresh] = React.useState(0);
    const [now] = React.useState(() => new Date());
    const defaultSelectionQuery = React.useRef("");
    const docsCapture = React.useMemo(() => docsCaptureEnabled(window.location.search), []);
    const queryKey = JSON.stringify(performerVariables(props.filter, 1));
    const stats = React.useMemo(() => aggregateBirthdays(performers, now), [performers, now]);
    const upcoming = React.useMemo(() => stats.entries.slice().sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name)), [stats]);
    React.useEffect(() => { setSelected(null); }, [queryKey]);
    pageData.useLoad({
      query: "query DirtyStatsBirthdays($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id name birthdate death_date image_path}}}",
      variables: page => performerVariables(props.filter, page),
      entity: "performers",
      onLoaded: result => {
        if (defaultSelectionQuery.current !== queryKey) {
          setSelected(birthdayDefaultSelection(aggregateBirthdays(result, now), now));
          defaultSelectionQuery.current = queryKey;
        }
      }
    }, [queryKey, refresh]);
    const nowMonth = now.getUTCMonth() + 1, nowDay = now.getUTCDate(), year = now.getUTCFullYear();
    const cardPerformers = React.useMemo(() => selected ? birthdayEntriesFor(stats.entries, selected.month, selected.day, selected.today) : stats.entries, [stats, selected]);
    function choose(month: number, day: number) { setSelected(current => current && current.month === month && current.day === day ? null : { month, day }); }
    const monthCounts = React.useMemo(() => birthdayMonthCounts(stats.entries), [stats]);
    return (<section className="dirty-stats-content">
      {pageToolbar(loading ? "Loading performers..." : stats.valid + " birthdays \u00b7 " + stats.upcoming + " in the next 30 days" + (stats.missing ? " \u00b7 " + stats.missing + " missing birthdate" : ""), loading, () => { setRefresh(refresh + 1); })}
      {error ? (<StatsState detail={error + " Use Refresh to retry."} role="alert" title="Could not load performers" />) : null}
      {!loading && !error && stats.valid ? (<section className="dirty-stats-map-panel dirty-ui-panel" aria-label="Performer birthday calendar">
        <div className="dirty-stats-map-controls">
          <span className="dirty-stats-summary">
            {"A year of birthdays (" + year + ")"}
          </span>
          {selected ? (<button className="btn btn-secondary dirty-ui-button" onClick={() => { setSelected(null); }}>
            Show all birthdays
          </button>) : null}
        </div>
        <div className="dirty-stats-birthday-next" role="list" aria-label="Upcoming birthdays">
          {upcoming.slice(0, 5).map(entry => {
            return (<button
              key={entry.id}
              type="button"
              role="listitem"
              className={"dirty-stats-birthday-next-item" + (entry.deceased ? " is-deceased" : "")}
              title={entry.deceased ? "In memoriam" : undefined}
              onClick={() => { choose(entry.month, entry.day); }}>
              <span className="dirty-stats-birthday-next-photo">
                {!docsCapture && entry.image ? (<img src={entry.image} alt="" loading="lazy" />) : (<span className="dirty-stats-birthday-next-initial" aria-hidden={true}>
                  {(String(entry.name || "?").charAt(0) || "?").toUpperCase()}
                </span>)}
              </span>
              <span className="dirty-stats-birthday-next-text">
                <span className="dirty-stats-birthday-next-name">
                  {entry.name}
                </span>
                <span className="dirty-stats-birthday-next-date">
                  {birthdayDayLabel(entry.month, entry.day) + " \u00b7 " + (entry.daysUntil === 0 ? "today" : "in " + entry.daysUntil + " day" + (entry.daysUntil === 1 ? "" : "s")) + " \u00b7 " + birthdayAgeText(entry)}
                </span>
              </span>
            </button>);
          })}
        </div>
        <BirthdayCalendar
          entries={stats.entries}
          year={year}
          selected={selected}
          nowMonth={nowMonth}
          nowDay={nowDay}
          onSelect={choose} />
      </section>) : null}
      {!loading && !error && !stats.total ? (<StatsState title="No performers match these filters." />) : null}
      {!loading && !error && stats.total && !stats.valid ? (<StatsState title="No matching performer has a valid full birthdate." />) : null}
      {!loading && !error ? (<div className="dirty-stats-toolbar">
        <span className="dirty-stats-summary" role="status">
          {monthCounts.map((count, index) => count ? BIRTHDAY_MONTHS[index].slice(0, 3) + " " + count : null).filter(Boolean).join(" \u00b7 ")}
        </span>
      </div>) : null}
      <p>
        Each day shows how many matching performers have that birthday, across every year. Click a highlighted day to show those performers below; the panel marks today and lists the nearest birthdays first. Invalid or partial birthdates are excluded and reported.
      </p>
      {!loading && !error ? (<PerformerCards
        performers={cardPerformers}
        filter={props.filter}
        title={selected ? (selected.today ? "Birthdays today" : "Birthdays on " + birthdayDayLabel(selected.month, selected.day)) : "Performers with birthdays"}
        selection={selected}
        clearSelection={() => { setSelected(null); }}
        clearLabel="Show all birthdays" />) : null}
    </section>);
  }
  return { BirthdayCalendar, BirthdayPage };
}
