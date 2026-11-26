import {
  categoryConfidence,
  categoryEntries,
  estimatedMatchesToConfidence,
  representativeOpponent,
} from "../domain/matchmaking";
import { leaderboardStatPath } from "../domain/navigation";
import {
  categoryEligible,
  excellentDeviationThreshold,
  leaderboardData,
  leaderboardPoolFor,
  poolFor,
  precisionTier,
  rankPerformers,
} from "../domain/rank";
import { VERDICT_SCORES } from "../domain/rating";
import type { SavedVerdict } from "../domain/rating";
import { boxFor, boxGendersLabel, categoriesFor } from "../domain/settings";
import { verdictLabel } from "../domain/verdicts";
import { PluginApi, React, ui } from "../runtime";
import type * as R from "react";
import type { SharedProps } from "../../../DirtyPlugins/src/types";
import { OVERALL_LEADERBOARD_ID } from "../constants";
import type { ConfidenceProps, Decision, DisplayPool, RankCategory, RankPerformer, RankSettings } from "../types";
export function RankButton(props: SharedProps): R.JSX.Element | null {
  return <ui.Button {...props}>{props.children}</ui.Button>;
}

export function PrecisionBadge(props: { pool: DisplayPool; settings: RankSettings }): R.JSX.Element | null {
  const tier = props.pool.precision || precisionTier(props.pool, props.settings);
  let title = props.pool.overallScore
    ? tier.label +
      " category precision · " +
      props.pool.ratedCategories +
      "/" +
      props.pool.totalCategories +
      " categories rated · mean category RD " +
      props.pool.deviation.toFixed(1)
    : tier.label + " precision · RD " + props.pool.deviation.toFixed(1);
  title += " · " + props.pool.matches.toLocaleString() + (props.pool.matches === 1 ? " battle" : " battles");
  return (
    <ui.Badge className={"text-uppercase dirty-rank-status-" + tier.id} title={title}>
      {tier.label}
    </ui.Badge>
  );
}

export function Leaderboard(props: ConfidenceProps): R.JSX.Element | null {
  const ranked = leaderboardData(props.performers, props.category.id, props.cohort, props.settings).ranked.slice(0, 12);
  return (
    <aside className="dirty-rank-leaderboard dirty-ui-feature-card" aria-label="DirtyRank leaderboard">
      <div className="dirty-rank-leaderboard-header">
        <div className="dirty-rank-eyebrow">
          {boxFor(props.settings, props.cohort).name + " · " + boxGendersLabel(props.settings, props.cohort)}
        </div>
        <h2>{props.category.name + " standings"}</h2>
        <div className="dirty-rank-leaderboard-note">Current battle category · top 12</div>
      </div>
      {!ranked.length && <div className="dirty-rank-empty-standings">Complete a battle to start this leaderboard.</div>}
      {ranked.map((performer, index) => {
        const pool = leaderboardPoolFor(performer, props.category.id, props.cohort, props.settings);
        return (
          <div className="dirty-rank-standing" key={performer.id}>
            <span className="dirty-rank-standing-position">{index + 1}</span>
            <span className="dirty-rank-standing-name text-truncate" title={performer.name}>
              {performer.name}
            </span>
            <span className="dirty-rank-standing-rating">
              {Math.round(pool.rating).toLocaleString() + (pool.precision.id === "provisional" ? "?" : "")}
            </span>
          </div>
        );
      })}
    </aside>
  );
}

export function ConfidenceIndicator(props: ConfidenceProps): R.JSX.Element | null {
  const confidence = categoryConfidence(props.performers, props.category, props.cohort, props.settings);
  const target = props.settings.provisionalDeviation;
  const battlePurpose =
    props.settings.confidenceGoal === "all"
      ? "rating-refinement"
      : props.settings.confidenceGoal === "top"
        ? "top-list"
        : "order-separating";
  const remaining =
    confidence.remainingBattles > 0
      ? "≈" + confidence.remainingBattles.toLocaleString() + " more " + battlePurpose + " battles estimated"
      : "Selected confidence goal is statistically established";
  return (
    <section
      className="dirty-rank-confidence"
      title="Estimate based on current rating deviations, expected information gain, and the selected confidence goal. Future results can change it."
    >
      <div className="dirty-rank-confidence-copy">
        <div className="dirty-rank-confidence-heading">
          <strong>{"Category confidence · " + confidence.goalLabel}</strong>
          <span>
            {confidence.established.toLocaleString() +
              "/" +
              confidence.goalTotal.toLocaleString() +
              " " +
              confidence.goalUnit +
              " established"}
          </span>
        </div>
        <div className="dirty-rank-confidence-detail">
          {remaining +
            " · " +
            confidence.refined.toLocaleString() +
            "/" +
            confidence.eligible.toLocaleString() +
            " refined · " +
            confidence.excellent.toLocaleString() +
            " excellent · target RD ≤ " +
            Number(target).toLocaleString() +
            " · " +
            confidence.completedBattles.toLocaleString() +
            " completed"}
        </div>
      </div>
      <div
        aria-label={"Confidence progress for " + confidence.goalLabel}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(confidence.progress)}
        className="dirty-rank-confidence-track"
        role="progressbar"
      >
        <span style={{ width: Math.max(0, Math.min(100, confidence.progress)) + "%" } as R.CSSProperties} />
      </div>
    </section>
  );
}

export function GauntletConfidenceIndicator(
  props: ConfidenceProps & { performer: RankPerformer },
): R.JSX.Element | null {
  const pool = poolFor(props.performer, props.category.id, props.cohort, props.settings);
  const opponents = categoryEntries(props.performers, props.category, props.cohort, props.settings).filter(
    entry => String(entry.performer.id) !== String(props.performer.id),
  );
  const deviations = opponents.map(entry => entry.pool.deviation).sort((left, right) => left - right);
  const opponentDeviation = deviations[Math.floor(deviations.length / 2)] || props.settings.initialDeviation;
  const remaining = React.useMemo(
    () =>
      estimatedMatchesToConfidence(
        pool,
        props.settings.provisionalDeviation,
        representativeOpponent(pool, opponentDeviation, props.settings),
        props.settings,
      ),
    [pool.rating, pool.deviation, pool.matches, opponentDeviation, props.settings],
  );
  const ranked = rankPerformers(
    props.performers.filter(performer => categoryEligible(performer, props.category, props.settings, props.cohort)),
    props.category.id,
    props.cohort,
    props.settings,
  );
  const rank = ranked.findIndex(performer => String(performer.id) === String(props.performer.id)) + 1;
  const progress =
    pool.matches > 0
      ? Math.min(
          100,
          (props.settings.provisionalDeviation / Math.max(props.settings.provisionalDeviation, pool.deviation)) * 100,
        )
      : 0;
  const tier = precisionTier(pool, props.settings);
  const status =
    remaining > 0
      ? "≈" + remaining.toLocaleString() + " more target battles estimated"
      : "Target rating precision is " + tier.label.toLowerCase();
  return (
    <section
      className={
        "dirty-rank-confidence dirty-rank-gauntlet-confidence" +
        (tier.id !== "provisional" ? " dirty-rank-gauntlet-established" : "") +
        (tier.id === "excellent" ? " dirty-rank-gauntlet-excellent" : "")
      }
      title={
        "Gauntlet reaches Refined at RD " +
        props.settings.provisionalDeviation.toLocaleString() +
        " and Excellent at RD " +
        excellentDeviationThreshold(props.settings).toLocaleString() +
        "."
      }
    >
      <div className="dirty-rank-confidence-copy">
        <div className="dirty-rank-confidence-heading">
          <strong>{"Target confidence · " + props.performer.name}</strong>
          <PrecisionBadge pool={pool} settings={props.settings} />
        </div>
        <div className="dirty-rank-confidence-detail">
          {status + " · rating " + Math.round(pool.rating).toLocaleString() + (rank ? " · #" + rank : "")}
        </div>
      </div>
      <div
        aria-label={"Gauntlet confidence for " + props.performer.name}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(progress)}
        className="dirty-rank-confidence-track"
        role="progressbar"
      >
        <span style={{ width: progress + "%" } as R.CSSProperties} />
      </div>
    </section>
  );
}

export function LeaderboardStat(props: SharedProps): R.JSX.Element | null {
  return (
    <ui.Metric
      className="dirty-rank-stat dirty-ui-feature-card"
      label={props.label}
      value={props.value}
      detail={props.detail}
    />
  );
}

export function OverallConfidence(props: Omit<ConfidenceProps, "category">): R.JSX.Element | null {
  const categories = categoriesFor(props.settings, props.cohort).filter(
    category => category.enabled && Number(category.weight) > 0,
  );
  const rows = categories.map(category => {
    return {
      category,
      confidence: categoryConfidence(props.performers, category, props.cohort, props.settings),
    };
  });
  const totalWeight = rows.reduce((sum, row) => sum + Number(row.category.weight), 0);
  const progress = totalWeight
    ? rows.reduce((sum, row) => sum + row.confidence.progress * Number(row.category.weight), 0) / totalWeight
    : 0;
  const remaining = rows.reduce((sum, row) => sum + row.confidence.remainingBattles, 0);
  const complete = rows.filter(row => row.confidence.remainingBattles === 0).length;
  return (
    <section className="dirty-rank-overall-confidence dirty-ui-feature-card">
      <div className="dirty-rank-panel-heading d-flex align-items-end justify-content-between">
        <div>
          <div className="dirty-rank-eyebrow">Weighted category confidence</div>
          <h2>Overall confidence</h2>
        </div>
        <div className="dirty-rank-panel-summary">
          {complete.toLocaleString() +
            "/" +
            rows.length.toLocaleString() +
            " categories established · ≈" +
            remaining.toLocaleString() +
            " battles remaining"}
        </div>
      </div>
      <div
        aria-label="Weighted overall confidence progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(progress)}
        className="dirty-rank-confidence-track dirty-rank-overall-confidence-track"
        role="progressbar"
      >
        <span style={{ width: Math.max(0, Math.min(100, progress)) + "%" } as R.CSSProperties} />
      </div>
      <div className="dirty-rank-confidence-categories">
        {rows.map(row => {
          const confidence = row.confidence;
          return (
            <article className="dirty-rank-confidence-category" key={row.category.id}>
              <div className="dirty-rank-confidence-category-heading">
                <strong>{row.category.name}</strong>
                <span>{Math.round(confidence.progress) + "%"}</span>
              </div>
              <div className="dirty-rank-confidence-detail">
                {confidence.refined.toLocaleString() +
                  "/" +
                  confidence.eligible.toLocaleString() +
                  " refined · " +
                  confidence.excellent.toLocaleString() +
                  " excellent · " +
                  confidence.established.toLocaleString() +
                  "/" +
                  confidence.goalTotal.toLocaleString() +
                  " established · ≈" +
                  confidence.remainingBattles.toLocaleString() +
                  " remaining"}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function Field(props: SharedProps): R.JSX.Element | null {
  return <ui.Field {...props}>{props.children}</ui.Field>;
}

export function RankStatisticSelector(props: {
  value: string;
  categories: RankCategory[];
  boxId?: string;
}): R.JSX.Element | null {
  return (
    <ui.StatisticSelector
      id="dirty-rank-statistic"
      value={props.value}
      options={[{ value: OVERALL_LEADERBOARD_ID, label: "Overall" }]
        .concat(props.categories.map(category => ({ value: category.id, label: category.name })))
        .map(option => ({ ...option, to: leaderboardStatPath(option.value, props.boxId) }))}
    />
  );
}

export function LeaderboardInfoPopover(props: SharedProps): R.JSX.Element | null {
  const Dropdown = PluginApi.libraries.Bootstrap.Dropdown;
  return (
    <Dropdown className="dirty-rank-info-dropdown">
      <Dropdown.Toggle id={props.id} variant="secondary" className="dirty-ui-button dirty-ui-control">
        {props.label}
      </Dropdown.Toggle>
      <Dropdown.Menu
        className={"dirty-rank-info-popover dirty-ui-panel" + (props.className ? " " + props.className : "")}
        role="region"
        aria-label={props.label}
        renderOnMount={false}
      >
        {props.children}
      </Dropdown.Menu>
    </Dropdown>
  );
}

export function DecisionIndicator(props: { decision: Decision | null }): R.JSX.Element | null {
  const decision = props.decision;
  if (!decision) return null;
  function result(person: Decision["left"]) {
    return (
      <span className={"dirty-rank-decision-person dirty-rank-decision-" + person.tone}>
        <strong>{person.name}</strong>
      </span>
    );
  }
  return (
    <div aria-live="polite" className="dirty-rank-decision d-flex flex-wrap align-items-center">
      <span className="dirty-rank-decision-title">Last verdict</span>
      {result(decision.left)}
      {result(decision.right)}
      <span className="dirty-rank-decision-text">
        {verdictLabel(decision.score, decision.left.name, decision.right.name)}
      </span>
    </div>
  );
}

/**
 * Seven numbered steps from "left much better" (3) through equal (0) to "right much
 * better" (3). A saved verdict is highlighted; choosing it again confirms it.
 */
export function VerdictScale(props: {
  leftName?: string;
  rightName?: string;
  saved?: SavedVerdict | null;
  /** The letters of the keys for each step, left to right. */
  keyLabels?: string[];
  /** The number just chosen for the previous pair: it flashes briefly. */
  chosen?: number | null;
  onChoose(score: number): void;
}): R.JSX.Element | null {
  const leftName = props.leftName || "Left";
  const rightName = props.rightName || "Right";
  const saved = props.saved || null;
  const choosing = typeof props.chosen === "number";
  return (
    <div className="dirty-rank-verdict-scale" role="group" aria-label="Verdict">
      <div className="dirty-rank-verdict-steps">
        {VERDICT_SCORES.slice()
          .reverse()
          .map((score, index) => {
            // The side and strength colour each step: the left performer's colour deepens
            // toward its 3, the right performer's toward theirs, and equal stays neutral.
            const side = score > 0 ? "left" : score < 0 ? "right" : "equal";
            const chosen = Boolean(saved && saved.score === score);
            return (
              <RankButton
                ariaLabel={verdictLabel(score, leftName, rightName)}
                className={
                  "dirty-rank-verdict-step dirty-rank-verdict-" +
                  side +
                  " dirty-rank-verdict-strength-" +
                  Math.abs(score) +
                  (chosen ? " dirty-rank-verdict-saved" : "") +
                  (choosing && props.chosen === score ? " dirty-rank-verdict-chosen" : "")
                }
                key={score}
                onClick={() => {
                  props.onChoose(score);
                }}
                pressed={saved ? chosen : undefined}
                title={
                  verdictLabel(score, leftName, rightName) + (props.keyLabels ? " · key " + props.keyLabels[index] : "")
                }
              >
                {String(Math.abs(score))}
              </RankButton>
            );
          })}
      </div>
      <div className="dirty-rank-verdict-ends" aria-hidden="true">
        <span className="dirty-rank-verdict-end-left">{"← " + leftName + " better"}</span>
        <span>Equal</span>
        <span className="dirty-rank-verdict-end-right">{rightName + " better →"}</span>
      </div>
      {saved && (
        <div className="dirty-rank-verdict-saved-note" role="note">
          {"Saved verdict: " +
            verdictLabel(saved.score, leftName, rightName) +
            ". Choose it again to keep it, or another number to change it."}
        </div>
      )}
    </div>
  );
}
