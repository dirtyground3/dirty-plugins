import { PLUGIN_ID } from "./constants";
import { freshCategoryBattleEstimate } from "./domain/matchmaking";
import { categoryEligible, loadRatingIndex, queryPerformers, runOperation } from "./domain/rank";
import {
  DEFAULT_CATEGORY_DEFINITIONS,
  boxFor,
  categoriesFor,
  comparableSettings,
  ratingParameters,
  serializedSettings,
  settingsFromConfiguration,
  uniqueCategoryId,
  validateSettings,
} from "./domain/settings";
import { DirtyPlugins, React, documentationCapture, ui } from "./runtime";
import type * as R from "react";
import type { PanelProps } from "../../DirtyPlugins/src/types";
import { CategoryEditor } from "./components/settings/CategoryEditor";
import { GenderBoxEditor } from "./components/settings/GenderBoxEditor";
import {
  BattleSettings,
  LeaderboardSettings,
  OverallScoringSettings,
} from "./components/settings/PresentationSettings";
import { RatingSettings } from "./components/settings/RatingSettings";
import type { RankCategory, RankGenderBox, RankOperationResult, RankPerformer, RankSettingsDraft } from "./types";

export function DirtyRankSettings(props: PanelProps) {
  if (!ui.SettingsCard || !ui.SettingsSection || !ui.SettingsToggle) return null;
  const [currentParameters, setCurrentParameters] = React.useState(() =>
    ratingParameters(settingsFromConfiguration(props.configuration)),
  );
  const [estimatePerformers, setEstimatePerformers] = React.useState<RankPerformer[] | null>(null);
  const [estimateError, setEstimateError] = React.useState(false);
  const [editingCohort, setEditingCohort] = React.useState(
    () => settingsFromConfiguration(props.configuration).defaultCohort,
  );
  const [tab, setTab] = React.useState(storedSettingsTab);
  const selectTab = (next: SettingsTab) => {
    setTab(next);
    try {
      window.localStorage?.setItem(SETTINGS_TAB_STORAGE_KEY, next);
    } catch {
      // The remembered tab is only a convenience.
    }
  };
  const [busy, setBusy] = React.useState(false);
  const [localStatus, setStatus] = React.useState("");
  const [localError, setError] = React.useState("");
  const settingsRevisionRef = React.useRef<number | null | undefined>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const control = DirtyPlugins.react.useSettingsDraft<
    RankSettingsDraft,
    RankOperationResult,
    Record<string, unknown>,
    RankOperationResult
  >({
    initialValue: settingsFromConfiguration(props.configuration),
    load: () => runOperation({ mode: "getSettings" }).catch(() => ({ settings: props.configuration })),
    normalize: result => settingsFromConfiguration(result.settings),
    validate: validateSettings,
    comparable: comparableSettings,
    serialize: serializedSettings,
    delay: 350,
    onLoaded: (result, loaded) => {
      settingsRevisionRef.current = result.revision ?? null;
      setCurrentParameters(ratingParameters(loaded));
      setEditingCohort(loaded.defaultCohort);
    },
    save: async settings => {
      if (settingsRevisionRef.current === null)
        settingsRevisionRef.current = (await runOperation({ mode: "getSettings" })).revision;
      const result = await runOperation({
        mode: "saveSettings",
        settings,
        expectedRevision: settingsRevisionRef.current,
      });
      settingsRevisionRef.current = result.revision;
      return result;
    },
    onSaved: (_draft, result, current) => {
      if (current) {
        control.setDraft(settingsFromConfiguration(result.settings));
        DirtyPlugins.notifyConfigurationChanged(PLUGIN_ID, { preserveSettingsPage: true });
      }
    },
    onDirtyChange: dirty => props.onDirtyChange?.(PLUGIN_ID, dirty),
  });
  const draft = control.draft,
    dirty = control.dirty,
    saving = dirty && control.status.state === "saving";
  const setDraft: R.Dispatch<R.SetStateAction<RankSettingsDraft>> = update => {
    control.setDraft(update);
    if (control.status.state === "error") control.retry();
  };
  const error = localError || control.error;
  // React 17 may render the normalized saved draft before the controller's
  // final status callback. A matching accepted baseline is already saved.
  const status =
    localStatus ||
    (control.ready && !dirty
      ? "Saved automatically."
      : control.status.state === "pending"
        ? "Waiting to save automatically…"
        : saving
          ? "Saving automatically…"
          : control.status.state === "saved"
            ? "Saved automatically."
            : "");
  const presetEstimate = React.useMemo(() => {
    if (!estimatePerformers) return null;
    const category = { enabled: true };
    const count = estimatePerformers.filter(performer =>
      categoryEligible(performer, category, draft, editingCohort),
    ).length;
    return freshCategoryBattleEstimate(count, draft);
  }, [draft, editingCohort, estimatePerformers]);

  React.useEffect(() => {
    let cancelled = false;
    queryPerformers()
      .then(values => {
        if (!cancelled) setEstimatePerformers(values);
      })
      .catch(() => {
        if (!cancelled) setEstimateError(true);
      });
    return () => {
      cancelled = true;
    };
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
      const defaultCohort =
        enabledCohorts.indexOf(current.defaultCohort) !== -1 ? current.defaultCohort : enabledCohorts[0];
      return Object.assign({}, current, { genderBoxes: boxes, defaultCohort, enabledCohorts });
    });
  }

  function updateBox(id: string, update: Partial<RankGenderBox>) {
    changeBoxes(boxes => boxes.map(box => (box.id === id ? Object.assign({}, box, update) : box)));
  }

  function addBox() {
    const used = new Set(Object.keys(draft.categoriesByCohort).concat(draft.genderBoxes.map(box => box.id)));
    let index = 1;
    while (used.has("BOX-" + index)) index += 1;
    const id = "BOX-" + index;
    const names = new Set(draft.genderBoxes.map(box => box.name.toLowerCase()));
    let name = "Box " + index;
    while (names.has(name.toLowerCase())) {
      index += 1;
      name = "Box " + index;
    }
    edit(current =>
      Object.assign({}, current, {
        categoriesByCohort: {
          ...current.categoriesByCohort,
          [id]: DEFAULT_CATEGORY_DEFINITIONS.map(category => Object.assign({}, category)),
        },
        genderBoxes: current.genderBoxes.concat([{ id, name, genders: ["FEMALE"], enabled: true }]),
        enabledCohorts: current.enabledCohorts.concat([id]),
      }),
    );
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
    edit(current =>
      Object.assign({}, current, {
        categoriesByCohort: {
          ...current.categoriesByCohort,
          [editingCohort]: transform((current.categoriesByCohort[editingCohort] || []).slice()),
        },
      }),
    );
  }

  function updateCategory(index: number, update: Partial<RankCategory>) {
    changeCategories(categories =>
      categories.map((category, categoryIndex) =>
        categoryIndex === index ? Object.assign({}, category, update) : category,
      ),
    );
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
      return categories.concat([
        {
          id: uniqueCategoryId("New category", ids),
          name: "New category",
          description: "",
          enabled: true,
          weight: 1,
        },
      ]);
    });
  }

  function removeCategory(index: number) {
    changeCategories(categories =>
      categories.length <= 1 ? categories : categories.filter((_item, itemIndex) => itemIndex !== index),
    );
  }

  function resetCategoryPool(cohort: string, category: RankCategory) {
    if (busy) return;
    if (dirty || saving) {
      setError("Wait for the automatic save before resetting a category.");
      return;
    }
    const target = boxFor(draft, cohort).name + " / " + category.name;
    if (
      !window.confirm(
        "Reset all ratings and battle history for " +
          target +
          "? Other categories and gender boxes are kept. Use the General settings backup if you need to restore them later.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setStatus("Resetting " + target + "…");
    runOperation({ mode: "resetPool", categoryId: category.id, cohort, confirm: "RESET" })
      .then(result =>
        loadRatingIndex().then(() => {
          if (!mounted.current) return;
          setStatus("Reset " + target + ": " + result.reset + " rating(s).");
          DirtyPlugins.ui.notify("DirtyRank reset " + target + ": " + result.reset + " rating(s).");
        }),
      )
      .catch(caught => {
        if (mounted.current) {
          setError(caught.message || String(caught));
          setStatus("");
        }
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  }

  const editingCategories = categoriesFor(draft, editingCohort);

  function categoryNameError(category: RankCategory, index: number) {
    const name = String(category.name || "")
      .trim()
      .toLowerCase();
    if (!name) return "Enter a category name.";
    if (
      editingCategories.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          String(other.name || "")
            .trim()
            .toLowerCase() === name,
      )
    )
      return "Use a unique name for this performer sex.";
    return "";
  }

  const visibleStatus = documentationCapture()
    ? error
      ? "Operation failed; details hidden in documentation mode."
      : status.indexOf("Backup created:") === 0
        ? "Backup created; path hidden in documentation mode."
        : status
    : error || status;

  // Inactive tabs stay mounted but hidden, so unsaved input and validation survive switching.
  const panel = (id: SettingsTab, children: R.ReactNode) => (
    <div
      aria-labelledby={"dirty-rank-settings-tab-" + id}
      className="dirty-rank-settings-panel"
      hidden={tab !== id}
      id={"dirty-rank-settings-panel-" + id}
      role="tabpanel"
    >
      {children}
    </div>
  );

  return (
    <ui.SettingsCard
      className="dirty-rank-settings-card dirty-ui-pilot"
      bodyClassName="dirty-rank-settings-body"
      plugin={props.plugin}
      footer={
        <div className="card-footer dirty-plugins-card-footer dirty-rank-settings-actions">
          <ui.SaveStatus
            className="dirty-rank-settings-status"
            message={visibleStatus || (dirty ? "Waiting to save automatically…" : "")}
            state={error ? "error" : busy || saving ? "saving" : dirty ? "pending" : "saved"}
          />
        </div>
      }
    >
      <SettingsTabs active={tab} onSelect={selectTab} />
      {panel(
        "categories",
        <React.Fragment>
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
            resetCategoryPool={resetCategoryPool}
          />
          <OverallScoringSettings draft={draft} changed={changed} />
        </React.Fragment>,
      )}
      {panel("battles", <BattleSettings draft={draft} changed={changed} />)}
      {panel("leaderboards", <LeaderboardSettings draft={draft} changed={changed} />)}
      {panel(
        "boxes",
        <GenderBoxEditor
          draft={draft}
          changed={changed}
          setEditingCohort={setEditingCohort}
          showCategories={() => selectTab("categories")}
          toggleCohort={toggleCohort}
          updateBox={updateBox}
          addBox={addBox}
          removeBox={removeBox}
        />,
      )}
      {panel(
        "advanced",
        <RatingSettings
          draft={draft}
          changed={changed}
          busy={busy}
          currentParameters={currentParameters}
          presetEstimate={presetEstimate}
          estimateError={estimateError}
        />,
      )}
    </ui.SettingsCard>
  );
}

const SETTINGS_TABS = [
  ["categories", "Categories"],
  ["battles", "Battles"],
  ["leaderboards", "Leaderboards"],
  ["boxes", "Gender boxes"],
  ["advanced", "Advanced"],
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number][0];
const SETTINGS_TAB_STORAGE_KEY = "dirtyRank:settingsTab";

function storedSettingsTab(): SettingsTab {
  try {
    const stored = window.localStorage?.getItem(SETTINGS_TAB_STORAGE_KEY);
    return SETTINGS_TABS.find(item => item[0] === stored)?.[0] || "categories";
  } catch {
    return "categories";
  }
}

function SettingsTabs(props: { active: SettingsTab; onSelect: (tab: SettingsTab) => void }) {
  function onKeyDown(event: R.KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!offset) return;
    event.preventDefault();
    const next = SETTINGS_TABS[(index + offset + SETTINGS_TABS.length) % SETTINGS_TABS.length][0];
    props.onSelect(next);
    document.getElementById("dirty-rank-settings-tab-" + next)?.focus();
  }
  return (
    <div
      aria-label="DirtyRank settings"
      className="nav nav-tabs dirty-plugins-tabs dirty-rank-settings-tabs"
      role="tablist"
    >
      {SETTINGS_TABS.map(([id, label], index) => {
        const selected = id === props.active;
        return (
          <button
            aria-controls={"dirty-rank-settings-panel-" + id}
            aria-selected={selected}
            className={"nav-link dirty-plugins-tab" + (selected ? " active" : "")}
            id={"dirty-rank-settings-tab-" + id}
            key={id}
            onClick={() => props.onSelect(id)}
            onKeyDown={event => onKeyDown(event, index)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
