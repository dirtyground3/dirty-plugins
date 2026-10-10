import { Field, RankButton } from "../Primitives";
import { RATING_PRESETS, ratingPresetFor } from "../../domain/settings";
import { React } from "../../runtime";
import { limits } from "@generated/dirtyRank.settings";
import type { RankSettingsDraft, RankSettingsSectionProps } from "../../types";
export function RatingSettings(props: RankSettingsSectionProps) {
  const draft = props.draft;
  const changed = props.changed!;
  const busy = props.busy;
  const currentParameters = props.currentParameters!;
  const presetEstimate = props.presetEstimate;
  const estimateError = props.estimateError;
  return (
    <React.Fragment>
      <details className="dirty-rank-advanced">
        <summary className="dirty-rank-advanced-summary">
          <span>Advanced configuration</span>
          <span className="dirty-rank-advanced-hint">Matchmaking and Glicko-2 parameters</span>
        </summary>
        <div className="dirty-rank-advanced-body">
          <div className="dirty-rank-preset-row">
            <div
              className="dirty-rank-data-tools d-flex flex-wrap align-items-center"
              role="group"
              aria-label="Rating presets"
            >
              <RankButton
                className="dirty-rank-preset-current"
                disabled={busy}
                tone="primary"
                title="Restore advanced values from when this settings page was opened"
                onClick={() => {
                  changed(currentParameters);
                }}
              >
                Current
              </RankButton>
              {RATING_PRESETS.map(preset => {
                const selected = ratingPresetFor(draft) === preset;
                return (
                  <RankButton
                    key={preset.id}
                    disabled={busy}
                    pressed={selected}
                    tone={selected ? "primary" : "secondary"}
                    onClick={() => {
                      changed(preset.settings);
                    }}
                  >
                    {preset.name}
                  </RankButton>
                );
              })}
            </div>
            <span
              className="dirty-rank-preset-estimate"
              role="status"
              aria-live="polite"
              title="Fresh category for the gender box selected under Rating categories. Assumes informative close matchups until every performer reaches Refined; each battle updates two performers. Actual totals depend on results and matchmaking. Parameters that do not change predicted uncertainty can leave the rounded total unchanged."
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
            {ratingPresetFor(draft)
              ? ratingPresetFor(draft)!.description
              : "Custom configuration. Choose a preset or adjust the values below."}
          </p>
          <p className="dirty-rank-advanced-copy">
            Presets save automatically and apply to future battles. Existing ratings and history are kept; starting
            values apply to unrated performers. Battle weight drives faster refinement; lower tau limits volatility
            changes. Recent-pair avoidance and calibration are soft matchmaking preferences. DirtyRank does not inflate
            uncertainty during inactivity.
          </p>
          <div className="dirty-rank-settings-grid">
            {[
              {
                key: "evidenceWeight",
                id: "dirty-rank-evidence-weight",
                label: "Evidence per battle",
                ...limits.evidenceWeight,
                help: "How strongly one comparison reduces uncertainty. 1.0 is standard Glicko-2; 2.0 treats a consistent subjective choice as twice the rating evidence while still recording one battle.",
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
                help: "Chance of favouring broader rating gaps. Lower values focus on the matchups expected to reduce uncertainty most.",
              },
              { key: "initialRating", label: "Initial rating", ...limits.initialRating },
              { key: "initialDeviation", label: "Initial deviation", ...limits.initialDeviation },
              { key: "initialVolatility", label: "Initial volatility", ...limits.initialVolatility },
              { key: "tau", label: "Tau", ...limits.tau },
              { key: "deviationFloor", label: "Deviation floor", ...limits.deviationFloor },
              { key: "provisionalDeviation", label: "Provisional threshold", ...limits.provisionalDeviation },
            ].map(
              (definition: {
                key: string;
                id?: string;
                label: string;
                help?: string;
                min: number;
                max: number;
                step?: number;
              }) => {
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
                        changed(update);
                      }}
                      type="number"
                      value={draft[definition.key as keyof RankSettingsDraft] as number | string}
                    />
                  </Field>
                );
              },
            )}
          </div>
        </div>
      </details>
    </React.Fragment>
  );
}
