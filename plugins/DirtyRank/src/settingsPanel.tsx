import type * as R from "react";
import type { PanelProps } from "../../DirtyPlugins/src/types";
import { createCategoryEditor } from "./components/settings/CategoryEditor";
import { createGenderBoxEditor } from "./components/settings/GenderBoxEditor";
import { createPresentationSettings } from "./components/settings/PresentationSettings";
import { createRatingSettings } from "./components/settings/RatingSettings";
import type { RankCategory, RankGenderBox, RankOperationResult, RankPerformer, RankSettingsDraft, RankSettingsPanelDependencies } from "./types";
export function createSettingsPanel(dependencies: RankSettingsPanelDependencies) {
  const {
    React, DEFAULT_CATEGORY_DEFINITIONS, DirtyPlugins, PLUGIN_ID, Section, SettingsCard, SharedSaveStatus, Toggle, boxFor,
    categoriesFor, categoryEligible, comparableSettings, documentationCapture, freshCategoryBattleEstimate, loadRatingIndex,
    queryPerformers, ratingParameters, runOperation, serializedSettings, settingsFromConfiguration, uniqueCategoryId,
    useEffect, useMemo, useRef, useState, validateSettings,
  } = dependencies;

  const GenderBoxEditor = createGenderBoxEditor(dependencies);
  const PresentationSettings = createPresentationSettings(dependencies);
  const CategoryEditor = createCategoryEditor(dependencies);
  const RatingSettings = createRatingSettings(dependencies);
  function DirtyRankSettings(props: PanelProps) {
    if (!SettingsCard || !Section || !Toggle) return null;
    const [currentParameters, setCurrentParameters] = useState(() => ratingParameters(settingsFromConfiguration(props.configuration)));
    const [estimatePerformers, setEstimatePerformers] = useState<RankPerformer[] | null>(null);
    const [estimateError, setEstimateError] = useState(false);
    const [editingCohort, setEditingCohort] = useState(() => settingsFromConfiguration(props.configuration).defaultCohort);
    const [busy, setBusy] = useState(false);
    const [localStatus, setStatus] = useState("");
    const [localError, setError] = useState("");
    const settingsRevisionRef = useRef<number | null | undefined>(null);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const control = DirtyPlugins.react.useSettingsDraft<RankSettingsDraft, RankOperationResult, Record<string, unknown>, RankOperationResult>({
      initialValue: settingsFromConfiguration(props.configuration),
      load: () => runOperation({ mode: "getSettings" }).catch(() => ({ settings: props.configuration })),
      normalize: result => settingsFromConfiguration(result.settings),
      validate: validateSettings, comparable: comparableSettings, serialize: serializedSettings, delay: 350,
      onLoaded: (result, loaded) => {
        settingsRevisionRef.current = result.revision ?? null;
        setCurrentParameters(ratingParameters(loaded)); setEditingCohort(loaded.defaultCohort);
      },
      save: async settings => {
        if (settingsRevisionRef.current === null) settingsRevisionRef.current = (await runOperation({ mode: "getSettings" })).revision;
        const result = await runOperation({ mode: "saveSettings", settings, expectedRevision: settingsRevisionRef.current });
        settingsRevisionRef.current = result.revision; return result;
      },
      onSaved: (_draft, result, current) => {
        if (current) {
          control.setDraft(settingsFromConfiguration(result.settings));
          DirtyPlugins.notifyConfigurationChanged(PLUGIN_ID, { preserveSettingsPage: true });
        }
      },
      onDirtyChange: dirty => props.onDirtyChange?.(PLUGIN_ID, dirty),
    });
    const draft = control.draft, dirty = control.dirty, saving = dirty && control.status.state === "saving";
    const setDraft: R.Dispatch<R.SetStateAction<RankSettingsDraft>> = update => {
      control.setDraft(update); if (control.status.state === "error") control.retry();
    };
    const error = localError || control.error;
    // React 17 may render the normalized saved draft before the controller's
    // final status callback. A matching accepted baseline is already saved.
    const status = localStatus || (control.ready && !dirty ? "Saved automatically."
      : control.status.state === "pending" ? "Waiting to save automatically…"
      : saving ? "Saving automatically…" : control.status.state === "saved" ? "Saved automatically." : "");
    const presetEstimate = useMemo(() => {
      if (!estimatePerformers) return null;
      const category = { enabled: true };
      const count = estimatePerformers.filter(performer => categoryEligible(performer, category, draft, editingCohort)).length;
      return freshCategoryBattleEstimate(count, draft);
    }, [draft, editingCohort, estimatePerformers]);

    useEffect(() => {
      let cancelled = false;
      queryPerformers().then(values => {
        if (!cancelled) setEstimatePerformers(values);
      }).catch(() => { if (!cancelled) setEstimateError(true); });
      return () => { cancelled = true; };
    }, []);

    /** Every edit clears the previous operation's status or error. */
    function edit(update: (current: RankSettingsDraft) => RankSettingsDraft) {
      setDraft(update);
      setStatus("");
      setError("");
    }

    function changed(update: Partial<RankSettingsDraft>) {
      edit(current => Object.assign({}, current, update));
    }

    function toggleCohort(cohort: string, enabled: boolean) {
      if (!enabled && draft.enabledCohorts.length === 1 && draft.enabledCohorts[0] === cohort) return;
      updateBox(cohort, { enabled });
    }

    function changeBoxes(transform: (boxes: RankGenderBox[]) => RankGenderBox[]) {
      edit(current => {
        const boxes = transform(current.genderBoxes);
        const enabledCohorts = boxes.filter(box => box.enabled).map(box => box.id);
        const defaultCohort = enabledCohorts.indexOf(current.defaultCohort) !== -1 ? current.defaultCohort : enabledCohorts[0];
        return Object.assign({}, current, { genderBoxes: boxes, defaultCohort, enabledCohorts });
      });
    }

    function updateBox(id: string, update: Partial<RankGenderBox>) {
      changeBoxes(boxes => boxes.map(box => box.id === id ? Object.assign({}, box, update) : box));
    }

    function addBox() {
      const used = new Set(Object.keys(draft.categoriesByCohort).concat(draft.genderBoxes.map(box => box.id)));
      let index = 1;
      while (used.has("BOX-" + index)) index += 1;
      const id = "BOX-" + index;
      const names = new Set(draft.genderBoxes.map(box => box.name.toLowerCase()));
      let name = "Box " + index;
      while (names.has(name.toLowerCase())) { index += 1; name = "Box " + index; }
      edit(current => Object.assign({}, current, {
        categoriesByCohort: { ...current.categoriesByCohort, [id]: DEFAULT_CATEGORY_DEFINITIONS.map(category => Object.assign({}, category)) },
        genderBoxes: current.genderBoxes.concat([{ id, name, genders: ["FEMALE"], enabled: true }]),
        enabledCohorts: current.enabledCohorts.concat([id]),
      }));
      setEditingCohort(id);
    }

    function removeBox(id: string) {
      const box = boxFor(draft, id);
      if (draft.genderBoxes.length <= 1 || (box.enabled && draft.enabledCohorts.length === 1)) return;
      if (editingCohort === id) setEditingCohort(draft.genderBoxes.find(other => other.id !== id)!.id);
      // Keep category definitions as well as rating rows, and never reuse their IDs.
      changeBoxes(boxes => boxes.filter(other => other.id !== id));
    }

    function changeCategories(transform: (categories: RankCategory[]) => RankCategory[]) {
      edit(current => Object.assign({}, current, {
        categoriesByCohort: { ...current.categoriesByCohort, [editingCohort]: transform((current.categoriesByCohort[editingCohort] || []).slice()) },
      }));
    }

    function updateCategory(index: number, update: Partial<RankCategory>) {
      changeCategories(categories => categories.map((category, categoryIndex) => categoryIndex === index ? Object.assign({}, category, update) : category));
    }

    function moveCategory(index: number, direction: number) {
      changeCategories(categories => {
        const target = index + direction;
        if (target < 0 || target >= categories.length) return categories;
        const moved = categories.splice(index, 1)[0];
        categories.splice(target, 0, moved);
        return categories;
      });
    }

    function addCategory() {
      changeCategories(categories => {
        const ids = new Set(["overall"].concat(categories.map(category => category.id)));
        return categories.concat([{ id: uniqueCategoryId("New category", ids), name: "New category", description: "", enabled: true, weight: 1 }]);
      });
    }

    function removeCategory(index: number) {
      changeCategories(categories => categories.length <= 1 ? categories : categories.filter((_item, itemIndex) => itemIndex !== index));
    }

    function resetCategoryPool(cohort: string, category: RankCategory) {
      if (busy) return;
      if (dirty || saving) { setError("Wait for the automatic save before resetting a category."); return; }
      const target = boxFor(draft, cohort).name + " / " + category.name;
      if (!window.confirm("Reset all ratings and battle history for " + target + "? Other categories and gender boxes are kept. Use the General settings backup if you need to restore them later.")) return;
      setBusy(true);
      setError("");
      setStatus("Resetting " + target + "…");
      runOperation({ mode: "resetPool", categoryId: category.id, cohort, confirm: "RESET" }).then(result => loadRatingIndex().then(() => {
        if (!mounted.current) return;
        setStatus("Reset " + target + ": " + result.reset + " rating(s).");
        DirtyPlugins.ui.notify("DirtyRank reset " + target + ": " + result.reset + " rating(s).");
      })).catch(caught => { if (mounted.current) { setError(caught.message || String(caught)); setStatus(""); } })
        .finally(() => { if (mounted.current) setBusy(false); });
    }

    const editingCategories = categoriesFor(draft, editingCohort);

    function categoryNameError(category: RankCategory, index: number) {
      const name = String(category.name || "").trim().toLowerCase();
      if (!name) return "Enter a category name.";
      if (editingCategories.some((other, otherIndex) => otherIndex !== index && String(other.name || "").trim().toLowerCase() === name)) return "Use a unique name for this performer sex.";
      return "";
    }

    const visibleStatus = documentationCapture()
      ? error ? "Operation failed; details hidden in documentation mode."
        : status.indexOf("Backup created:") === 0 ? "Backup created; path hidden in documentation mode." : status
      : error || status;

    return (<SettingsCard
      className="dirty-rank-settings-card dirty-ui-pilot"
      bodyClassName="dirty-rank-settings-body"
      plugin={props.plugin}
      footer={(<div className="card-footer dirty-plugins-card-footer dirty-rank-settings-actions">
        <SharedSaveStatus
          className="dirty-rank-settings-status"
          message={visibleStatus || (dirty ? "Waiting to save automatically…" : "")}
          state={error ? "error" : busy || saving ? "saving" : dirty ? "pending" : "saved"} />
      </div>)}>
      <GenderBoxEditor
        draft={draft}
        changed={changed}
        setEditingCohort={setEditingCohort}
        toggleCohort={toggleCohort}
        updateBox={updateBox}
        addBox={addBox}
        removeBox={removeBox} />
      <PresentationSettings draft={draft} changed={changed} />
      <CategoryEditor
        draft={draft}
        busy={busy}
        saving={saving}
        dirty={dirty}
        editingCohort={editingCohort}
        editingCategories={editingCategories}
        setEditingCohort={setEditingCohort}
        categoryNameError={categoryNameError}
        updateCategory={updateCategory}
        moveCategory={moveCategory}
        removeCategory={removeCategory}
        addCategory={addCategory}
        resetCategoryPool={resetCategoryPool} />
      <RatingSettings
        draft={draft}
        changed={changed}
        busy={busy}
        currentParameters={currentParameters}
        presetEstimate={presetEstimate}
        estimateError={estimateError} />
    </SettingsCard>);
  }
  return DirtyRankSettings;
}
