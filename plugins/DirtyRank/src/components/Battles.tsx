import type * as R from "react";
import type { NativeProps } from "../../../DirtyPlugins/src/types";
import { LEADERBOARDS_ROUTE_PATH } from "../constants";
import type { BattleProps } from "../types";
import type { ViewDependencies } from "../view";
export function createBattles(dependencies: Pick<ViewDependencies, "React" | "Fragment" | "NavLink" | "Prompt" | "StateView" | "SharedStatisticSelector" | "boxOptions" | "boxGendersLabel" | "categoriesForPerformer" | "poolFor" | "battleRouteFromPath" | "RankCrown" | "RankButton" | "Leaderboard" | "GauntletConfidenceIndicator" | "DecisionIndicator" | "hillFireworks" | "PerformerCard" | "useBattleSession">) {
  const { React, Fragment, NavLink, Prompt, StateView, SharedStatisticSelector, boxOptions, boxGendersLabel, categoriesForPerformer, poolFor, battleRouteFromPath, RankCrown, RankButton, Leaderboard, GauntletConfidenceIndicator, DecisionIndicator, hillFireworks, PerformerCard, useBattleSession } = dependencies;
  function DirtyRankRoute(props: NativeProps): R.JSX.Element | null {
    var routeTargetId = props && props.match && props.match.params && props.match.params.performerId
      ? String(props.match.params.performerId)
      : "";
    var routeDetails = battleRouteFromPath(window.location.pathname);
    var gauntletPathActive = Boolean(routeDetails && routeDetails.performerId);
    if (gauntletPathActive && !routeTargetId) return null;
    if (!routeDetails || (routeDetails.categoryId && !(props && props.match && props.match.params && props.match.params.categoryId))) return null;
    // Stash can keep the prefix route mounted alongside a more specific route.
    // Unmount the page (and its effects) when this route no longer owns it.
    return (<DirtyRankBattlePage routeDetails={routeDetails} routeTargetId={routeTargetId} />);
  }

  function DirtyRankBattlePage(props: BattleProps): R.JSX.Element | null {
    var session = useBattleSession(props);
    var loading = session.loading;
    var error = session.error;
    var settings = session.settings;
    var category = session.category;
    var gauntletMode = session.gauntletMode;
    var kingsMode = session.kingsMode;
    var censorMedia = session.censorMedia;
    var pairInfo = session.pairInfo;
    var performers = session.performers;
    var cohort = session.cohort;
    var pendingVotes = session.pendingVotes;
    var feedback = session.feedback;
    var decision = session.decision;
    var undoHistory = session.undoHistory;
    var refinementConfidence = session.refinementConfidence;
    var gauntletTarget = session.gauntletTarget;
    var load = session.load;
    var submit = session.submit;
    var skip = session.skip;
    var undo = session.undo;
    var restartKings = session.restartKings;
    if (loading) return (<main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
      <StateView title={gauntletMode ? "Loading Gauntlet…" : "Loading DirtyRank…"} />
    </main>);
    if (error && (!settings || !performers.length)) {
      return (<main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
        <StateView
          title="Could not load DirtyRank"
          detail={error}
          actions={(<RankButton onClick={load}>
            {"Retry"}
          </RankButton>)} />
      </main>);
    }
    if (!settings || !category) return null;

    var pair = pairInfo && pairInfo!.pair;
    var hillWinner = kingsMode && pairInfo && pairInfo!.incumbentId && !pair
      ? performers.find(function (performer) { return String(performer.id) === pairInfo!.incumbentId; })
      : null;
    var arenaLeft = pair ? pair[0] : hillWinner && pairInfo!.incumbentSide === "left" ? hillWinner : null;
    var arenaRight = pair ? pair[1] : hillWinner && pairInfo!.incumbentSide === "right" ? hillWinner : null;
    // Keep the same mounted card and player when this performer wins.
    var arenaLeftKey = arenaLeft && (gauntletMode ? "gauntlet:" + arenaLeft.id : kingsMode ? "kings:" + cohort + ":" + category.id + ":" + arenaLeft.id : pairInfo!.instanceId + ":left");
    var reveal = settings.showRatingsBeforeVote;
    var hillDefeated = kingsMode ? session.defeatedCount : 0;
    var hillTotal = kingsMode && pairInfo ? Math.max(0, pairInfo!.eligible - 1) : 0;
    var hideStandings = kingsMode || settings.hideBattleStandings;
    var availableCohorts = boxOptions(settings, true).filter(function (item) {
      return settings!.enabledCohorts.indexOf(item[0]) !== -1 && categoriesForPerformer(settings!, item[0], gauntletTarget).length > 0;
    });
    return (<Fragment>
      {Prompt && (<Prompt
        message="DirtyRank is still saving queued votes or undos. Wait for the queue to finish before leaving this page."
        when={pendingVotes > 0} />)}
      <main
        className={"dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide" + (gauntletMode ? " dirty-rank-gauntlet-route" : "") + (kingsMode ? " dirty-rank-kings-route" : "") + (hideStandings ? " dirty-rank-standings-hidden" : "") + (censorMedia ? " dirty-rank-censored-media" : "")}>
        <div className="dirty-rank-shell">
          <section className="dirty-rank-main dirty-ui-feature-card">
            <header className="dirty-rank-header dirty-ui-page-header">
              <div className="dirty-rank-header-identity">
                <h1 className="dirty-rank-title dirty-rank-leaderboards-page-title">
                  {"DirtyRank"}
                </h1>
                {kingsMode && (<div className="dirty-rank-hill-crest">
                  <RankCrown />
                  <span>
                    {"King of the hill"}
                  </span>
                </div>)}
                <fieldset className="dirty-rank-category-picker" disabled={pendingVotes > 0}>
                  <SharedStatisticSelector
                    id="dirty-rank-category"
                    ariaLabel="Category"
                    value={category.id}
                    options={categoriesForPerformer(settings, cohort, gauntletTarget).map(function (item) {
                      return { value: item.id, label: item.name };
                    })}
                    onSelect={session.selectCategory} />
                </fieldset>
              </div>
              <div
                className="dirty-rank-header-controls dirty-ui-control-row d-flex flex-wrap align-items-end justify-content-end">
                {!gauntletMode && (<RankButton
                  className="dirty-ui-control dirty-rank-options-link"
                  disabled={pendingVotes > 0}
                  id="dirty-rank-battle-mode"
                  onClick={session.toggleBattleMode}>
                  {kingsMode ? "Standard battles" : "King of the hill"}
                </RankButton>)}
                {availableCohorts.length > 1 && (<div className="dirty-rank-control dirty-ui-field">
                  <label htmlFor="dirty-rank-battle-cohort">
                    {"Gender box"}
                  </label>
                  <select
                    className="form-control"
                    disabled={pendingVotes > 0}
                    id="dirty-rank-battle-cohort"
                    onChange={function (event) { session.selectCohort(event.target.value); }}
                    value={cohort}>
                    {availableCohorts.map(function (item) {
                      return (<option key={item[0]} value={item[0]}>
                        {item[1]}
                      </option>);
                    })}
                  </select>
                </div>)}
                {gauntletMode && gauntletTarget && (<NavLink
                  className="btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link"
                  to={"/performers/" + gauntletTarget.id}>
                  {"Back to performer"}
                </NavLink>)}
                <NavLink
                  className="btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link"
                  to={LEADERBOARDS_ROUTE_PATH + (cohort === settings.defaultCohort && cohort.indexOf("BOX-") !== 0 ? "" : "?box=" + encodeURIComponent(cohort))}>
                  {"Leaderboards"}
                </NavLink>
                <NavLink
                  className="btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link"
                  to="/plugins/dirty-plugins?plugin=dirtyRank">
                  {"Options"}
                </NavLink>
              </div>
            </header>
            {(pendingVotes > 0 || feedback) && (<div className="dirty-rank-statusbar d-flex flex-wrap align-items-center justify-content-between">
              <div className="dirty-rank-session d-flex flex-wrap">
                {pendingVotes > 0 && (<span className="dirty-rank-saving">
                  {pendingVotes + " queued operation" + (pendingVotes === 1 ? "" : "s")}
                </span>)}
              </div>
              {feedback && (<div className="dirty-rank-feedback" role="status">
                {feedback.text}
              </div>)}
            </div>)}
            <DecisionIndicator decision={decision} />
            {refinementConfidence && refinementConfidence.refined < refinementConfidence.eligible && (<div
              className="dirty-rank-refinement-estimate"
              title="Cohort-wide estimate for every eligible performer in this category, assuming informative matchups. Actual battles depend on opponents, future results, and the selected matchmaking goal.">
              {(refinementConfidence.eligible - refinementConfidence.refined).toLocaleString() + " of " +
                refinementConfidence.eligible.toLocaleString() + " " + boxGendersLabel(settings, cohort).toLowerCase() +
                " performers need refinement · ≈" + refinementConfidence.remainingBattles.toLocaleString() +
                " more battles for the whole category"}
            </div>)}
            {kingsMode && (pair || hillWinner) && (<div className="dirty-rank-hill-progress" role="status">
              <span className="dirty-rank-hill-progress-label">
                {hillWinner ? "The crown is claimed" : pairInfo!.incumbentId ? "Defend the crown" : "Claim the crown"}
              </span>
              <span className="dirty-rank-hill-progress-track" aria-hidden="true">
                <span
                  style={{ width: (hillTotal ? Math.min(100, hillDefeated / hillTotal * 100) : 0) + "%" } as R.CSSProperties} />
              </span>
              <span className="dirty-rank-hill-progress-count">
                {hillDefeated.toLocaleString() + " / " + hillTotal.toLocaleString() + " defeated"}
              </span>
            </div>)}
            {gauntletMode && gauntletTarget && (<GauntletConfidenceIndicator
              category={category}
              cohort={cohort}
              performer={gauntletTarget}
              performers={performers}
              settings={settings} />)}
            {error && (<div className="dirty-ui-text-error" role="alert" style={{ padding: "0.75rem 1.25rem 0" } as R.CSSProperties}>
              {error}
            </div>)}
            {!pair && !hillWinner && (<StateView
              title="Not enough eligible performers"
              detail={"This category and cohort need at least two performers" + (settings.includePerformersWithoutImages ? "." : " with profile images.")}
              actions={(<NavLink className="btn btn-secondary dirty-ui-button" to="/plugins/dirty-plugins?plugin=dirtyRank">
                {"Open settings"}
              </NavLink>)} />)}
            {(pair || hillWinner) && (<Fragment>
              <div
                className={"dirty-rank-arena" + (hillWinner ? " dirty-rank-coronation dirty-rank-coronation-" + pairInfo!.incumbentSide : "")}>
                {arenaLeft && (<PerformerCard
                  crowned={Boolean(hillWinner)}
                  disabled={false}
                  key={arenaLeftKey}
                  gauntletTarget={gauntletMode}
                  hillMode={kingsMode}
                  hillOpening={kingsMode && !pairInfo!.incumbentId}
                  kingTarget={kingsMode && pairInfo!.incumbentId === String(arenaLeft.id)}
                  onChoose={function () { submit("left"); }}
                  performer={arenaLeft}
                  pool={poolFor(arenaLeft, category.id, cohort, settings)}
                  rank={pairInfo!.ranks[arenaLeft.id]}
                  reveal={reveal}
                  settings={settings} />)}
                {pair && (<div className="dirty-rank-versus" aria-hidden="true" />)}
                {arenaRight && (<PerformerCard
                  crowned={Boolean(hillWinner)}
                  disabled={false}
                  key={kingsMode ? "kings:" + cohort + ":" + category.id + ":" + arenaRight.id : pairInfo!.instanceId + ":right"}
                  hillMode={kingsMode}
                  hillOpening={kingsMode && !pairInfo!.incumbentId}
                  kingTarget={kingsMode && pairInfo!.incumbentId === String(arenaRight.id)}
                  onChoose={function () { submit("right"); }}
                  performer={arenaRight}
                  pool={poolFor(arenaRight, category.id, cohort, settings)}
                  rank={pairInfo!.ranks[arenaRight.id]}
                  reveal={reveal}
                  settings={settings} />)}
                {hillWinner && hillFireworks()}
              </div>
              {pair && (<div className="dirty-rank-actions d-flex flex-wrap align-items-center justify-content-center">
                {!kingsMode && (<RankButton disabled={false} onClick={function () { submit("draw"); }}>
                  {"Tie"}
                </RankButton>)}
                {!kingsMode && (<RankButton disabled={false} onClick={skip}>
                  {"Skip"}
                </RankButton>)}
                <RankButton disabled={!undoHistory.length} onClick={undo}>
                  {"Undo" + (undoHistory.length ? " (" + undoHistory.length + ")" : "")}
                </RankButton>
                <div className="dirty-rank-hint">
                  {kingsMode
                    ? "← choose left · → choose right · ↓ undo"
                    : "← choose left · → choose right · ↑ tie · ↓ undo · S skip"}
                </div>
              </div>)}
              {hillWinner && (<StateView
                title="Hill cleared"
                detail={hillWinner.name + " has defeated every eligible challenger in this run."}
                actions={(<Fragment>
                  <RankButton disabled={!undoHistory.length} onClick={undo}>
                    {"Undo" + (undoHistory.length ? " (" + undoHistory.length + ")" : "")}
                  </RankButton>
                  <RankButton disabled={pendingVotes > 0} onClick={restartKings}>
                    {"Start a new run"}
                  </RankButton>
                </Fragment>)} />)}
            </Fragment>)}
          </section>
          {!hideStandings && (<Leaderboard category={category} cohort={cohort} performers={performers} settings={settings} />)}
        </div>
      </main>
    </Fragment>);
  }
  return { DirtyRankRoute, DirtyRankBattlePage };
}
