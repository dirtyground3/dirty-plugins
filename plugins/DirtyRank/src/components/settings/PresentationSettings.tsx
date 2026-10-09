import type * as R from "react";
import { limits } from "@generated/dirtyRank.settings";
import { leaderboardPerformerCountMaximum } from "../../domain/navigation";
import type { RankSettingsDraft, RankSettingsPanelDependencies, RankSettingsSectionProps } from "../../types";
export function createPresentationSettings(dependencies: Pick<RankSettingsPanelDependencies, "React" | "Fragment" | "leaderboardPerformerCountError" | "Field" | "LEADERBOARD_TOP_OPTIONS" | "OVERALL_SCORE_PARAMETERS" | "OVERALL_SCORE_STRATEGIES" | "Section" | "Toggle" | "leaderboardPerformerCount" | "leaderboardTopCount" | "overallScoreParameterError" | "overallScoreStrategy">) {
  const { React, Fragment, leaderboardPerformerCountError, Field, LEADERBOARD_TOP_OPTIONS, OVERALL_SCORE_PARAMETERS, OVERALL_SCORE_STRATEGIES, Section, Toggle, leaderboardPerformerCount, leaderboardTopCount, overallScoreParameterError, overallScoreStrategy } = dependencies;
  function presentationToggles(definitions: Array<[keyof RankSettingsDraft, R.ReactNode]>, draft: RankSettingsDraft, changed: (update: Partial<RankSettingsDraft>) => void) {
    return definitions.map(function (definition) {
      var key = definition[0];
      return (<Toggle
        key={key}
        checked={draft[key as keyof RankSettingsDraft] as boolean}
        label={definition[1]}
        onChange={function (value: boolean) { var update: Partial<RankSettingsDraft> = {}; Object.assign(update, { [key]: value }); changed(update); }} />);
    });
  }
  function PresentationSettings(props: RankSettingsSectionProps) {
    var draft = props.draft;
    var changed = props.changed!;
    return (<Fragment>
      <Section
        title="Navigation"
        description="Choose which DirtyRank pages appear in Stash's utility navigation. Hidden pages remain available through direct links.">
        <div className="dirty-rank-settings-row">
          {presentationToggles([
            ["showBattlesInMenu", "Show Battles in the Stash header"],
            ["showLeaderboardsInMenu", "Show Leaderboards in the Stash header"]
          ], draft, changed)}
        </div>
      </Section>
      <Section
        title="Leaderboard presentation"
        description="Choose the featured layout and standings view. Changes save automatically and apply to every leaderboard statistic.">
        <div className="dirty-rank-settings-grid dirty-rank-leaderboard-settings">
          <Field id="dirty-rank-leaderboard-top-count" label="Featured performers">
            <select className="form-control" id="dirty-rank-leaderboard-top-count" onChange={function (event) {
              var topCount = leaderboardTopCount(event.target.value);
              changed({ leaderboardTopCount: topCount, leaderboardPerformerCount: leaderboardPerformerCount(draft.leaderboardPerformerCount, topCount) });
            }} value={draft.leaderboardTopCount}>
              {LEADERBOARD_TOP_OPTIONS.map(function (option) {
                return (<option key={option.count} value={option.count}>
                  {option.name}
                </option>);
              })}
            </select>
          </Field>
          <Field
            id="dirty-rank-leaderboard-performer-count"
            label="Performers per page"
            help={"Includes the featured performers. Use a multiple of " + draft.leaderboardTopCount + "; changing the layout rounds the count up to a valid multiple."}
            error={leaderboardPerformerCountError(draft)}>
            <input
              className="form-control"
              id="dirty-rank-leaderboard-performer-count"
              type="number"
              min={Number(draft.leaderboardTopCount) * 2}
              max={leaderboardPerformerCountMaximum(Number(draft.leaderboardTopCount))}
              step={draft.leaderboardTopCount}
              value={draft.leaderboardPerformerCount}
              onChange={function (event) { changed({ leaderboardPerformerCount: event.target.value }); }} />
          </Field>
          <Field id="dirty-rank-leaderboard-view" label="Standings view">
            <select
              className="form-control"
              id="dirty-rank-leaderboard-view"
              onChange={function (event) { changed({ leaderboardView: event.target.value }); }}
              value={draft.leaderboardView}>
              <option value="gallery">
                {"Gallery"}
              </option>
              <option value="table">
                {"Table"}
              </option>
            </select>
          </Field>
        </div>
      </Section>
      <Section
        title="Battle presentation"
        description="Control what is revealed on performer cards. These choices do not change the rating pools.">
        <div className="dirty-rank-settings-row">
          {presentationToggles([
            ["showRatingsBeforeVote", "Show ratings and ranks before voting"],
            ["hidePerformerImages", "Hide performer images in battles"],
            ["hideBattleStandings", "Hide standings during battles"],
            ["autoPlayTopScenes", (<span
              title="Automatic previews play each performer's highest-rated full scene, muted, from a random point between 30% and 70%. Photos remain clickable for voting unless hidden above.">
              {"Automatically play top scenes"}
            </span>)],
            ["includePerformersWithoutImages", "Include performers without profile images"]
          ], draft, changed)}
        </div>
      </Section>
      <Section
        title="Confidence goal"
        description="Choose what the information-gain matchmaker should stabilize. Every mode samples all eligible performers at least once; narrower goals stop refining ratings that no longer affect the result.">
        <div className="dirty-rank-settings-grid dirty-rank-settings-grid-compact">
          <Field id="dirty-rank-confidence-goal" label="Optimize battles for">
            <select
              className="form-control"
              id="dirty-rank-confidence-goal"
              onChange={function (event) { changed({ confidenceGoal: event.target.value }); }}
              value={draft.confidenceGoal}>
              <option value="ranking">
                {"Leaderboard order (recommended)"}
              </option>
              <option value="top">
                {"Top performers"}
              </option>
              <option value="all">
                {"Every performer rating"}
              </option>
            </select>
          </Field>
          {draft.confidenceGoal === "top" && (<Field
            id="dirty-rank-confidence-top-n"
            label="Top performers to stabilize"
            error={!String(draft.confidenceTopN).trim() || !Number.isInteger(Number(draft.confidenceTopN)) ||
              Number(draft.confidenceTopN) < limits.confidenceTopN.min || Number(draft.confidenceTopN) > limits.confidenceTopN.max
              ? "Enter a whole number from " + limits.confidenceTopN.min + " to " + limits.confidenceTopN.max + "." : ""}>
            <input
              className="form-control"
              id="dirty-rank-confidence-top-n"
              max={limits.confidenceTopN.max}
              min={limits.confidenceTopN.min}
              onChange={function (event) { changed({ confidenceTopN: event.target.value }); }}
              step={limits.confidenceTopN.step}
              type="number"
              value={draft.confidenceTopN} />
          </Field>)}
        </div>
      </Section>
      <Section
        title="Overall scoring"
        description="Experiment with how categories combine into the overall leaderboard and Stash performer sort. Changes save automatically and recalculate existing scores; category ratings and battle history are kept.">
        <Field
          id="dirty-rank-overall-strategy"
          label="Scoring strategy"
          help={overallScoreStrategy(draft.overallScoreStrategy).description}>
          <select
            className="form-control"
            id="dirty-rank-overall-strategy"
            value={draft.overallScoreStrategy}
            onChange={function (event) { changed({ overallScoreStrategy: event.target.value }); }}>
            {OVERALL_SCORE_STRATEGIES.map(function (strategy) {
              return (<option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>);
            })}
          </select>
        </Field>
        {draft.overallScoreStrategy === "power" && (<div className="dirty-rank-settings-grid">
          {OVERALL_SCORE_PARAMETERS.filter(function (definition) {
            return definition.strategy === draft.overallScoreStrategy;
          }).map(function (definition) {
            var id = "dirty-rank-" + definition.key;
            return (<Field
              key={definition.key}
              id={id}
              label={definition.label}
              help={definition.help}
              error={overallScoreParameterError(draft[definition.key as keyof RankSettingsDraft], definition)}>
              <input
                className="form-control"
                id={id}
                type="number"
                min={definition.min}
                max={definition.max}
                step={definition.step}
                value={draft[definition.key as keyof RankSettingsDraft] as number | string}
                onChange={function (event) {
                  var update: Partial<RankSettingsDraft> = {};
                  Object.assign(update, { [definition.key]: event.target.value });
                  changed(update);
                }} />
            </Field>);
          })}
        </div>)}
      </Section>
    </Fragment>);
  }
  return PresentationSettings;
}
