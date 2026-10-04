// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyRankSettingsPanel";
  if (window[INSTANCE_KEY]) return;

  /** Native rendering APIs and plugin-owned domain callbacks.
   * @param {RankSettingsPanelDependencies} dependencies
   */
  function createSettingsPanel(dependencies) {
    var Fragment = dependencies.Fragment;
    var leaderboardPerformerCountError = dependencies.leaderboardPerformerCountError;
    var COHORTS = dependencies.COHORTS;
    var DEFAULT_CATEGORY_DEFINITIONS = dependencies.DEFAULT_CATEGORY_DEFINITIONS;
    var DirtyPlugins = dependencies.DirtyPlugins;
    var Field = dependencies.Field;
    var LEADERBOARD_TOP_OPTIONS = dependencies.LEADERBOARD_TOP_OPTIONS;
    var OVERALL_SCORE_PARAMETERS = dependencies.OVERALL_SCORE_PARAMETERS;
    var OVERALL_SCORE_STRATEGIES = dependencies.OVERALL_SCORE_STRATEGIES;
    var PLUGIN_ID = dependencies.PLUGIN_ID;
    var RATING_PRESETS = dependencies.RATING_PRESETS;
    var RankButton = dependencies.RankButton;
    var Section = dependencies.Section;
    var SettingsCard = dependencies.SettingsCard;
    var SharedIconButton = dependencies.SharedIconButton;
    var SharedSaveStatus = dependencies.SharedSaveStatus;
    var Toggle = dependencies.Toggle;
    var boxFor = dependencies.boxFor;
    var boxOptions = dependencies.boxOptions;
    var categoriesFor = dependencies.categoriesFor;
    var categoryEligible = dependencies.categoryEligible;
    var comparableSettings = dependencies.comparableSettings;
    var documentationCapture = dependencies.documentationCapture;
    var freshCategoryBattleEstimate = dependencies.freshCategoryBattleEstimate;
    var html = dependencies.html;
    var leaderboardPerformerCount = dependencies.leaderboardPerformerCount;
    var leaderboardTopCount = dependencies.leaderboardTopCount;
    var loadRatingIndex = dependencies.loadRatingIndex;
    var overallScoreParameterError = dependencies.overallScoreParameterError;
    var overallScoreStrategy = dependencies.overallScoreStrategy;
    var parseEnabledCohorts = dependencies.parseEnabledCohorts;
    var queryPerformers = dependencies.queryPerformers;
    var ratingParameters = dependencies.ratingParameters;
    var ratingPresetFor = dependencies.ratingPresetFor;
    var runOperation = dependencies.runOperation;
    var serializedSettings = dependencies.serializedSettings;
    var settingsFromConfiguration = dependencies.settingsFromConfiguration;
    var uniqueCategoryId = dependencies.uniqueCategoryId;
    var useEffect = dependencies.useEffect;
    var useMemo = dependencies.useMemo;
    var useRef = dependencies.useRef;
    var useState = dependencies.useState;
    var validateSettings = dependencies.validateSettings;

    /** @param {RankSettingsSectionProps} props */
    function GenderBoxEditor(props) {
      var draft = props.draft;
      var changed = props.changed;
      var setEditingCohort = props.setEditingCohort;
      var toggleCohort = props.toggleCohort;
      var updateBox = props.updateBox;
      var addBox = props.addBox;
      var removeBox = props.removeBox;
      return html`<${Fragment}>
      <${Section}
        title="Gender boxes"
        description="Name each box and choose the genders that battle and rank together. Each box has its own categories and ratings. Rename or expand an existing box to keep its ratings; new boxes start unrated."
      >
        <div className="dirty-rank-category-list">
          ${draft.genderBoxes.map(function (box) {
            var nameError = !String(box.name || "").trim() ? "Enter a box name." : draft.genderBoxes.some(function (other) {
              return other.id !== box.id && String(other.name || "").trim().toLowerCase() === String(box.name || "").trim().toLowerCase();
            }) ? "Choose a unique box name." : "";
            return html`<div
              className="dirty-rank-category-editor dirty-rank-box-editor"
              key=${box.id}
              data-box-id=${box.id}
            >
              <${Field} id=${"dirty-rank-box-name-" + box.id} label="Box name" error=${nameError}>
                <input
                  className="form-control"
                  id=${"dirty-rank-box-name-" + box.id}
                  value=${box.name}
                  maxLength=${80}
                  type="text"
                  onChange=${function (event) { updateBox(box.id, { name: event.target.value }); }}
                />
              <//>
              <fieldset className="dirty-rank-category-genders">
                <legend>Genders in this box</legend>
                <div className="dirty-rank-cohort-options">
                  ${COHORTS.map(function (item) {
                    var checked = box.genders.indexOf(item[0]) !== -1;
                    return html`<${Toggle}
                      id=${"dirty-rank-box-gender-" + box.id + "-" + item[0]}
                      key=${item[0]}
                      label=${item[1]}
                      checked=${checked}
                      disabled=${checked && box.genders.length === 1}
                      onChange=${function (value) {
                        var genders = box.genders.filter(function (gender) { return gender !== item[0]; });
                        if (value) genders.push(item[0]);
                        if (genders.length) updateBox(box.id, { genders: parseEnabledCohorts(genders, box.genders) });
                      }}
                    />`;
                  })}
                </div>
              </fieldset>
              <div className="dirty-rank-data-tools d-flex flex-wrap align-items-center">
                <${Toggle}
                  checked=${box.enabled}
                  label="Enable this box"
                  disabled=${box.enabled && draft.enabledCohorts.length === 1}
                  onChange=${function (value) { toggleCohort(box.id, value); }}
                />
                <${RankButton}
                  onClick=${function () {
                    setEditingCohort(box.id);
                    var section = document.getElementById && document.getElementById("dirty-rank-category-cohort");
                    if (section && section.scrollIntoView) section.scrollIntoView({ block: "center", behavior: "smooth" });
                  }}
                >Edit categories<//>
                <${RankButton}
                  disabled=${draft.genderBoxes.length <= 1 || (box.enabled && draft.enabledCohorts.length === 1)}
                  onClick=${function () { removeBox(box.id); }}
                  title="Remove this box from the options; its stored ratings are retained"
                >Remove box<//>
              </div>
            </div>`;
          })}
        </div>
        <${RankButton} disabled=${draft.genderBoxes.length >= 24} onClick=${addBox}>+ Add gender box<//>
        ${draft.enabledCohorts.length > 1 && html`<div
          className="dirty-rank-settings-grid dirty-rank-settings-grid-compact"
          style=${{ marginTop: "0.9rem" }}
        >
          <${Field} id="dirty-rank-default-cohort" label="Default gender box">
            <select
              className="form-control"
              id="dirty-rank-default-cohort"
              onChange=${function (event) { changed({ defaultCohort: event.target.value }); }}
              value=${draft.defaultCohort}
            >${boxOptions(draft, true).map(function (item) { return html`<option key=${item[0]} value=${item[0]}>${item[1]}</option>`; })}</select>
          <//>
        </div>`}
      <//>

      <//>`;
    }

    function presentationToggles(definitions, draft, changed) {
      return definitions.map(function (definition) {
        var key = definition[0];
        return html`<${Toggle} key=${key} checked=${draft[key]} label=${definition[1]}
          onChange=${function (value) { var update = {}; update[key] = value; changed(update); }} />`;
      });
    }

    /** @param {RankSettingsSectionProps} props */
    function PresentationSettings(props) {
      var draft = props.draft;
      var changed = props.changed;
      return html`<${Fragment}>
      <${Section}
        title="Navigation"
        description="Choose which DirtyRank pages appear in Stash's utility navigation. Hidden pages remain available through direct links."
      >
        <div className="dirty-rank-settings-row">
          ${presentationToggles([
            ["showBattlesInMenu", "Show Battles in the Stash header"],
            ["showLeaderboardsInMenu", "Show Leaderboards in the Stash header"]
          ], draft, changed)}
        </div>
      <//>
      <${Section}
        title="Leaderboard presentation"
        description="Choose the featured layout and standings view. Changes save automatically and apply to every leaderboard statistic."
      >
        <div className="dirty-rank-settings-grid dirty-rank-leaderboard-settings">
          <${Field} id="dirty-rank-leaderboard-top-count" label="Featured performers">
            <select
              className="form-control"
              id="dirty-rank-leaderboard-top-count"
              onChange=${function (event) {
                var topCount = leaderboardTopCount(event.target.value);
                changed({ leaderboardTopCount: topCount, leaderboardPerformerCount: leaderboardPerformerCount(draft.leaderboardPerformerCount, topCount) });
              }}
              value=${draft.leaderboardTopCount}
            >${LEADERBOARD_TOP_OPTIONS.map(function (option) { return html`<option key=${option.count} value=${option.count}>${option.name}</option>`; })}</select>
          <//>
          <${Field}
            id="dirty-rank-leaderboard-performer-count"
            label="Performers per page"
            help=${"Includes the featured performers. Use a multiple of " + draft.leaderboardTopCount + "; changing the layout rounds the count up to a valid multiple."}
            error=${leaderboardPerformerCountError(draft)}
          >
            <input
              className="form-control"
              id="dirty-rank-leaderboard-performer-count"
              type="number"
              min=${Number(draft.leaderboardTopCount) * 2}
              max=${Math.floor(1000 / Number(draft.leaderboardTopCount)) * Number(draft.leaderboardTopCount)}
              step=${draft.leaderboardTopCount}
              value=${draft.leaderboardPerformerCount}
              onChange=${function (event) { changed({ leaderboardPerformerCount: event.target.value }); }}
            />
          <//>
          <${Field} id="dirty-rank-leaderboard-view" label="Standings view">
            <select
              className="form-control"
              id="dirty-rank-leaderboard-view"
              onChange=${function (event) { changed({ leaderboardView: event.target.value }); }}
              value=${draft.leaderboardView}
            >
              <option value="gallery">Gallery</option>
              <option value="table">Table</option>
            </select>
          <//>
        </div>
      <//>
      <${Section}
        title="Battle presentation"
        description="Control what is revealed on performer cards. These choices do not change the rating pools."
      >
        <div className="dirty-rank-settings-row">
          ${presentationToggles([
            ["showRatingsBeforeVote", "Show ratings and ranks before voting"],
            ["hidePerformerImages", "Hide performer images in battles"],
            ["hideBattleStandings", "Hide standings during battles"],
            ["autoPlayTopScenes", html`<span
              title="Automatic previews play each performer's highest-rated full scene, muted, from a random point between 30% and 70%. Photos remain clickable for voting unless hidden above."
            >Automatically play top scenes</span>`],
            ["includePerformersWithoutImages", "Include performers without profile images"]
          ], draft, changed)}
        </div>
      <//>
      <${Section}
        title="Confidence goal"
        description="Choose what the information-gain matchmaker should stabilize. Every mode samples all eligible performers at least once; narrower goals stop refining ratings that no longer affect the result."
      >
        <div className="dirty-rank-settings-grid dirty-rank-settings-grid-compact">
          <${Field} id="dirty-rank-confidence-goal" label="Optimize battles for">
            <select
              className="form-control"
              id="dirty-rank-confidence-goal"
              onChange=${function (event) { changed({ confidenceGoal: event.target.value }); }}
              value=${draft.confidenceGoal}
            >
              <option value="ranking">Leaderboard order (recommended)</option>
              <option value="top">Top performers</option>
              <option value="all">Every performer rating</option>
            </select>
          <//>
          ${draft.confidenceGoal === "top" && html`<${Field}
            id="dirty-rank-confidence-top-n"
            label="Top performers to stabilize"
            error=${!String(draft.confidenceTopN).trim() || !Number.isInteger(Number(draft.confidenceTopN)) ||
              Number(draft.confidenceTopN) < 1 || Number(draft.confidenceTopN) > 1000
              ? "Enter a whole number from 1 to 1000." : ""}
          >
            <input
              className="form-control"
              id="dirty-rank-confidence-top-n"
              max=${1000}
              min=${1}
              onChange=${function (event) { changed({ confidenceTopN: event.target.value }); }}
              step=${1}
              type="number"
              value=${draft.confidenceTopN}
            />
          <//>`}
        </div>
      <//>
      <${Section}
        title="Overall scoring"
        description="Experiment with how categories combine into the overall leaderboard and Stash performer sort. Changes save automatically and recalculate existing scores; category ratings and battle history are kept."
      >
        <${Field}
          id="dirty-rank-overall-strategy"
          label="Scoring strategy"
          help=${overallScoreStrategy(draft.overallScoreStrategy).description}
        >
          <select
            className="form-control"
            id="dirty-rank-overall-strategy"
            value=${draft.overallScoreStrategy}
            onChange=${function (event) { changed({ overallScoreStrategy: event.target.value }); }}
          >
            ${OVERALL_SCORE_STRATEGIES.map(function (strategy) {
              return html`<option key=${strategy.id} value=${strategy.id}>${strategy.name}</option>`;
            })}
          </select>
        <//>
        ${draft.overallScoreStrategy === "power" && html`<div className="dirty-rank-settings-grid">
          ${OVERALL_SCORE_PARAMETERS.filter(function (definition) {
            return definition.strategy === draft.overallScoreStrategy;
          }).map(function (definition) {
            var id = "dirty-rank-" + definition.key;
            return html`<${Field}
              key=${definition.key}
              id=${id}
              label=${definition.label}
              help=${definition.help}
              error=${overallScoreParameterError(draft[definition.key], definition)}
            >
              <input
                className="form-control"
                id=${id}
                type="number"
                min=${definition.min}
                max=${definition.max}
                step=${definition.step}
                value=${draft[definition.key]}
                onChange=${function (event) {
                  var update = {};
                  update[definition.key] = event.target.value;
                  changed(update);
                }}
              />
            <//>`;
          })}
        </div>`}
      <//>

      <//>`;
    }

    /** @param {RankSettingsSectionProps} props */
    function CategoryEditor(props) {
      var draft = props.draft;
      var busy = props.busy;
      var saving = props.saving;
      var dirty = props.dirty;
      var editingCohort = props.editingCohort;
      var editingCategories = props.editingCategories;
      var setEditingCohort = props.setEditingCohort;
      var categoryNameError = props.categoryNameError;
      var updateCategory = props.updateCategory;
      var moveCategory = props.moveCategory;
      var removeCategory = props.removeCategory;
      var addCategory = props.addCategory;
      var resetCategoryPool = props.resetCategoryPool;
      return html`<${Fragment}>
      <${Section}
        title="Rating categories"
        description="Choose a gender box, then define its categories and their weights. Categories and ratings are independent between boxes."
      >
        ${draft.genderBoxes.length > 1 && html`<div className="dirty-rank-category-cohort">
          <${Field} id="dirty-rank-category-cohort" label="Categories for gender box">
            <select
              className="form-control"
              id="dirty-rank-category-cohort"
              onChange=${function (event) { setEditingCohort(event.target.value); }}
              value=${editingCohort}
            >${boxOptions(draft, false).map(function (item) { return html`<option key=${item[0]} value=${item[0]}>${item[1]}</option>`; })}</select>
          <//>
        </div>`}
        <div className="dirty-rank-category-list">
          ${editingCategories.map(function (category, index) {
            return html`<div className="dirty-rank-category-editor" key=${editingCohort + ":" + category.id}>
              <div
                className="dirty-rank-category-toolbar d-flex flex-wrap align-items-center justify-content-between"
              >
                <span className="dirty-rank-category-sex">${boxFor(draft, editingCohort).name}</span>
                <div className="dirty-rank-data-tools d-flex flex-wrap align-items-center">
                  <${RankButton}
                    className="dirty-rank-category-reset"
                    disabled=${busy || saving || dirty}
                    tone="danger"
                    title=${"Reset ratings for " + boxFor(draft, editingCohort).name + " / " + category.name}
                    onClick=${function () { resetCategoryPool(editingCohort, category); }}
                  >Reset ratings<//>
                  ${SharedIconButton ? html`<${SharedIconButton}
                    ariaLabel="Move category up"
                    disabled=${index === 0}
                    fallback="↑"
                    onClick=${function () { moveCategory(index, -1); }}
                  />` : html`<button
                    aria-label="Move category up"
                    className="dirty-ui-icon-button"
                    disabled=${index === 0}
                    onClick=${function () { moveCategory(index, -1); }}
                    type="button"
                  >↑</button>`}
                  ${SharedIconButton ? html`<${SharedIconButton}
                    ariaLabel="Move category down"
                    disabled=${index === editingCategories.length - 1}
                    fallback="↓"
                    onClick=${function () { moveCategory(index, 1); }}
                  />` : html`<button
                    aria-label="Move category down"
                    className="dirty-ui-icon-button"
                    disabled=${index === editingCategories.length - 1}
                    onClick=${function () { moveCategory(index, 1); }}
                    type="button"
                  >↓</button>`}
                  ${SharedIconButton ? html`<${SharedIconButton}
                    ariaLabel="Remove category"
                    disabled=${editingCategories.length <= 1}
                    fallback="×"
                    onClick=${function () { removeCategory(index); }}
                  />` : html`<button
                    aria-label="Remove category"
                    className="dirty-ui-icon-button"
                    disabled=${editingCategories.length <= 1}
                    onClick=${function () { removeCategory(index); }}
                    type="button"
                  >×</button>`}
                </div>
              </div>
              <div className="dirty-rank-category-basics">
                <${Field}
                  id=${"dirty-rank-category-name-" + editingCohort + "-" + index}
                  label="Name"
                  error=${categoryNameError(category, index)}
                >
                  <input
                    className="form-control"
                    id=${"dirty-rank-category-name-" + editingCohort + "-" + index}
                    maxLength=${80}
                    onChange=${function (event) { updateCategory(index, { name: event.target.value }); }}
                    type="text"
                    value=${category.name}
                  />
                <//>
                <${Field}
                  id=${"dirty-rank-category-weight-" + editingCohort + "-" + index}
                  label="Overall weight"
                  error=${String(category.weight).trim() && Number(category.weight) >= 0.01 && Number(category.weight) <= 1000
                    ? "" : "Enter a weight between 0.01 and 1000."}
                >
                  <input
                    className="form-control"
                    id=${"dirty-rank-category-weight-" + editingCohort + "-" + index}
                    min=${0.01}
                    max=${1000}
                    step=${0.1}
                    onChange=${function (event) { updateCategory(index, { weight: event.target.value }); }}
                    type="number"
                    value=${category.weight}
                  />
                <//>
              </div>
              <${Field}
                id=${"dirty-rank-category-description-" + editingCohort + "-" + index}
                label="Description"
              >
                <textarea
                  className="form-control"
                  id=${"dirty-rank-category-description-" + editingCohort + "-" + index}
                  maxLength=${500}
                  onChange=${function (event) { updateCategory(index, { description: event.target.value }); }}
                  rows=${2}
                  value=${category.description}
                />
              <//>
              <${Toggle}
                checked=${category.enabled}
                label="Enable this category"
                onChange=${function (value) { updateCategory(index, { enabled: value }); }}
              />
            </div>`;
          })}
          <${RankButton} onClick=${addCategory}>+ Add category<//>
        </div>
      <//>

      <//>`;
    }

    /** @param {RankSettingsSectionProps} props */
    function RatingSettings(props) {
      var draft = props.draft;
      var changed = props.changed;
      var busy = props.busy;
      var currentParameters = props.currentParameters;
      var presetEstimate = props.presetEstimate;
      var estimateError = props.estimateError;
      return html`<${Fragment}>
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
              <${RankButton}
                className="dirty-rank-preset-current"
                disabled=${busy}
                tone="primary"
                title="Restore advanced values from when this settings page was opened"
                onClick=${function () { changed(currentParameters); }}
              >Current<//>
              ${RATING_PRESETS.map(function (preset) {
                var selected = ratingPresetFor(draft) === preset;
                return html`<${RankButton}
                  key=${preset.id}
                  disabled=${busy}
                  pressed=${selected}
                  tone=${selected ? "primary" : "secondary"}
                  onClick=${function () { changed(preset.settings); }}
                >${preset.name}<//>`;
              })}
            </div>
            <span
              className="dirty-rank-preset-estimate"
              role="status"
              aria-live="polite"
              title="Fresh category for the gender box selected under Rating categories. Assumes informative close matchups until every performer reaches Refined; each battle updates two performers. Actual totals depend on results and matchmaking. Parameters that do not change predicted uncertainty can leave the rounded total unchanged."
            >
              ${presetEstimate ? (presetEstimate.capped ? "≥" : "") + presetEstimate.battles.toLocaleString() + " battles expected to rank 1 category for " + presetEstimate.performers.toLocaleString() + " performers"
                : estimateError ? "Battle estimate unavailable" : "Loading battle estimate…"}
            </span>
          </div>
          <p className="dirty-rank-advanced-copy" aria-live="polite">
            ${ratingPresetFor(draft)
              ? ratingPresetFor(draft).description
              : "Custom configuration. Choose a preset or adjust the values below."}
          </p>
          <p className="dirty-rank-advanced-copy">
            Presets save automatically and apply to future battles. Existing ratings and history are kept; starting values apply to unrated performers. Battle weight drives faster refinement; lower tau limits volatility changes. Recent-pair avoidance and calibration are soft matchmaking preferences. DirtyRank does not inflate uncertainty during inactivity.
          </p>
          <div className="dirty-rank-settings-grid">
            ${[
              { key: "evidenceWeight", id: "dirty-rank-evidence-weight", label: "Evidence per battle", min: 1, max: 3, step: 0.1,
                help: "How strongly one comparison reduces uncertainty. 1.0 is standard Glicko-2; 2.0 treats a consistent subjective choice as twice the rating evidence while still recording one battle." },
              { key: "avoidRepeatWindow", id: "dirty-rank-repeat-window", label: "Recent pairs to avoid", min: 0, max: 100,
                help: "Prefer different pairings within this many recent battles. A small pool may still repeat a pair." },
              { key: "calibrationPercent", id: "dirty-rank-calibration", label: "Calibration matches (%)", min: 0, max: 100,
                help: "Chance of favouring broader rating gaps. Lower values focus on the matchups expected to reduce uncertainty most." },
              { key: "initialRating", label: "Initial rating", min: -100000, max: 100000, step: 1 },
              { key: "initialDeviation", label: "Initial deviation", min: 30, max: 1000, step: 1 },
              { key: "initialVolatility", label: "Initial volatility", min: 0.0001, max: 1, step: 0.001 },
              { key: "tau", label: "Tau", min: 0.01, max: 2, step: 0.01 },
              { key: "deviationFloor", label: "Deviation floor", min: 1, max: 1000, step: 1 },
              { key: "provisionalDeviation", label: "Provisional threshold", min: 1, max: 1000, step: 1 },
            ].map(function (definition) {
              var id = definition.id || "dirty-rank-" + definition.key;
              return html`<${Field}
                id=${id}
                key=${definition.key}
                label=${definition.label}
                help=${definition.help}
              >
                <input
                  className="form-control"
                  id=${id}
                  min=${definition.min}
                  max=${definition.max}
                  step=${definition.step}
                  onChange=${function (event) { var update = {}; update[definition.key] = Number(event.target.value); changed(update); }}
                  type="number"
                  value=${draft[definition.key]}
                />
              <//>`;
            })}
          </div>
        </div>
      </details>
      <//>`;
    }

  function DirtyRankSettings(props) {
    if (!SettingsCard || !Section || !Toggle) return null;
    var currentParametersState = useState(function () { return ratingParameters(settingsFromConfiguration(props.configuration)); });
    var currentParameters = currentParametersState[0];
    var setCurrentParameters = currentParametersState[1];
    var estimatePerformersState = useState(null);
    var estimatePerformers = estimatePerformersState[0];
    var setEstimatePerformers = estimatePerformersState[1];
    var estimateErrorState = useState(false);
    var estimateError = estimateErrorState[0];
    var setEstimateError = estimateErrorState[1];
    var draftState = useState(function () { return settingsFromConfiguration(props.configuration); });
    var draft = draftState[0];
    var setDraft = draftState[1];
    var savedState = useState(function () { return settingsFromConfiguration(props.configuration); });
    var saved = savedState[0];
    var setSaved = savedState[1];
    var editingCohortState = useState(function () {
      return settingsFromConfiguration(props.configuration).defaultCohort;
    });
    var editingCohort = editingCohortState[0];
    var setEditingCohort = editingCohortState[1];
    var busyState = useState(false);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var savingState = useState(false);
    var saving = savingState[0];
    var setSaving = savingState[1];
    var statusState = useState("");
    var status = statusState[0];
    var setStatus = statusState[1];
    var errorState = useState("");
    var error = errorState[0];
    var setError = errorState[1];
    var saveControllerRef = useRef(null);
    var editRevisionRef = useRef(0);
    var settingsRevisionRef = useRef(null);
    var dirty = useMemo(function () {
      return comparableSettings(draft) !== comparableSettings(saved);
    }, [draft, saved]);
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

    useEffect(function () {
      var cancelled = false;
      runOperation({ mode: "getSettings" }).then(function (result) {
        if (cancelled) return;
        settingsRevisionRef.current = result.revision;
        var normalized = settingsFromConfiguration(result.settings);
        setCurrentParameters(ratingParameters(normalized));
        setDraft(normalized);
        setSaved(normalized);
        setEditingCohort(normalized.defaultCohort);
      }).catch(function () {
        // The settings supplied by the shared hub remain a valid fallback.
      });
      return function () { cancelled = true; };
    }, []);
    useEffect(function () {
      if (props.onDirtyChange) props.onDirtyChange(PLUGIN_ID, dirty);
    }, [dirty, props.onDirtyChange]);
    useEffect(function () {
      return function () {
        if (saveControllerRef.current) saveControllerRef.current.dispose();
        if (props.onDirtyChange) props.onDirtyChange(PLUGIN_ID, false);
      };
    }, [props.onDirtyChange]);
    if (!saveControllerRef.current) {
      saveControllerRef.current = DirtyPlugins.createSaveController({
        delay: 350,
        validate: function (request) { return validateSettings(request.settings); },
        save: function (request) {
          var ready = settingsRevisionRef.current === null
            ? runOperation({ mode: "getSettings" }).then(function (result) { settingsRevisionRef.current = result.revision; })
            : Promise.resolve();
          return ready.then(function () {
            return runOperation({ mode: "saveSettings", settings: serializedSettings(request.settings), expectedRevision: settingsRevisionRef.current });
          }).then(function (result) {
            settingsRevisionRef.current = result.revision;
            return settingsFromConfiguration(result.settings);
          });
        },
        onSaved: function (request, normalized, current) {
          setSaved(normalized);
          if (current && editRevisionRef.current === request.editRevision) {
            setDraft(normalized);
            DirtyPlugins.notifyConfigurationChanged(PLUGIN_ID, { preserveSettingsPage: true });
          }
        },
        onStatus: function (value) {
          setSaving(value.state === "saving");
          setError(value.state === "error" || value.state === "invalid" ? value.message : "");
          setStatus(value.state === "pending" ? "Waiting to save automatically…"
            : value.state === "saving" ? "Saving automatically…"
            : value.state === "saved" ? "Saved automatically." : "");
        },
      });
    }
    useEffect(function () {
      if (dirty) saveControllerRef.current.schedule({ settings: draft, editRevision: editRevisionRef.current });
      return function () { saveControllerRef.current.cancelPending(); };
    }, [dirty, draft]);

    function changed(update) {
      editRevisionRef.current += 1;
      setDraft(function (current) { return Object.assign({}, current, update); });
      setStatus("");
      setError("");
    }

    function toggleCohort(cohort, enabled) {
      if (!enabled && draft.enabledCohorts.length === 1 && draft.enabledCohorts[0] === cohort) return;
      updateBox(cohort, { enabled: enabled });
    }

    function changeBoxes(transform) {
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

    function updateBox(id, update) {
      changeBoxes(function (boxes) { return boxes.map(function (box) {
        return box.id === id ? Object.assign({}, box, update) : box;
      }); });
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
        return Object.assign({}, current, { categoriesByCohort: categories,
          genderBoxes: current.genderBoxes.concat([{ id: id, name: name, genders: ["FEMALE"], enabled: true }]),
          enabledCohorts: current.enabledCohorts.concat([id]) });
      });
      setEditingCohort(id);
      setStatus("");
      setError("");
    }

    function removeBox(id) {
      var box = boxFor(draft, id);
      if (draft.genderBoxes.length <= 1 || (box.enabled && draft.enabledCohorts.length === 1)) return;
      if (editingCohort === id) setEditingCohort(draft.genderBoxes.find(function (other) { return other.id !== id; }).id);
      // Keep category definitions as well as rating rows, and never reuse their IDs.
      changeBoxes(function (boxes) { return boxes.filter(function (other) { return other.id !== id; }); });
    }

    function changeCategories(transform) {
      setDraft(function (current) {
        var nextByCohort = Object.assign({}, current.categoriesByCohort);
        var currentCategories = (nextByCohort[editingCohort] || []).slice();
        nextByCohort[editingCohort] = transform(currentCategories);
        return Object.assign({}, current, { categoriesByCohort: nextByCohort });
      });
      setStatus("");
      setError("");
    }

    function updateCategory(index, update) {
      changeCategories(function (categories) { return categories.map(function (category, categoryIndex) {
        return categoryIndex === index ? Object.assign({}, category, update) : category;
      }); });
    }

    function moveCategory(index, direction) {
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

    function removeCategory(index) {
      changeCategories(function (categories) {
        if (categories.length <= 1) return categories;
        return categories.filter(function (_item, itemIndex) { return itemIndex !== index; });
      });
    }

    function resetCategoryPool(cohort, category) {
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
          setStatus("Reset " + target + ": " + result.reset + " rating(s); " + result.failed + " failed.");
          DirtyPlugins.ui.notify("DirtyRank reset " + target + ": " + result.reset + " rating(s).");
        });
      }).catch(function (caught) { setError(caught.message || String(caught)); setStatus(""); })
        .finally(function () { setBusy(false); });
    }

    var editingCategories = categoriesFor(draft, editingCohort);

    function categoryNameError(category, index) {
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

    return html`<${SettingsCard}
      className="dirty-rank-settings-card dirty-ui-pilot"
      bodyClassName="dirty-rank-settings-body"
      plugin=${props.plugin}
      footer=${html`<div className="card-footer dirty-plugins-card-footer dirty-rank-settings-actions">
        ${SharedSaveStatus ? html`<${SharedSaveStatus}
          className="dirty-rank-settings-status"
          message=${visibleStatus || (dirty ? "Waiting to save automatically…" : "")}
          state=${error ? "error" : busy || saving ? "saving" : dirty ? "pending" : "saved"}
        />` : html`<span
          className=${"dirty-rank-settings-status" + (error ? " dirty-ui-text-error" : "")}
          role=${error ? "alert" : "status"}
        >${visibleStatus}</span>`}
      </div>`}
    >
      <${GenderBoxEditor} draft=${draft} changed=${changed} setEditingCohort=${setEditingCohort} toggleCohort=${toggleCohort} updateBox=${updateBox} addBox=${addBox} removeBox=${removeBox} />
      <${PresentationSettings} draft=${draft} changed=${changed} />
      <${CategoryEditor} draft=${draft} busy=${busy} saving=${saving} dirty=${dirty} editingCohort=${editingCohort} editingCategories=${editingCategories} setEditingCohort=${setEditingCohort} categoryNameError=${categoryNameError} updateCategory=${updateCategory} moveCategory=${moveCategory} removeCategory=${removeCategory} addCategory=${addCategory} resetCategoryPool=${resetCategoryPool} />
      <${RatingSettings} draft=${draft} changed=${changed} busy=${busy} currentParameters=${currentParameters} presetEstimate=${presetEstimate} estimateError=${estimateError} />

    <//>`;
  }


    return DirtyRankSettings;
  }

  window[INSTANCE_KEY] = { createSettingsPanel: createSettingsPanel };
})();
