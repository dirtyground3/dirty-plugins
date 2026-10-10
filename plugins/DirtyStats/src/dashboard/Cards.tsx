import { State } from "./Chart";
import { orderedCards } from "../domain/analytics";
import { docsCaptureEnabled } from "../domain/filters";
import { React, api, hub } from "../runtime";
import type * as R from "react";
import type { CardWidgetProps } from "../props";
import type { EntityResponse, StatsPerformer } from "../types";
export function PerformerCardWidget(props: CardWidgetProps): R.ReactElement | null {
  const rows = props.rows,
    ids = rows.map(performer => String(performer.id));
  const docsCapture = docsCaptureEnabled(window.location.search);
  const [ready, setReady] = React.useState(Boolean(api.components.PerformerCard));
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (docsCapture || !ids.length) return;
    if (api.components.PerformerCard) {
      setReady(true);
      return;
    }
    let active = true;
    hub.native
      .ensureComponents("Performers", ["PerformerCard"])
      .then(() => {
        if (active) setReady(true);
      })
      .catch(loadError => {
        if (active) setError(loadError.message || String(loadError));
      });
    return () => {
      active = false;
    };
  }, [docsCapture, ids.length]);
  const query = api.GQL.useFindPerformersQuery<EntityResponse<StatsPerformer>>({
    variables: {
      performer_ids: ids,
      filter: { page: 1, per_page: props.widget.options.cardCount },
      performer_filter: {},
    },
    skip: docsCapture || !ready || !ids.length,
  });
  if (!ids.length) return <State title="No performers" detail="No performers match this widget's filters." />;
  if (docsCapture)
    return <State title="Performer cards hidden" detail="Cards are hidden while capturing documentation." />;
  if (error) return <State title="Could not load performer cards" detail={error} role="alert" />;
  if (!ready || query.loading) return <State title="Loading performer cards…" />;
  if (query.error) return <State title="Could not load performer cards" detail={query.error.message} role="alert" />;
  const cards = orderedCards(query.data && query.data.findPerformers ? query.data.findPerformers.performers : [], ids);
  const deceasedIds = new Set(rows.filter(performer => performer.death_date).map(performer => String(performer.id)));
  return (
    <div className="dirty-stats-dashboard-performer-cards">
      {props.widget.options.showHeader === false ? null : (
        <p className="dirty-stats-dashboard-card-count">
          {"Showing " + cards.length + " performer" + (cards.length === 1 ? "" : "s")}
        </p>
      )}
      <div className="dirty-stats-dashboard-card-grid">
        {cards.map(performer => {
          const deceased = deceasedIds.has(String(performer.id));
          return (
            <div key={performer.id} className={"dirty-stats-performer-column" + (deceased ? " is-deceased" : "")}>
              {deceased ? <span className="dirty-stats-memorial-label">In memoriam</span> : null}
              <api.components.PerformerCard performer={performer} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
