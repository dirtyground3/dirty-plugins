import { Field, RankButton } from "../Primitives";
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
const RATING_PARAMETERS: ParameterDefinition[] = [
  {
    key: "evidenceWeight",
    id: "dirty-rank-evidence-weight",
    label: "Evidence per verdict",
    ...limits.evidenceWeight,
    help: "How much one verdict counts. 1 treats each verdict as one comparison. Lower it if your verdicts often change, so ratings claim less certainty.",
  },
  {
    key: "provisionalDeviation",
    label: "Provisional threshold (RD)",
    ...limits.provisionalDeviation,
    help: "A rating counts as settled (Refined) once its deviation is at or below this, and Excellent at 60% of it. Lower values need more verdicts.",
  },
  {
    key: "initialRating",
    label: "Initial rating",
    ...limits.initialRating,
    help: "Rating of a performer with no verdicts yet. It only shifts the scale.",
  },
  {
    key: "initialDeviation",
    label: "Initial deviation",
    ...limits.initialDeviation,
    help: "Uncertainty of a performer with no verdicts yet, and how far apart performers are expected to be.",
  },
  {
    key: "deviationFloor",
    label: "Deviation floor",
    ...limits.deviationFloor,
    help: "Ratings never claim more precision than this.",
  },
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
  const changed = props.changed!;
  const busy = props.busy;
  const currentParameters = props.currentParameters!;
  const presetEstimate = props.presetEstimate;
  const estimateError = props.estimateError;
  return (
    <React.Fragment>
      <ui.SettingsSection
        title="Rating model"
        description="Ratings are fitted to every verdict at once, so changes here apply to all past verdicts too. Each category also learns where your slightly, better and much better begin."
      >
        <div className="dirty-rank-preset-row">
          <div className="dirty-rank-data-tools d-flex flex-wrap align-items-center">
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
            title="Fresh category for the gender box selected under Categories. Assumes informative close matchups until every performer reaches Refined; each verdict updates two performers. Actual totals depend on your verdicts and matchmaking."
          >
            {presetEstimate
              ? (presetEstimate.capped ? "≥" : "") +
                presetEstimate.battles.toLocaleString() +
                " verdicts expected to rank 1 category for " +
                presetEstimate.performers.toLocaleString() +
                " performers"
              : estimateError
                ? "Verdict estimate unavailable"
                : "Loading verdict estimate…"}
          </span>
        </div>
        <ParameterFields definitions={RATING_PARAMETERS} {...props} />
      </ui.SettingsSection>
    </React.Fragment>
  );
}
