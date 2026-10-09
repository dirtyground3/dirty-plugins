import type * as R from "react";
import type { PerformerCardsProps, SceneCardsProps } from "../props";
import type { ViewDependencies } from "../view";
export function createCards(dependencies: ViewDependencies) {
  const { docsCaptureEnabled, StatsState, orderedCards, api, hub, React } = dependencies;
  function PerformerCards(props: PerformerCardsProps): R.ReactElement | null {
    var state = React.useState(1), page = state[0], setPage = state[1];
    var docsCapture = docsCaptureEnabled(window.location.search);
    var ids = props.performers.map(function (p) { return Number(p.id); });
    var key = JSON.stringify(ids);
    React.useEffect(function () { setPage(1); }, [key]);
    var pages = Math.max(1, Math.ceil(ids.length / 24));
    var current = Math.min(page, pages);
    var pageIds = ids.slice((current - 1) * 24, current * 24);
    var deceasedIds = new Set(props.performers.filter(function (performer) { return performer && (performer.deceased || performer.death_date); }).map(function (performer) { return String(performer.id); }));
    var query = api.GQL.useFindPerformersQuery({
      variables: { performer_ids: pageIds, filter: Object.assign({}, props.filter ? props.filter.makeFindFilter() : { sort: "name", direction: "ASC" }, { page: current, per_page: 24 }), performer_filter: props.filter ? props.filter.makeFilter() : {} },
      skip: docsCapture || !ids.length
    });
    var cards = orderedCards(query.data && query.data.findPerformers ? query.data.findPerformers.performers : [], pageIds);
    return (<section className="dirty-stats-performers" aria-label="Matching performers">

      <div className="dirty-stats-toolbar">

        <h2 className="h5">

          {props.title ? props.title + " (" + ids.length + ")" : props.country ? "Performers from " + props.country + " (" + ids.length + ")" : "Performers (" + ids.length + ")"}

        </h2>

        {(props.country || props.selection != null) ? (<button className="btn btn-secondary dirty-ui-button" onClick={props.clearCountry || props.clearSelection}>

          {props.clearLabel || "Show all countries"}

        </button>) : null}

      </div>

      {docsCapture ? (<StatsState title="Performer cards hidden" detail="Cards are hidden while capturing documentation." />) : !ids.length ? (<StatsState detail="No performers match this selection and the current filters." title="No performers" />) : query.loading ? (<StatsState detail="Loading performer cards…" title="Loading" />) : query.error ? (<StatsState detail={query.error.message} role="alert" title="Could not load performer cards" />) :
        (<div className="row">

          {cards.map(function (performer) {
            var deceased = deceasedIds.has(String(performer.id));
            return (<div
              key={performer.id}
              className={"col-6 col-md-4 col-lg-3 dirty-stats-performer-column mb-3" + (deceased ? " is-deceased" : "")}>

              {deceased ? (<span className="dirty-stats-memorial-label">

                {"In memoriam"}

              </span>) : null}

              <api.components.PerformerCard performer={performer} />

            </div>);
          })}

        </div>)}

      {!docsCapture && ids.length > 24 ? (<hub.react.Pagination page={current} totalPages={pages} onPageChange={setPage} ariaLabel="Performer pages" />) : null}

    </section>);
  }

  function SceneCards(props: SceneCardsProps): R.ReactElement | null {
    var state = React.useState(1), page = state[0], setPage = state[1];
    var docsCapture = docsCaptureEnabled(window.location.search);
    var ids = props.scenes.map(function (scene) { return Number(scene.id); });
    var key = JSON.stringify(ids);
    React.useEffect(function () { setPage(1); }, [key]);
    var pages = Math.max(1, Math.ceil(ids.length / 24)), current = Math.min(page, pages);
    var pageIds = ids.slice((current - 1) * 24, current * 24);
    var query = api.GQL.useFindScenesQuery({
      variables: { scene_ids: pageIds, filter: Object.assign({}, props.filter.makeFindFilter(), { page: current, per_page: 24 }), scene_filter: props.filter.makeFilter() },
      skip: docsCapture || !ids.length
    });
    var cards = orderedCards(query.data && query.data.findScenes ? query.data.findScenes.scenes : [], pageIds);
    return (<section className="dirty-stats-scenes" aria-label="Matching scenes">

      <div className="dirty-stats-toolbar">

        <h2 className="h5">

          {(props.title || "Scenes") + " (" + ids.length + ")"}

        </h2>

        {props.selection ? (<button className="btn btn-secondary dirty-ui-button" onClick={props.clearSelection}>

          {props.clearLabel || "Show all scenes"}

        </button>) : null}

      </div>

      {docsCapture ? (<StatsState title="Scene cards hidden" detail="Cards are hidden while capturing documentation." />) : !ids.length ? (<StatsState detail="No scenes match these filters." title="No scenes" />) : query.loading ? (<StatsState detail="Loading scene cards…" title="Loading" />) : query.error ? (<StatsState detail={query.error.message} role="alert" title="Could not load scene cards" />) :
        (<div className="row">

          {cards.map(function (scene) {
            return (<div key={scene.id} className="col-12 col-sm-6 col-lg-4 col-xl-3 mb-3">

              <api.components.SceneCard scene={scene} />

            </div>);
          })}

        </div>)}

      {!docsCapture && ids.length > 24 ? (<hub.react.Pagination page={current} totalPages={pages} onPageChange={setPage} ariaLabel="Scene pages" />) : null}

    </section>);
  }
  return { PerformerCards, SceneCards };
}
