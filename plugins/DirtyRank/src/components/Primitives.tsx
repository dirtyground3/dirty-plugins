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
import { boxFor, boxGendersLabel, categoriesFor } from "../domain/settings";
import { DirtyPlugins, PluginApi, React, Router, ui } from "../runtime";
import type * as R from "react";
import type { SharedProps } from "../../../DirtyPlugins/src/types";
import { OVERALL_LEADERBOARD_ID } from "../constants";
import type { ConfidenceProps, Decision, DisplayPool, RankCategory, RankPerformer, RankSettings } from "../types";
export function RankCrown(): R.JSX.Element | null {
  return (
    <svg
      aria-hidden="true"
      className="dirty-rank-crown-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M3 8l5 4 4-8 4 8 5-4-3 11H6z" fill="currentColor" fillOpacity="0.18" />
      <path d="M6 22h12M7 16h10" />
      <circle cx="12" cy="2.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="2" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="22" cy="6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

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
      title="Estimate based on current Glicko-2 rating deviations, expected information gain, and the selected confidence goal. Future results can change it."
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
  const remaining = estimatedMatchesToConfidence(
    pool,
    props.settings.provisionalDeviation,
    representativeOpponent(pool, opponentDeviation, props.settings),
    props.settings,
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
  const history = Router.useHistory();
  return (
    <ui.StatisticSelector
      id="dirty-rank-statistic"
      value={props.value}
      options={[{ value: OVERALL_LEADERBOARD_ID, label: "Overall" }].concat(
        props.categories.map(category => ({ value: category.id, label: category.name })),
      )}
      onSelect={(id: string) => {
        history.push(DirtyPlugins.captureUrl(leaderboardStatPath(id, props.boxId)));
      }}
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
    const label = person.tone === "winner" ? "Winner" : person.tone === "loser" ? "Loser" : "Tie";
    return (
      <span className={"dirty-rank-decision-person dirty-rank-decision-" + person.tone}>
        <span className="dirty-rank-decision-label">{label}</span>
        <strong>{person.name}</strong>
      </span>
    );
  }
  return (
    <div aria-live="polite" className="dirty-rank-decision d-flex flex-wrap align-items-center">
      <span className="dirty-rank-decision-title">Last decision</span>
      {result(decision.left)}
      {result(decision.right)}
    </div>
  );
}

export function hillFireworks() {
  const colors = ["#ffe6a3", "#65e8ff", "#d4a2ff", "#ff8ea8", "#a8ffc5"];
  const bursts = [];
  const confetti = [];
  for (let burst = 0; burst < 18; burst += 1) {
    const sparks = [];
    const finale = burst >= 12;
    for (let spark = 0; spark < 32; spark += 1) {
      const angle = (spark * Math.PI * 2) / 32;
      const radius = (finale ? 12 : 8) * (spark % 2 ? 0.65 : 1);
      sparks.push(
        <span
          className="dirty-rank-firework-spark"
          key={spark}
          style={
            {
              "--spark-x": (Math.cos(angle) * radius).toFixed(3) + "rem",
              "--spark-y": (Math.sin(angle) * radius).toFixed(3) + "rem",
              "--spark-angle": (spark * 360) / 32 + "deg",
            } as R.CSSProperties
          }
        />,
      );
    }
    bursts.push(
      <span
        className="dirty-rank-firework"
        key={"burst-" + burst}
        style={
          {
            left: 8 + ((burst * 29) % 85) + "%",
            top: 12 + ((burst * 17) % 48) + "%",
            "--firework-color": colors[burst % colors.length],
            "--firework-delay": (finale ? 5.4 + (burst - 12) * 0.12 : burst * 0.4).toFixed(2) + "s",
          } as R.CSSProperties
        }
      >
        {sparks}
      </span>,
    );
  }
  for (let piece = 0; piece < 64; piece += 1) {
    confetti.push(
      <span
        className="dirty-rank-victory-confetti"
        key={"confetti-" + piece}
        style={
          {
            left: ((piece * 37) % 100) + "%",
            "--confetti-color": colors[piece % colors.length],
            "--confetti-drift": ((piece * 19) % 24) - 12 + "rem",
            "--confetti-delay": 1.2 + (piece % 16) * 0.25 + "s",
            "--confetti-turn": (piece % 2 ? 720 : -720) + "deg",
          } as R.CSSProperties
        }
      />,
    );
  }
  return (
    <div className="dirty-rank-fireworks" aria-hidden="true">
      {bursts}
      {confetti}
    </div>
  );
}
