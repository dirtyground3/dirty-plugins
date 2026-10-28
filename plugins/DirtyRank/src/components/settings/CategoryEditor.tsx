import { Field, RankButton } from "../Primitives";
import { boxFor, boxOptions } from "../../domain/settings";
import { React, ui } from "../../runtime";
import type { RankCategory, RankSettingsSectionProps } from "../../types";
function validWeight(weight: unknown) {
  return String(weight).trim() !== "" && Number(weight) >= 0.01 && Number(weight) <= 1000;
}
/** Each enabled category's share of the overall score, as a whole percentage. */
function weightShare(category: RankCategory, categories: RankCategory[]) {
  if (!category.enabled || !validWeight(category.weight)) return "—";
  const total = categories
    .filter(other => other.enabled && validWeight(other.weight))
    .reduce((sum, other) => sum + Number(other.weight), 0);
  return Math.round((100 * Number(category.weight)) / total) + "%";
}
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
  const boxName = boxFor(draft, editingCohort).name;
  return (
    <ui.SettingsSection
      title="Rating categories"
      description="Each category is a separate battle and leaderboard. The weight sets how much it counts towards the overall score. Renaming keeps its ratings."
    >
      {draft.genderBoxes.length > 1 && (
        <div className="dirty-rank-category-cohort">
          <Field id="dirty-rank-category-cohort" label="Gender box">
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
      <div className="dirty-rank-category-list dirty-rank-category-rows" role="list">
        <div className="dirty-rank-category-main dirty-rank-category-heading" aria-hidden="true">
          <span>On</span>
          <span>Name</span>
          <span>Weight</span>
          <span title="Share of the overall score among enabled categories">Share</span>
          <span />
        </div>
        {editingCategories.map((category, index) => {
          const idSuffix = editingCohort + "-" + index;
          return (
            <div
              className={"dirty-rank-category-row" + (category.enabled ? "" : " dirty-rank-category-off")}
              key={editingCohort + ":" + category.id}
              role="listitem"
            >
              <div className="dirty-rank-category-main">
                <ui.SettingsToggle
                  checked={category.enabled}
                  className="dirty-rank-category-enabled"
                  label={
                    <span className="dirty-rank-visually-hidden">{"Enable " + (category.name || "category")}</span>
                  }
                  onChange={(value: boolean) => {
                    updateCategory(index, { enabled: value });
                  }}
                />
                <Field
                  className="dirty-rank-compact-field"
                  id={"dirty-rank-category-name-" + idSuffix}
                  label="Name"
                  error={categoryNameError(category, index)}
                >
                  <input
                    className="form-control"
                    id={"dirty-rank-category-name-" + idSuffix}
                    maxLength={80}
                    onChange={event => {
                      updateCategory(index, { name: event.target.value });
                    }}
                    type="text"
                    value={category.name}
                  />
                </Field>
                <Field
                  className="dirty-rank-compact-field"
                  id={"dirty-rank-category-weight-" + idSuffix}
                  label="Weight"
                  error={validWeight(category.weight) ? "" : "Enter a weight between 0.01 and 1000."}
                >
                  <input
                    className="form-control"
                    id={"dirty-rank-category-weight-" + idSuffix}
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
                <span className="dirty-rank-category-share" title="Share of the overall score">
                  {weightShare(category, editingCategories)}
                </span>
                <div className="dirty-rank-data-tools d-flex align-items-center">
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
                </div>
              </div>
              <details className="dirty-rank-category-more">
                <summary>{category.description ? category.description : "Description, reset and remove"}</summary>
                <div className="dirty-rank-category-more-body">
                  <Field id={"dirty-rank-category-description-" + idSuffix} label="Description">
                    <textarea
                      className="form-control"
                      id={"dirty-rank-category-description-" + idSuffix}
                      maxLength={500}
                      onChange={event => {
                        updateCategory(index, { description: event.target.value });
                      }}
                      rows={2}
                      value={category.description}
                    />
                  </Field>
                  <div className="dirty-rank-data-tools d-flex flex-wrap align-items-center">
                    <RankButton
                      className="dirty-rank-category-reset"
                      disabled={busy || saving || dirty}
                      tone="danger"
                      title={"Delete all ratings and battle history for " + boxName + " / " + category.name}
                      onClick={() => {
                        resetCategoryPool(editingCohort, category);
                      }}
                    >
                      Reset ratings
                    </RankButton>
                    <RankButton
                      disabled={editingCategories.length <= 1}
                      title="Remove this category from battles and leaderboards"
                      onClick={() => {
                        removeCategory(index);
                      }}
                    >
                      Remove category
                    </RankButton>
                  </div>
                </div>
              </details>
            </div>
          );
        })}
        <RankButton onClick={addCategory}>+ Add category</RankButton>
      </div>
    </ui.SettingsSection>
  );
}
