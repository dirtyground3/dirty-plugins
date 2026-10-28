import { Field, RankButton } from "../Primitives";
import { RATING_PRESETS, ratingPresetFor } from "../../domain/settings";
import { React, ui } from "../../runtime";
import { limits } from "@generated/dirtyRank.settings";
import type { RankSettingsDraft, RankSettingsSectionProps } from "../../types";
interface ParameterDefinition {
  key: keyof RankSettingsDraft;
  id?: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step?: number;
}
const MATCHMAKING_PARAMETERS: ParameterDefinition[] = [
  {
    key: "evidenceWeight",
    id: "dirty-rank-evidence-weight",
    label: "Evidence per battle",
    ...limits.evidenceWeight,
    help: "How much one vote reduces uncertainty. 1 is standard Glicko-2; 2 counts a consistent choice twice, so ratings settle in about half the battles.",
  },
  {
    key: "avoidRepeatWindow",
    id: "dirty-rank-repeat-window",
    label: "Recent pairs to avoid",
    ...limits.avoidRepeatWindow,
    help: "Prefer different pairings within this many recent battles. A small pool may still repeat a pair.",
  },
  {
    key: "calibrationPercent",
    id: "dirty-rank-calibration",
    label: "Calibration matches (%)",
    ...limits.calibrationPercent,
    help: "Chance of a matchup across a wider rating gap. Lower values focus on the most informative matchups.",
  },
];
const RATING_PARAMETERS: ParameterDefinition[] = [
  {
    key: "provisionalDeviation",
    label: "Provisional threshold (RD)",
    ...limits.provisionalDeviation,
    help: "A rating counts as settled (Refined) once its deviation is at or below this, and Excellent at 60% of it. Lower values need more battles: 70 needs about twice as many as 100.",
  },
  {
    key: "initialRating",
    label: "Initial rating",
    ...limits.initialRating,
    help: "Starting rating for unrated performers. It only shifts the scale.",
  },
  {
    key: "initialDeviation",
    label: "Initial deviation",
    ...limits.initialDeviation,
    help: "Starting uncertainty. Higher values let the first battles move a rating further.",
  },
  {
    key: "deviationFloor",
    label: "Deviation floor",
    ...limits.deviationFloor,
    help: "Uncertainty never drops below this, so settled ratings can still move.",
  },
  {
    key: "initialVolatility",
    label: "Initial volatility",
    ...limits.initialVolatility,
    help: "How much a performer's true rating is expected to drift between battles.",
  },
  { key: "tau", label: "Tau", ...limits.tau, help: "Limits how quickly volatility can change. Lower is steadier." },
];
function ParameterFields(props: { definitions: ParameterDefinition[] } & RankSettingsSectionProps) {
  return (
    <div className="dirty-rank-settings-grid">
      {props.definitions.map(definition => {
        const id = definition.id || "dirty-rank-" + definition.key;
        return (
          <Field id={id} key={definition.key} label={definition.label} help={definition.help}>
            <input
              className="form-control"
              id={id}
              min={definition.min}
              max={definition.max}
              step={definition.step}
              onChange={event => {
                const update: Partial<RankSettingsDraft> = {};
                Object.assign(update, { [definition.key]: Number(event.target.value) });
                props.changed!(update);
              }}
              type="number"
              value={props.draft[definition.key] as number | string}
            />
          </Field>
        );
      })}
    </div>
  );
}
export function RatingSettings(props: RankSettingsSectionProps) {
  const draft = props.draft;
  const changed = props.changed!;
  const busy = props.busy;
  const currentParameters = props.currentParameters!;
  const presetEstimate = props.presetEstimate;
  const estimateError = props.estimateError;
  const preset = ratingPresetFor(draft);
  return (
    <React.Fragment>
      <ui.SettingsSection
        title="Presets"
        description="Presets apply to future battles. Existing ratings and history are kept; starting values only affect unrated performers."
      >
        <div className="dirty-rank-preset-row">
          <div
            className="dirty-rank-data-tools d-flex flex-wrap align-items-center"
            role="group"
            aria-label="Rating presets"
          >
            {RATING_PRESETS.map(option => {
              const selected = preset === option;
              return (
                <RankButton
                  key={option.id}
                  disabled={busy}
                  pressed={selected}
                  tone={selected ? "primary" : "secondary"}
                  onClick={() => {
                    changed(option.settings);
                  }}
                >
                  {option.name}
                </RankButton>
              );
            })}
            <RankButton
              className="dirty-rank-preset-current"
              disabled={busy}
              title="Restore the advanced values from when this settings page was opened"
              onClick={() => {
                changed(currentParameters);
              }}
            >
              Undo changes
            </RankButton>
          </div>
          <span
            className="dirty-rank-preset-estimate"
            role="status"
            aria-live="polite"
            title="Fresh category for the gender box selected under Categories. Assumes informative close matchups until every performer reaches Refined; each battle updates two performers. Actual totals depend on results and matchmaking."
          >
            {presetEstimate
              ? (presetEstimate.capped ? "≥" : "") +
                presetEstimate.battles.toLocaleString() +
                " battles expected to rank 1 category for " +
                presetEstimate.performers.toLocaleString() +
                " performers"
              : estimateError
                ? "Battle estimate unavailable"
                : "Loading battle estimate…"}
          </span>
        </div>
        <p className="dirty-rank-advanced-copy" aria-live="polite">
          {preset ? preset.description : "Custom configuration. Choose a preset or adjust the values below."}
        </p>
      </ui.SettingsSection>
      <ui.SettingsSection title="Matchmaking" description="Soft preferences for choosing the next pair.">
        <ParameterFields definitions={MATCHMAKING_PARAMETERS} {...props} />
      </ui.SettingsSection>
      <ui.SettingsSection
        title="Rating model"
        description="Glicko-2 parameters. DirtyRank does not increase uncertainty during inactivity."
      >
        <ParameterFields definitions={RATING_PARAMETERS} {...props} />
      </ui.SettingsSection>
    </React.Fragment>
  );
}
