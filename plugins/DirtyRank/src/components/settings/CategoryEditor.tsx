import { Field, RankButton } from "../Primitives";
import { boxFor, boxOptions } from "../../domain/settings";
import { React, ui } from "../../runtime";
import type { RankSettingsSectionProps } from "../../types";
export function CategoryEditor(props: RankSettingsSectionProps) {
  const { draft, busy, saving, dirty } = props;
  const editingCohort = props.editingCohort!;
  const editingCategories = props.editingCategories!;
  const setEditingCohort = props.setEditingCohort!;
  const categoryNameError = props.categoryNameError!;
  const updateCategory = props.updateCategory!;
  const moveCategory = props.moveCategory!;
  const removeCategory = props.removeCategory!;
  const addCategory = props.addCategory!;
  const resetCategoryPool = props.resetCategoryPool!;
  return (
    <React.Fragment>
      <ui.SettingsSection
        title="Rating categories"
        description="Choose a gender box, then define its categories and their weights. Categories and ratings are independent between boxes."
      >
        {draft.genderBoxes.length > 1 && (
          <div className="dirty-rank-category-cohort">
            <Field id="dirty-rank-category-cohort" label="Categories for gender box">
              <select
                className="form-control"
                id="dirty-rank-category-cohort"
                onChange={event => {
                  setEditingCohort(event.target.value);
                }}
                value={editingCohort}
              >
                {boxOptions(draft, false).map(item => {
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
        <div className="dirty-rank-category-list">
          {editingCategories.map((category, index) => {
            return (
              <div className="dirty-rank-category-editor" key={editingCohort + ":" + category.id}>
                <div className="dirty-rank-category-toolbar d-flex flex-wrap align-items-center justify-content-between">
                  <span className="dirty-rank-category-sex">{boxFor(draft, editingCohort).name}</span>
                  <div className="dirty-rank-data-tools d-flex flex-wrap align-items-center">
                    <RankButton
                      className="dirty-rank-category-reset"
                      disabled={busy || saving || dirty}
                      tone="danger"
                      title={"Reset ratings for " + boxFor(draft, editingCohort).name + " / " + category.name}
                      onClick={() => {
                        resetCategoryPool(editingCohort, category);
                      }}
                    >
                      Reset ratings
                    </RankButton>
                    <ui.IconButton
                      ariaLabel="Move category up"
                      disabled={index === 0}
                      fallback="↑"
                      onClick={() => {
                        moveCategory(index, -1);
                      }}
                    />
                    <ui.IconButton
                      ariaLabel="Move category down"
                      disabled={index === editingCategories.length - 1}
                      fallback="↓"
                      onClick={() => {
                        moveCategory(index, 1);
                      }}
                    />
                    <ui.IconButton
                      ariaLabel="Remove category"
                      disabled={editingCategories.length <= 1}
                      fallback="×"
                      onClick={() => {
                        removeCategory(index);
                      }}
                    />
                  </div>
                </div>
                <div className="dirty-rank-category-basics">
                  <Field
                    id={"dirty-rank-category-name-" + editingCohort + "-" + index}
                    label="Name"
                    error={categoryNameError(category, index)}
                  >
                    <input
                      className="form-control"
                      id={"dirty-rank-category-name-" + editingCohort + "-" + index}
                      maxLength={80}
                      onChange={event => {
                        updateCategory(index, { name: event.target.value });
                      }}
                      type="text"
                      value={category.name}
                    />
                  </Field>
                  <Field
                    id={"dirty-rank-category-weight-" + editingCohort + "-" + index}
                    label="Overall weight"
                    error={
                      String(category.weight).trim() &&
                      Number(category.weight) >= 0.01 &&
                      Number(category.weight) <= 1000
                        ? ""
                        : "Enter a weight between 0.01 and 1000."
                    }
                  >
                    <input
                      className="form-control"
                      id={"dirty-rank-category-weight-" + editingCohort + "-" + index}
                      min={0.01}
                      max={1000}
                      step={0.1}
                      onChange={event => {
                        updateCategory(index, { weight: event.target.value });
                      }}
                      type="number"
                      value={category.weight}
                    />
                  </Field>
                </div>
                <Field id={"dirty-rank-category-description-" + editingCohort + "-" + index} label="Description">
                  <textarea
                    className="form-control"
                    id={"dirty-rank-category-description-" + editingCohort + "-" + index}
                    maxLength={500}
                    onChange={event => {
                      updateCategory(index, { description: event.target.value });
                    }}
                    rows={2}
                    value={category.description}
                  />
                </Field>
                <ui.SettingsToggle
                  checked={category.enabled}
                  label="Enable this category"
                  onChange={(value: boolean) => {
                    updateCategory(index, { enabled: value });
                  }}
                />
              </div>
            );
          })}
          <RankButton onClick={addCategory}>+ Add category</RankButton>
        </div>
      </ui.SettingsSection>
    </React.Fragment>
  );
}
