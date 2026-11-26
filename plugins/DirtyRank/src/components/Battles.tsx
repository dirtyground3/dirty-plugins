import { useBattleSession } from "../battleSession";
import { PerformerCard } from "./PerformerCard";
import { DecisionIndicator, GauntletConfidenceIndicator, Leaderboard, RankButton, VerdictScale } from "./Primitives";
import { battleRouteFromPath } from "../domain/navigation";
import { poolFor } from "../domain/rank";
import { boxGendersLabel, boxOptions, categoriesForPerformer } from "../domain/settings";
import { React, Router, ui } from "../runtime";
import type * as R from "react";
import type { NativeProps } from "../../../DirtyPlugins/src/types";
import { LEADERBOARDS_ROUTE_PATH, PLUGIN_ID } from "../constants";
import { linkedBox } from "../domain/navigation";
import type { BattleProps } from "../types";

function useArenaScene(cardKey: string | null) {
  const [scene, setScene] = React.useState<{ cardKey: string; id: string } | null>(null);
  const onSceneChange = React.useCallback(
    (id: string | null) => {
      if (cardKey === null) return;
      setScene(current => {
        if (id !== null) return { cardKey, id };
        return current?.cardKey === cardKey ? null : current;
      });
    },
    [cardKey],
  );
  // A replacement card can render before the previous card cleans up its preview.
  return [scene?.cardKey === cardKey ? scene.id : null, onSceneChange] as const;
}

export function DirtyRankRoute(props: NativeProps): R.JSX.Element | null {
  const routeTargetId =
    props && props.match && props.match.params && props.match.params.performerId
      ? String(props.match.params.performerId)
      : "";
  const routeDetails = battleRouteFromPath(window.location.pathname);
  const gauntletPathActive = Boolean(routeDetails && routeDetails.performerId);
  if (gauntletPathActive && !routeTargetId) return null;
  if (
    !routeDetails ||
    (routeDetails.categoryId && !(props && props.match && props.match.params && props.match.params.categoryId))
  )
    return null;
  // Stash can keep the prefix route mounted alongside a more specific route.
  // Unmount the page (and its effects) when this route no longer owns it.
  return <DirtyRankBattlePage routeDetails={routeDetails} routeTargetId={routeTargetId} />;
}

export function DirtyRankBattlePage(props: BattleProps): R.JSX.Element | null {
  const session = useBattleSession(props);
  const {
    loading,
    error,
    settings,
    category,
    gauntletMode,
    censorMedia,
    pairInfo,
    performers,
    cohort,
    pendingVotes,
    feedback,
    decision,
    undoHistory,
    refinementConfidence,
    gauntletTarget,
    load,
    submit,
    undo,
  } = session;
  const ready = !loading && settings && category;
  const pair = ready ? pairInfo?.pair : null;
  const arenaLeft = pair ? pair[0] : null;
  const arenaRight = pair ? pair[1] : null;
  // Keep the Gauntlet target's mounted card and player across verdicts.
  const arenaLeftKey = arenaLeft ? (gauntletMode ? "gauntlet:" + arenaLeft.id : pairInfo!.instanceId + ":left") : null;
  const arenaRightKey = arenaRight ? pairInfo!.instanceId + ":right" : null;
  const [leftSceneId, onLeftSceneChange] = useArenaScene(arenaLeftKey);
  const [rightSceneId, onRightSceneChange] = useArenaScene(arenaRightKey);
  const { pathname } = Router.useLocation();
  React.useEffect(() => {
    const ids = [leftSceneId, rightSceneId].filter(id => id !== null);
    if (!ids.length) return;
    function announce(ids: string[] | null) {
      document.dispatchEvent(
        new CustomEvent("stash-scenes:context", {
          detail: {
            version: 1,
            source: PLUGIN_ID,
            path: pathname,
            kind: "scenes",
            keepOrder: true,
            label: "DirtyRank battle",
            ids,
          },
        }),
      );
    }
    announce(ids);
    return () => announce(null);
  }, [pathname, leftSceneId, rightSceneId]);

  if (loading)
    return (
      <main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
        <ui.StateView title={gauntletMode ? "Loading Gauntlet…" : "Loading DirtyRank…"} />
      </main>
    );
  if (error && (!settings || !performers.length)) {
    return (
      <main className="dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide">
        <ui.StateView
          title="Could not load DirtyRank"
          detail={error}
          actions={<RankButton onClick={() => load()}>Retry</RankButton>}
        />
      </main>
    );
  }
  if (!settings || !category) return null;

  const reveal = settings.showRatingsBeforeVote;
  const hideStandings = settings.hideBattleStandings;
  const availableCohorts = boxOptions(settings, true).filter(
    item =>
      settings!.enabledCohorts.indexOf(item[0]) !== -1 &&
      categoriesForPerformer(settings!, item[0], gauntletTarget).length > 0,
  );
  return (
    <React.Fragment>
      {Router.Prompt && (
        <Router.Prompt
          message="DirtyRank is still saving queued verdicts or undos. Wait for the queue to finish before leaving this page."
          when={pendingVotes > 0}
        />
      )}
      <main
        className={
          "dirty-rank-route dirty-ui-pilot dirty-ui-page-shell dirty-ui-page-shell-wide" +
          (gauntletMode ? " dirty-rank-gauntlet-route" : "") +
          (hideStandings ? " dirty-rank-standings-hidden" : "") +
          (censorMedia ? " dirty-rank-censored-media" : "")
        }
      >
        <div className="dirty-rank-shell">
          <section className="dirty-rank-main dirty-ui-feature-card">
            <header className="dirty-rank-header dirty-ui-page-header">
              <div className="dirty-rank-header-identity">
                <h1 className="dirty-rank-title dirty-rank-leaderboards-page-title">DirtyRank</h1>
                <fieldset className="dirty-rank-category-picker" disabled={pendingVotes > 0}>
                  <ui.StatisticSelector
                    id="dirty-rank-category"
                    ariaLabel="Category"
                    value={category.id}
                    options={categoriesForPerformer(settings, cohort, gauntletTarget).map(item => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    onSelect={session.selectCategory}
                  />
                </fieldset>
              </div>
              <div className="dirty-rank-header-controls dirty-ui-control-row d-flex flex-wrap align-items-end justify-content-end">
                {availableCohorts.length > 1 && (
                  <div className="dirty-rank-control dirty-ui-field">
                    <label htmlFor="dirty-rank-battle-cohort">Gender box</label>
                    <select
                      className="form-control"
                      disabled={pendingVotes > 0}
                      id="dirty-rank-battle-cohort"
                      onChange={event => {
                        session.selectCohort(event.target.value);
                      }}
                      value={cohort}
                    >
                      {availableCohorts.map(item => {
                        return (
                          <option key={item[0]} value={item[0]}>
                            {item[1]}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}
                {gauntletMode && gauntletTarget && (
                  <Router.NavLink
                    className="btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link"
                    to={"/performers/" + gauntletTarget.id}
                  >
                    Back to performer
                  </Router.NavLink>
                )}
                <Router.NavLink
                  className="btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link"
                  to={
                    LEADERBOARDS_ROUTE_PATH +
                    (linkedBox(settings.defaultCohort, cohort) ? "?box=" + encodeURIComponent(cohort) : "")
                  }
                >
                  Leaderboards
                </Router.NavLink>
                <Router.NavLink
                  className="btn btn-sm btn-secondary dirty-ui-button dirty-ui-control dirty-ui-control-compact dirty-rank-options-link"
                  to="/plugins/dirty-plugins?plugin=dirtyRank"
                >
                  Options
                </Router.NavLink>
              </div>
            </header>
            {(pendingVotes > 0 || feedback) && (
              <div className="dirty-rank-statusbar d-flex flex-wrap align-items-center justify-content-between">
                <div className="dirty-rank-session d-flex flex-wrap">
                  {pendingVotes > 0 && (
                    <span className="dirty-rank-saving">
                      {pendingVotes + " queued operation" + (pendingVotes === 1 ? "" : "s")}
                    </span>
                  )}
                </div>
                {feedback && (
                  <div className="dirty-rank-feedback" role="status">
                    {feedback.text}
                  </div>
                )}
              </div>
            )}
            <DecisionIndicator decision={decision} />
            {refinementConfidence && refinementConfidence.refined < refinementConfidence.eligible && (
              <div
                className="dirty-rank-refinement-estimate"
                title="Cohort-wide estimate for every eligible performer in this category, assuming informative matchups. Actual battles depend on opponents, future results, and the selected matchmaking goal."
              >
                {(refinementConfidence.eligible - refinementConfidence.refined).toLocaleString() +
                  " of " +
                  refinementConfidence.eligible.toLocaleString() +
                  " " +
                  boxGendersLabel(settings, cohort).toLowerCase() +
                  " performers need refinement · ≈" +
                  refinementConfidence.remainingBattles.toLocaleString() +
                  " more verdicts for the whole category"}
              </div>
            )}
            {gauntletMode && gauntletTarget && (
              <GauntletConfidenceIndicator
                category={category}
                cohort={cohort}
                performer={gauntletTarget}
                performers={performers}
                settings={settings}
              />
            )}
            {error && (
              <div
                className="dirty-ui-text-error"
                role="alert"
                style={{ padding: "0.75rem 1.25rem 0" } as R.CSSProperties}
              >
                {error}
              </div>
            )}
            {!pair && (
              <ui.StateView
                title="Not enough eligible performers"
                detail={
                  "This category and cohort need at least two performers" +
                  (settings.includePerformersWithoutImages ? "." : " with profile images.")
                }
                actions={
                  <Router.NavLink
                    className="btn btn-secondary dirty-ui-button"
                    to="/plugins/dirty-plugins?plugin=dirtyRank"
                  >
                    Open settings
                  </Router.NavLink>
                }
              />
            )}
            {pair && (
              <React.Fragment>
                <div className="dirty-rank-actions">
                  <RankButton className="dirty-rank-undo" disabled={!undoHistory.length} onClick={undo}>
                    {"Undo" + (undoHistory.length ? " (" + undoHistory.length + ")" : "")}
                  </RankButton>
                  <VerdictScale
                    chosen={session.chosen}
                    key={pairInfo!.instanceId}
                    keyLabels={session.keyLabels}
                    leftName={pair[0].name}
                    onChoose={submit}
                    rightName={pair[1].name}
                    saved={pairInfo!.saved}
                  />
                  <div className="dirty-rank-hint">
                    {session.keyLabels.slice(0, 3).join(" ") +
                      " · " +
                      session.keyLabels[3] +
                      " · " +
                      session.keyLabels.slice(4).join(" ") +
                      " or keypad 1 2 3 · 0 · 4 5 6 choose · ↓ or U undo"}
                  </div>
                </div>
                <div className="dirty-rank-arena">
                  <PerformerCard
                    key={arenaLeftKey}
                    gauntletTarget={gauntletMode}
                    onSceneChange={onLeftSceneChange}
                    performer={pair[0]}
                    pool={poolFor(pair[0], category.id, cohort, settings)}
                    rank={pairInfo!.ranks[pair[0].id]}
                    reveal={reveal}
                    settings={settings}
                  />
                  <div className="dirty-rank-versus" aria-hidden="true" />
                  <PerformerCard
                    key={arenaRightKey}
                    onSceneChange={onRightSceneChange}
                    performer={pair[1]}
                    pool={poolFor(pair[1], category.id, cohort, settings)}
                    rank={pairInfo!.ranks[pair[1].id]}
                    reveal={reveal}
                    settings={settings}
                  />
                </div>
              </React.Fragment>
            )}
          </section>
          {!hideStandings && (
            <Leaderboard category={category} cohort={cohort} performers={performers} settings={settings} />
          )}
        </div>
      </main>
    </React.Fragment>
  );
}
