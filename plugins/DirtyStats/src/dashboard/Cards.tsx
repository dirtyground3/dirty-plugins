import type * as R from "react";
import type { DashboardDependencies } from "../dashboardView";
import type { CardWidgetProps } from "../props";
export function createDashboardCards(dependencies: DashboardDependencies) {
  const { State, api, hub, React, algorithms } = dependencies;
  function PerformerCardWidget(props: CardWidgetProps): R.ReactElement | null {
    var rows = props.rows, ids = rows.map(function (performer) { return String(performer.id); });
    var docsCapture = algorithms.docsCaptureEnabled(window.location.search);
    var readyState = React.useState(Boolean(api.components.PerformerCard)), ready = readyState[0], setReady = readyState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    React.useEffect(function () {
      if (docsCapture || !ids.length) return;
      if (api.components.PerformerCard) { setReady(true); return; }
      var active = true;
      hub.native.ensureComponents("Performers", ["PerformerCard"]).then(function () {
        if (active) setReady(true);
      }).catch(function (loadError) { if (active) setError(loadError.message || String(loadError)); });
      return function () { active = false; };
    }, [docsCapture, ids.length]);
    var query = api.GQL.useFindPerformersQuery({
      variables: { performer_ids: ids, filter: { page: 1, per_page: props.widget.options.cardCount }, performer_filter: {} },
      skip: docsCapture || !ready || !ids.length
    });
    if (!ids.length) return (<State title="No performers" detail="No performers match this widget's filters." />);
    if (docsCapture) return (<State title="Performer cards hidden" detail="Cards are hidden while capturing documentation." />);
    if (error) return (<State title="Could not load performer cards" detail={error} role="alert" />);
    if (!ready || query.loading) return (<State title="Loading performer cards…" />);
    if (query.error) return (<State title="Could not load performer cards" detail={query.error.message} role="alert" />);
    var cards = algorithms.orderedCards(query.data && query.data.findPerformers ? query.data.findPerformers.performers : [], ids);
    var deceasedIds = new Set(rows.filter(function (performer) { return performer.death_date; }).map(function (performer) { return String(performer.id); }));
    return (<div className="dirty-stats-dashboard-performer-cards">

      {props.widget.options.showHeader === false ? null : (<p className="dirty-stats-dashboard-card-count">

        {"Showing " + cards.length + " performer" + (cards.length === 1 ? "" : "s")}

      </p>)}

      <div className="dirty-stats-dashboard-card-grid">

        {cards.map(function (performer) {
          var deceased = deceasedIds.has(String(performer.id));
          return (<div key={performer.id} className={"dirty-stats-performer-column" + (deceased ? " is-deceased" : "")}>

            {deceased ? (<span className="dirty-stats-memorial-label">

              {"In memoriam"}

            </span>) : null}

            <api.components.PerformerCard performer={performer} />

          </div>);
        })}

      </div>

    </div>);
  }
  return { PerformerCardWidget };
}
