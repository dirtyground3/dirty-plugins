import { StatsState } from "./Primitives";
import { orderedCards } from "../domain/analytics";
import { docsCaptureEnabled } from "../domain/filters";
import { React, api, hub } from "../runtime";
import type * as R from "react";
import type { PerformerCardsProps, SceneCardsProps } from "../props";
import type { EntityResponse, StatsPerformer, StatsScene } from "../types";
export function PerformerCards(props: PerformerCardsProps): R.ReactElement | null {
  const [page, setPage] = React.useState(1);
  const docsCapture = docsCaptureEnabled(window.location.search);
  const ids = props.performers.map(p => Number(p.id));
  const key = JSON.stringify(ids);
  React.useEffect(() => {
    setPage(1);
  }, [key]);
  const pages = Math.max(1, Math.ceil(ids.length / 24));
  const current = Math.min(page, pages);
  const pageIds = ids.slice((current - 1) * 24, current * 24);
  const deceasedIds = new Set(
    props.performers
      .filter(performer => performer && (performer.deceased || performer.death_date))
      .map(performer => String(performer.id)),
  );
  const query = api.GQL.useFindPerformersQuery<EntityResponse<StatsPerformer>>({
    variables: {
      performer_ids: pageIds,
      filter: Object.assign({}, props.filter ? props.filter.makeFindFilter() : { sort: "name", direction: "ASC" }, {
        page: current,
        per_page: 24,
      }),
      performer_filter: props.filter ? props.filter.makeFilter() : {},
    },
    skip: docsCapture || !ids.length,
  });
  const cards = orderedCards(
    query.data && query.data.findPerformers ? query.data.findPerformers.performers : [],
    pageIds,
  );
  return (
    <section className="dirty-stats-performers" aria-label="Matching performers">
      <div className="dirty-stats-toolbar">
        <h2 className="h5">
          {props.title
            ? props.title + " (" + ids.length + ")"
            : props.country
              ? "Performers from " + props.country + " (" + ids.length + ")"
              : "Performers (" + ids.length + ")"}
        </h2>
        {props.country || props.selection != null ? (
          <button className="btn btn-secondary dirty-ui-button" onClick={props.clearCountry || props.clearSelection}>
            {props.clearLabel || "Show all countries"}
          </button>
        ) : null}
      </div>
      {docsCapture ? (
        <StatsState title="Performer cards hidden" detail="Cards are hidden while capturing documentation." />
      ) : !ids.length ? (
        <StatsState detail="No performers match this selection and the current filters." title="No performers" />
      ) : query.loading ? (
        <StatsState detail="Loading performer cards…" title="Loading" />
      ) : query.error ? (
        <StatsState detail={query.error.message} role="alert" title="Could not load performer cards" />
      ) : (
        <div className="row">
          {cards.map(performer => {
            const deceased = deceasedIds.has(String(performer.id));
            return (
              <div
                key={performer.id}
                className={
                  "col-6 col-md-4 col-lg-3 dirty-stats-performer-column mb-3" + (deceased ? " is-deceased" : "")
                }
              >
                {deceased ? <span className="dirty-stats-memorial-label">In memoriam</span> : null}
                <api.components.PerformerCard performer={performer} />
              </div>
            );
          })}
        </div>
      )}
      {!docsCapture && ids.length > 24 ? (
        <hub.react.Pagination page={current} totalPages={pages} onPageChange={setPage} ariaLabel="Performer pages" />
      ) : null}
    </section>
  );
}

export function SceneCards(props: SceneCardsProps): R.ReactElement | null {
  const [page, setPage] = React.useState(1);
  const docsCapture = docsCaptureEnabled(window.location.search);
  const ids = props.scenes.map(scene => Number(scene.id));
  const key = JSON.stringify(ids);
  React.useEffect(() => {
    setPage(1);
  }, [key]);
  const pages = Math.max(1, Math.ceil(ids.length / 24)),
    current = Math.min(page, pages);
  const pageIds = ids.slice((current - 1) * 24, current * 24);
  const query = api.GQL.useFindScenesQuery<EntityResponse<StatsScene>>({
    variables: {
      scene_ids: pageIds,
      filter: Object.assign({}, props.filter.makeFindFilter(), { page: current, per_page: 24 }),
      scene_filter: props.filter.makeFilter(),
    },
    skip: docsCapture || !ids.length,
  });
  const cards = orderedCards(query.data && query.data.findScenes ? query.data.findScenes.scenes : [], pageIds);
  return (
    <section className="dirty-stats-scenes" aria-label="Matching scenes">
      <div className="dirty-stats-toolbar">
        <h2 className="h5">{(props.title || "Scenes") + " (" + ids.length + ")"}</h2>
        {props.selection ? (
          <button className="btn btn-secondary dirty-ui-button" onClick={props.clearSelection}>
            {props.clearLabel || "Show all scenes"}
          </button>
        ) : null}
      </div>
      {docsCapture ? (
        <StatsState title="Scene cards hidden" detail="Cards are hidden while capturing documentation." />
      ) : !ids.length ? (
        <StatsState detail="No scenes match these filters." title="No scenes" />
      ) : query.loading ? (
        <StatsState detail="Loading scene cards…" title="Loading" />
      ) : query.error ? (
        <StatsState detail={query.error.message} role="alert" title="Could not load scene cards" />
      ) : (
        <div className="row">
          {cards.map(scene => {
            return (
              <div key={scene.id} className="col-12 col-sm-6 col-lg-4 col-xl-3 mb-3">
                <api.components.SceneCard scene={scene} />
              </div>
            );
          })}
        </div>
      )}
      {!docsCapture && ids.length > 24 ? (
        <hub.react.Pagination page={current} totalPages={pages} onPageChange={setPage} ariaLabel="Scene pages" />
      ) : null}
    </section>
  );
}
