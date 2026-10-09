import type * as R from "react";
import type { PanelProps } from "../../DirtyPlugins/src/types";
import { createCategoryEditor } from "./components/settings/CategoryEditor";
import { createGenderBoxEditor } from "./components/settings/GenderBoxEditor";
import { createPresentationSettings } from "./components/settings/PresentationSettings";
import { createRatingSettings } from "./components/settings/RatingSettings";
import type { RankCategory, RankGenderBox, RankPerformer, RankSettingsDraft, RankSettingsPanelDependencies } from "./types";
export function createSettingsPanel(dependencies: RankSettingsPanelDependencies) {
  const React = dependencies.React;
  var DEFAULT_CATEGORY_DEFINITIONS = dependencies.DEFAULT_CATEGORY_DEFINITIONS;
  var DirtyPlugins = dependencies.DirtyPlugins;
  var PLUGIN_ID = dependencies.PLUGIN_ID;
  var Section = dependencies.Section;
  var SettingsCard = dependencies.SettingsCard;
  var SharedSaveStatus = dependencies.SharedSaveStatus;
  var Toggle = dependencies.Toggle;
  var boxFor = dependencies.boxFor;
  var categoriesFor = dependencies.categoriesFor;
  var categoryEligible = dependencies.categoryEligible;
  var comparableSettings = dependencies.comparableSettings;
  var documentationCapture = dependencies.documentationCapture;
  var freshCategoryBattleEstimate = dependencies.freshCategoryBattleEstimate;
  var loadRatingIndex = dependencies.loadRatingIndex;
  var queryPerformers = dependencies.queryPerformers;
  var ratingParameters = dependencies.ratingParameters;
  var runOperation = dependencies.runOperation;
  var serializedSettings = dependencies.serializedSettings;
  var settingsFromConfiguration = dependencies.settingsFromConfiguration;
  var uniqueCategoryId = dependencies.uniqueCategoryId;
  var useEffect = dependencies.useEffect;
  var useMemo = dependencies.useMemo;
  var useRef = dependencies.useRef;
  var useState = dependencies.useState;
  var validateSettings = dependencies.validateSettings;

  const GenderBoxEditor = createGenderBoxEditor(dependencies);
  const PresentationSettings = createPresentationSettings(dependencies);
  const CategoryEditor = createCategoryEditor(dependencies);
  const RatingSettings = createRatingSettings(dependencies);
  function DirtyRankSettings(props: PanelProps) {
    if (!SettingsCard || !Section || !Toggle) return null;
    var currentParametersState = useState(function () { return ratingParameters(settingsFromConfiguration(props.configuration)); });
    var currentParameters = currentParametersState[0];
    var setCurrentParameters = currentParametersState[1];
    var estimatePerformersState = useState<RankPerformer[] | null>(null);
    var estimatePerformers = estimatePerformersState[0];
    var setEstimatePerformers = estimatePerformersState[1];
    var estimateErrorState = useState(false);
    var estimateError = estimateErrorState[0];
    var setEstimateError = estimateErrorState[1];
    var editingCohortState = useState(function () {
      return settingsFromConfiguration(props.configuration).defaultCohort;
    });
    var editingCohort = editingCohortState[0];
    var setEditingCohort = editingCohortState[1];
    var busyState = useState(false);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var statusState = useState("");
    var localStatus = statusState[0];
    var setStatus = statusState[1];
    var errorState = useState("");
    var localError = errorState[0];
    var setError = errorState[1];
    var settingsRevisionRef = useRef<number | null | undefined>(null);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const control = DirtyPlugins.react.useSettingsDraft<RankSettingsDraft, import("./types").RankOperationResult, Record<string, unknown>, import("./types").RankOperationResult>({
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
    var presetEstimate = useMemo(function () {
      if (!estimatePerformers) return null;
      var category = { enabled: true };
      var count = estimatePerformers.filter(function (performer) {
        return categoryEligible(performer, category, draft, editingCohort);
      }).length;
      return freshCategoryBattleEstimate(count, draft);
    }, [draft, editingCohort, estimatePerformers]);

    useEffect(function () {
      var cancelled = false;
      queryPerformers().then(function (values) {
        if (!cancelled) setEstimatePerformers(values);
      }).catch(function () { if (!cancelled) setEstimateError(true); });
      return function () { cancelled = true; };
    }, []);

    function changed(update: Partial<RankSettingsDraft>) {
      setDraft(function (current) { return Object.assign({}, current, update); });
      setStatus("");
      setError("");
    }

    function toggleCohort(cohort: string, enabled: boolean) {
      if (!enabled && draft.enabledCohorts.length === 1 && draft.enabledCohorts[0] === cohort) return;
      updateBox(cohort, { enabled: enabled });
    }

    function changeBoxes(transform: (boxes: RankGenderBox[]) => RankGenderBox[]) {
      setDraft(function (current) {
        var boxes = transform(current.genderBoxes);
        var enabledCohorts = boxes.filter(function (box) { return box.enabled; }).map(function (box) { return box.id; });
        var defaultCohort = enabledCohorts.indexOf(current.defaultCohort) !== -1
          ? current.defaultCohort
          : enabledCohorts[0];
        return Object.assign({}, current, { genderBoxes: boxes, defaultCohort: defaultCohort, enabledCohorts: enabledCohorts });
      });
      setStatus("");
      setError("");
    }

    function updateBox(id: string, update: Partial<RankGenderBox>) {
      changeBoxes(function (boxes) {
        return boxes.map(function (box) {
          return box.id === id ? Object.assign({}, box, update) : box;
        });
      });
    }

    function addBox() {
      var used = new Set(Object.keys(draft.categoriesByCohort).concat(draft.genderBoxes.map(function (box) { return box.id; })));
      var index = 1;
      while (used.has("BOX-" + index)) index += 1;
      var id = "BOX-" + index;
      var names = new Set(draft.genderBoxes.map(function (box) { return box.name.toLowerCase(); }));
      var name = "Box " + index;
      while (names.has(name.toLowerCase())) { index += 1; name = "Box " + index; }
      setDraft(function (current) {
        var categories = Object.assign({}, current.categoriesByCohort);
        categories[id] = DEFAULT_CATEGORY_DEFINITIONS.map(function (category) { return Object.assign({}, category); });
        return Object.assign({}, current, {
          categoriesByCohort: categories,
          genderBoxes: current.genderBoxes.concat([{ id: id, name: name, genders: ["FEMALE"], enabled: true }]),
          enabledCohorts: current.enabledCohorts.concat([id])
        });
      });
      setEditingCohort(id);
      setStatus("");
      setError("");
    }

    function removeBox(id: string) {
      var box = boxFor(draft, id);
      if (draft.genderBoxes.length <= 1 || (box.enabled && draft.enabledCohorts.length === 1)) return;
      if (editingCohort === id) setEditingCohort(draft.genderBoxes.find(function (other) { return other.id !== id; })!.id);
      // Keep category definitions as well as rating rows, and never reuse their IDs.
      changeBoxes(function (boxes) { return boxes.filter(function (other) { return other.id !== id; }); });
    }

    function changeCategories(transform: (categories: RankCategory[]) => RankCategory[]) {
      setDraft(function (current) {
        var nextByCohort = Object.assign({}, current.categoriesByCohort);
        var currentCategories = (nextByCohort[editingCohort] || []).slice();
        nextByCohort[editingCohort] = transform(currentCategories);
        return Object.assign({}, current, { categoriesByCohort: nextByCohort });
      });
      setStatus("");
      setError("");
    }

    function updateCategory(index: number, update: Partial<RankCategory>) {
      changeCategories(function (categories) {
        return categories.map(function (category, categoryIndex) {
          return categoryIndex === index ? Object.assign({}, category, update) : category;
        });
      });
    }

    function moveCategory(index: number, direction: number) {
      changeCategories(function (categories) {
        var target = index + direction;
        if (target < 0 || target >= categories.length) return categories;
        var moved = categories.splice(index, 1)[0];
        categories.splice(target, 0, moved);
        return categories;
      });
    }

    function addCategory() {
      changeCategories(function (categories) {
        var ids = new Set(["overall"].concat(categories.map(function (category) { return category.id; })));
        return categories.concat([{
          id: uniqueCategoryId("New category", ids),
          name: "New category",
          description: "",
          enabled: true,
          weight: 1,
        }]);
      });
    }

    function removeCategory(index: number) {
      changeCategories(function (categories) {
        if (categories.length <= 1) return categories;
        return categories.filter(function (_item, itemIndex) { return itemIndex !== index; });
      });
    }

    function resetCategoryPool(cohort: string, category: RankCategory) {
      if (busy) return;
      if (dirty || saving) { setError("Wait for the automatic save before resetting a category."); return; }
      var target = boxFor(draft, cohort).name + " / " + category.name;
      if (!window.confirm("Reset all ratings and battle history for " + target + "? Other categories and gender boxes are kept. Use the General settings backup if you need to restore them later.")) return;
      setBusy(true);
      setError("");
      setStatus("Resetting " + target + "…");
      runOperation({
        mode: "resetPool",
        categoryId: category.id,
        cohort: cohort,
        confirm: "RESET",
      }).then(function (result) {
        return loadRatingIndex().then(function () {
          if (!mounted.current) return;
          setStatus("Reset " + target + ": " + result.reset + " rating(s).");
          DirtyPlugins.ui.notify("DirtyRank reset " + target + ": " + result.reset + " rating(s).");
        });
      }).catch(function (caught) { if (mounted.current) { setError(caught.message || String(caught)); setStatus(""); } })
        .finally(function () { if (mounted.current) setBusy(false); });
    }

    var editingCategories = categoriesFor(draft, editingCohort);

    function categoryNameError(category: RankCategory, index: number) {
      var name = String(category.name || "").trim().toLowerCase();
      if (!name) return "Enter a category name.";
      if (editingCategories.some(function (other, otherIndex) {
        return otherIndex !== index && String(other.name || "").trim().toLowerCase() === name;
      })) return "Use a unique name for this performer sex.";
      return "";
    }

    var visibleStatus = documentationCapture()
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
