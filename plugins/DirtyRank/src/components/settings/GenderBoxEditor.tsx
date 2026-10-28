import { COHORTS } from "../../constants";
import { boxOptions, parseEnabledCohorts } from "../../domain/settings";
import { React, ui } from "../../runtime";
import { Field, RankButton } from "../Primitives";
import type { RankSettingsSectionProps } from "../../types";
export function GenderBoxEditor(props: RankSettingsSectionProps) {
  const draft = props.draft;
  const changed = props.changed!;
  const setEditingCohort = props.setEditingCohort!;
  const toggleCohort = props.toggleCohort!;
  const updateBox = props.updateBox!;
  const addBox = props.addBox!;
  const removeBox = props.removeBox!;
  return (
    <React.Fragment>
      <ui.SettingsSection
        title="Gender boxes"
        description="Performers only battle and rank against others in the same box. Each box has its own categories and ratings. Renaming or adding genders keeps a box's ratings; new boxes start unrated."
      >
        <div className="dirty-rank-category-list">
          {draft.genderBoxes.map(box => {
            const nameError = !String(box.name || "").trim()
              ? "Enter a box name."
              : draft.genderBoxes.some(
                    other =>
                      other.id !== box.id &&
                      String(other.name || "")
                        .trim()
                        .toLowerCase() ===
                        String(box.name || "")
                          .trim()
                          .toLowerCase(),
                  )
                ? "Choose a unique box name."
                : "";
            return (
              <div className="dirty-rank-category-editor dirty-rank-box-editor" key={box.id} data-box-id={box.id}>
                <Field id={"dirty-rank-box-name-" + box.id} label="Box name" error={nameError}>
                  <input
                    className="form-control"
                    id={"dirty-rank-box-name-" + box.id}
                    value={box.name}
                    maxLength={80}
                    type="text"
                    onChange={event => {
                      updateBox(box.id, { name: event.target.value });
                    }}
                  />
                </Field>
                <fieldset className="dirty-rank-category-genders">
                  <legend>Genders in this box</legend>
                  <div className="dirty-rank-cohort-options">
                    {COHORTS.map(item => {
                      const checked = box.genders.indexOf(item[0]) !== -1;
                      return (
                        <ui.SettingsToggle
                          id={"dirty-rank-box-gender-" + box.id + "-" + item[0]}
                          key={item[0]}
                          label={item[1]}
                          checked={checked}
                          disabled={checked && box.genders.length === 1}
                          onChange={(value: boolean) => {
                            const genders = box.genders.filter(gender => gender !== item[0]);
                            if (value) genders.push(item[0]);
                            if (genders.length)
                              updateBox(box.id, { genders: parseEnabledCohorts(genders, box.genders) });
                          }}
                        />
                      );
                    })}
                  </div>
                </fieldset>
                <div className="dirty-rank-data-tools d-flex flex-wrap align-items-center">
                  <ui.SettingsToggle
                    checked={box.enabled}
                    label="Enable this box"
                    disabled={box.enabled && draft.enabledCohorts.length === 1}
                    onChange={(value: boolean) => {
                      toggleCohort(box.id, value);
                    }}
                  />
                  <RankButton
                    onClick={() => {
                      setEditingCohort(box.id);
                      props.showCategories?.();
                    }}
                  >
                    Edit categories
                  </RankButton>
                  <RankButton
                    disabled={draft.genderBoxes.length <= 1 || (box.enabled && draft.enabledCohorts.length === 1)}
                    onClick={() => {
                      removeBox(box.id);
                    }}
                    title="Remove this box from the options; its stored ratings are retained"
                  >
                    Remove box
                  </RankButton>
                </div>
              </div>
            );
          })}
        </div>
        <RankButton disabled={draft.genderBoxes.length >= 24} onClick={addBox}>
          + Add gender box
        </RankButton>
        {draft.enabledCohorts.length > 1 && (
          <div className="dirty-rank-settings-grid dirty-rank-settings-grid-compact" style={{ marginTop: "0.9rem" }}>
            <Field id="dirty-rank-default-cohort" label="Default gender box">
              <select
                className="form-control"
                id="dirty-rank-default-cohort"
                onChange={event => {
                  changed({ defaultCohort: event.target.value });
                }}
                value={draft.defaultCohort}
              >
                {boxOptions(draft, true).map(item => {
                  return (
                    <option key={item[0]} value={item[0]}>
                      {item[1]}
                    </option>
                  );
                })}
              </select>
            </Field>
          </div>
        )}
      </ui.SettingsSection>
    </React.Fragment>
  );
}
