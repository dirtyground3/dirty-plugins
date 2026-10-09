import type { RankSettingsPanelDependencies, RankSettingsSectionProps } from "../../types";
export function createCategoryEditor(dependencies: Pick<RankSettingsPanelDependencies, "React" | "Fragment" | "Field" | "RankButton" | "Section" | "SharedIconButton" | "Toggle" | "boxFor" | "boxOptions">) {
  const { React, Fragment, Field, RankButton, Section, SharedIconButton, Toggle, boxFor, boxOptions } = dependencies;
  function CategoryEditor(props: RankSettingsSectionProps) {
    var draft = props.draft;
    var busy = props.busy;
    var saving = props.saving;
    var dirty = props.dirty;
    var editingCohort = props.editingCohort!;
    var editingCategories = props.editingCategories!;
    var setEditingCohort = props.setEditingCohort!;
    var categoryNameError = props.categoryNameError!;
    var updateCategory = props.updateCategory!;
    var moveCategory = props.moveCategory!;
    var removeCategory = props.removeCategory!;
    var addCategory = props.addCategory!;
    var resetCategoryPool = props.resetCategoryPool!;
    return (<Fragment>
      <Section
        title="Rating categories"
        description="Choose a gender box, then define its categories and their weights. Categories and ratings are independent between boxes.">
        {draft.genderBoxes.length > 1 && (<div className="dirty-rank-category-cohort">
          <Field id="dirty-rank-category-cohort" label="Categories for gender box">
            <select
              className="form-control"
              id="dirty-rank-category-cohort"
              onChange={function (event) { setEditingCohort(event.target.value); }}
              value={editingCohort}>
              {boxOptions(draft, false).map(function (item) {
                return (<option key={item[0]} value={item[0]}>
                  {item[1]}
                </option>);
              })}
            </select>
          </Field>
        </div>)}
        <div className="dirty-rank-category-list">
          {editingCategories.map(function (category, index) {
            return (<div className="dirty-rank-category-editor" key={editingCohort + ":" + category.id}>
              <div className="dirty-rank-category-toolbar d-flex flex-wrap align-items-center justify-content-between">
                <span className="dirty-rank-category-sex">
                  {boxFor(draft, editingCohort).name}
                </span>
                <div className="dirty-rank-data-tools d-flex flex-wrap align-items-center">
                  <RankButton
                    className="dirty-rank-category-reset"
                    disabled={busy || saving || dirty}
                    tone="danger"
                    title={"Reset ratings for " + boxFor(draft, editingCohort).name + " / " + category.name}
                    onClick={function () { resetCategoryPool(editingCohort, category); }}>
                    {"Reset ratings"}
                  </RankButton>
                  <SharedIconButton
                    ariaLabel="Move category up"
                    disabled={index === 0}
                    fallback="↑"
                    onClick={function () { moveCategory(index, -1); }} />
                  <SharedIconButton
                    ariaLabel="Move category down"
                    disabled={index === editingCategories.length - 1}
                    fallback="↓"
                    onClick={function () { moveCategory(index, 1); }} />
                  <SharedIconButton
                    ariaLabel="Remove category"
                    disabled={editingCategories.length <= 1}
                    fallback="×"
                    onClick={function () { removeCategory(index); }} />
                </div>
              </div>
              <div className="dirty-rank-category-basics">
                <Field
                  id={"dirty-rank-category-name-" + editingCohort + "-" + index}
                  label="Name"
                  error={categoryNameError(category, index)}>
                  <input
                    className="form-control"
                    id={"dirty-rank-category-name-" + editingCohort + "-" + index}
                    maxLength={80}
                    onChange={function (event) { updateCategory(index, { name: event.target.value }); }}
                    type="text"
                    value={category.name} />
                </Field>
                <Field
                  id={"dirty-rank-category-weight-" + editingCohort + "-" + index}
                  label="Overall weight"
                  error={String(category.weight).trim() && Number(category.weight) >= 0.01 && Number(category.weight) <= 1000
                    ? "" : "Enter a weight between 0.01 and 1000."}>
                  <input
                    className="form-control"
                    id={"dirty-rank-category-weight-" + editingCohort + "-" + index}
                    min={0.01}
                    max={1000}
                    step={0.1}
                    onChange={function (event) { updateCategory(index, { weight: event.target.value }); }}
                    type="number"
                    value={category.weight} />
                </Field>
              </div>
              <Field id={"dirty-rank-category-description-" + editingCohort + "-" + index} label="Description">
                <textarea
                  className="form-control"
                  id={"dirty-rank-category-description-" + editingCohort + "-" + index}
                  maxLength={500}
                  onChange={function (event) { updateCategory(index, { description: event.target.value }); }}
                  rows={2}
                  value={category.description} />
              </Field>
              <Toggle
                checked={category.enabled}
                label="Enable this category"
                onChange={function (value: boolean) { updateCategory(index, { enabled: value }); }} />
            </div>);
          })}
          <RankButton onClick={addCategory}>
            {"+ Add category"}
          </RankButton>
        </div>
      </Section>
    </Fragment>);
  }
  return CategoryEditor;
}
