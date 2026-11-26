import { PLUGIN_ID, UNDO_HISTORY_LIMIT } from "./constants";
import { categoryConfidence, keepSides, selectGauntletPair, selectPair } from "./domain/matchmaking";
import { battleCategoryPath, battleId, cohortLabel, ratingDelta } from "./domain/navigation";
import {
  getRatingIndexRevision,
  loadNativePerformerCard,
  loadRatingIndex,
  pairToken,
  poolFor,
  queryPerformers,
  runOperation,
  updatePerformerStates,
} from "./domain/rank";
import { VERDICT_LIMIT } from "./domain/rating";
import {
  CONFIGURATION_CHANGED_EVENT,
  battleCohortFor,
  categoriesForPerformer,
  preferredCategoryId,
  rememberCategory,
  settingsFromConfiguration,
} from "./domain/settings";
import { applyVerdictResult, chosenVerdict, poolVerdictsFromResult, verdictFor, withVerdict } from "./domain/verdicts";
import type { PoolVerdicts } from "./domain/verdicts";
import { DirtyPlugins, React, Router, documentationCapture } from "./runtime";
import { linkedBox } from "./domain/navigation";
import type {
  ConfigurationEvent,
  Decision,
  Feedback,
  PreparedPair,
  RankCategory,
  RankOperationResult,
  RankPairResult,
  RankPerformer,
  RankSettings,
  UndoEntry,
} from "./types";

/** How long the chosen number flashes on the scale while the next pair is already shown. */
export const CHOICE_FLASH_MS = 600;

/**
 * Home-row keys for the scale, left to right: A S D for the left performer's 3 2 1, G for
 * equal, J K L for the right performer's 1 2 3. KeyboardEvent.code names a key's position,
 * not its letter, so the same keys work on every layout (Q S D G J K L on AZERTY).
 */
export const VERDICT_KEY_CODES = ["KeyA", "KeyS", "KeyD", "KeyG", "KeyJ", "KeyK", "KeyL"];
/** The QWERTY letters of those keys, shown until the browser reports the keyboard's own. */
export const DEFAULT_KEY_LABELS = ["A", "S", "D", "G", "J", "K", "L"];
/**
 * The keypad gives the strength directly: 1 2 3 for the left performer (slightly, better,
 * much better), 0 for equal, 4 5 6 for the right performer. Its codes ignore Num Lock.
 */
const KEYPAD_SCORES: Record<string, number> = {
  Numpad0: 0,
  Numpad1: 1,
  Numpad2: 2,
  Numpad3: 3,
  Numpad4: -1,
  Numpad5: -2,
  Numpad6: -3,
};
export function scoreForCode(code: string) {
  if (Object.prototype.hasOwnProperty.call(KEYPAD_SCORES, code)) return KEYPAD_SCORES[code];
  const position = VERDICT_KEY_CODES.indexOf(code);
  return position === -1 ? null : VERDICT_LIMIT - position;
}
type KeyboardLayout = { getLayoutMap?(): Promise<Map<string, string>> };
/** The letters this keyboard types on those keys, where the browser can tell (Chromium's Keyboard Map). */
export function loadKeyLabels(): Promise<string[]> {
  const keyboard =
    typeof navigator === "undefined" ? undefined : (navigator as Navigator & { keyboard?: KeyboardLayout }).keyboard;
  if (!keyboard || typeof keyboard.getLayoutMap !== "function") return Promise.resolve(DEFAULT_KEY_LABELS);
  return keyboard
    .getLayoutMap()
    .then(layout =>
      VERDICT_KEY_CODES.map((code, index) => {
        const key = layout.get(code);
        return key && key.length === 1 ? key.toUpperCase() : DEFAULT_KEY_LABELS[index];
      }),
    )
    .catch(() => DEFAULT_KEY_LABELS);
}

export function useBattleSession(props: { routeDetails: { categoryId?: string }; routeTargetId?: string }) {
  const routeDetails = props.routeDetails;
  const requestedCategoryId = routeDetails.categoryId;
  const history = Router.useHistory();
  const location = Router.useLocation();
  const query = new URLSearchParams(location.search),
    requestedCohort = query.get("box") || query.get("cohort") || "";
  const gauntletTargetId = props.routeTargetId;
  const gauntletMode = Boolean(gauntletTargetId);
  const findTarget = (list: RankPerformer[]) =>
    gauntletMode ? list.find(performer => String(performer.id) === gauntletTargetId) || null : null;
  const censorMedia = documentationCapture();
  DirtyPlugins.react.usePageTitle("DirtyRank", gauntletMode ? "Gauntlet" : "Battles");
  const [settings, setSettings] = React.useState<RankSettings | null>(null);
  const [performers, setPerformers] = React.useState<RankPerformer[]>([]);
  const performersRef = React.useRef(performers),
    libraryLoaded = React.useRef(false);
  performersRef.current = performers;
  const gauntletTarget = React.useMemo(() => findTarget(performers), [gauntletMode, gauntletTargetId, performers]);
  const cohort = settings ? battleCohortFor(settings, gauntletTarget, requestedCohort) : "";
  const requestedContextRef = React.useRef<{ cohort: string; categoryId?: string }>({ cohort: "" });
  requestedContextRef.current = { cohort: requestedCohort, categoryId: requestedCategoryId };
  const [categoryId, setCategoryId] = React.useState("");
  const [pairInfo, setPairInfo] = React.useState<RankPairResult | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [undoHistory, setUndoHistory] = React.useState<UndoEntry[]>([]);
  const [pendingVotes, setPendingVotes] = React.useState(0);
  const [verdicts, setVerdictState] = React.useState<PoolVerdicts | null>(null);
  const verdictsRef = React.useRef<PoolVerdicts | null>(null);
  const submittedPairRef = React.useRef("");
  const pendingVotesRef = React.useRef(0);
  const voteQueueRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const mountedRef = React.useRef(true);
  const loadRequestRef = React.useRef(0);
  const undoHistoryRef = React.useRef<UndoEntry[]>([]);
  const operationStatusRef = React.useRef(new Map<string, { recordFailed: boolean; undone: boolean }>());
  const preparedPairRef = React.useRef<PreparedPair | null>(null);
  const preparedImagesRef = React.useRef<HTMLImageElement[]>([]);
  // The number just chosen flashes briefly on the scale; the next pair does not wait for it.
  const [chosen, setChosen] = React.useState<number | null>(null);
  const [keyLabels, setKeyLabels] = React.useState<string[]>(DEFAULT_KEY_LABELS);
  const flashTimerRef = React.useRef<number | null>(null);
  function cancelFlash() {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = null;
  }

  /** Verdict changes apply at once, so the next pair already knows them. */
  function setVerdicts(update: (current: PoolVerdicts | null) => PoolVerdicts | null) {
    verdictsRef.current = update(verdictsRef.current);
    setVerdictState(verdictsRef.current);
  }
  /** Change the verdicts of one pool only, if they are still the loaded ones. */
  function updatePool(categoryId: string, poolCohort: string, update: (current: PoolVerdicts) => PoolVerdicts) {
    setVerdicts(current =>
      current && current.categoryId === categoryId && current.cohort === poolCohort ? update(current) : current,
    );
  }

  const load = React.useCallback(
    (settingsOnly = false) => {
      settingsOnly = settingsOnly && libraryLoaded.current;
      const request = ++loadRequestRef.current;
      setLoading(true);
      setError("");
      return Promise.all([
        DirtyPlugins.getPluginSettings(PLUGIN_ID),
        settingsOnly ? Promise.resolve(null) : queryPerformers(true),
        settingsOnly ? Promise.resolve(null) : loadRatingIndex(),
        loadNativePerformerCard(),
      ])
        .then(values => {
          if (!mountedRef.current || request !== loadRequestRef.current) return;
          const nextSettings = settingsFromConfiguration(values[0]);
          const gauntletTarget = findTarget(values[1] || performersRef.current);
          if (!settingsOnly && gauntletMode && !gauntletTarget)
            throw new Error("The selected Gauntlet performer could not be found.");
          const requestedContext = requestedContextRef.current;
          const nextCohort = battleCohortFor(nextSettings, gauntletTarget, requestedContext.cohort);
          if (!nextCohort) {
            throw new Error(
              "Enable a category that includes " +
                cohortLabel(gauntletTarget ? gauntletTarget.gender : nextSettings.defaultCohort) +
                " performers in DirtyRank settings.",
            );
          }
          const enabled = categoriesForPerformer(nextSettings, nextCohort, gauntletTarget);
          if (!enabled.length)
            throw new Error("Enable at least one DirtyRank category for the selected performer cohort.");
          setSettings(nextSettings);
          if (values[1]) {
            libraryLoaded.current = true;
            setPerformers(values[1]);
          }
          setCategoryId(current => {
            if (enabled.some(item => item.id === requestedContext.categoryId)) return requestedContext.categoryId!;
            return preferredCategoryId(nextSettings, nextCohort, current);
          });
          setPairInfo(null);
          setDecision(null);
          undoHistoryRef.current = [];
          setUndoHistory([]);
        })
        .catch(caught => {
          if (mountedRef.current && request === loadRequestRef.current) setError(caught.message || String(caught));
        })
        .finally(() => {
          if (mountedRef.current && request === loadRequestRef.current) setLoading(false);
        });
    },
    [gauntletMode, gauntletTargetId],
  );

  React.useEffect(() => {
    void loadKeyLabels().then(labels => {
      if (mountedRef.current) setKeyLabels(labels);
    });
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void load();
    function changed(event: ConfigurationEvent) {
      if (!event.detail || event.detail.pluginId === PLUGIN_ID) void load(true);
    }
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, changed);
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
      cancelFlash();
      window.removeEventListener(CONFIGURATION_CHANGED_EVENT, changed);
    };
  }, [load]);

  const category = React.useMemo(() => {
    if (!settings) return null;
    const cohortCategories = categoriesForPerformer(settings, cohort, gauntletTarget);
    return (
      cohortCategories.find(item => item.id === (requestedCategoryId || categoryId)) || cohortCategories[0] || null
    );
  }, [categoryId, cohort, settings, requestedCategoryId, gauntletTarget]);
  const poolCategoryId = category ? category.id : "";

  // Every verdict of the pool, so matchmaking knows which pairs were judged and how.
  React.useEffect(() => {
    if (loading || !poolCategoryId || !cohort) return undefined;
    let cancelled = false;
    setVerdicts(() => null);
    runOperation({ mode: "loadVerdicts", categoryId: poolCategoryId, cohort })
      .then(result => {
        if (!cancelled && mountedRef.current) setVerdicts(() => poolVerdictsFromResult(poolCategoryId, cohort, result));
      })
      .catch(caught => {
        if (!cancelled && mountedRef.current)
          setError("DirtyRank could not load the saved verdicts: " + (caught.message || String(caught)));
      });
    return () => {
      cancelled = true;
    };
  }, [cohort, loading, poolCategoryId]);
  const verdictsReady = Boolean(verdicts && verdicts.categoryId === poolCategoryId && verdicts.cohort === cohort);

  function resetPair() {
    cancelFlash();
    setChosen(null);
    setPairInfo(null);
    preparedPairRef.current = null;
    undoHistoryRef.current = [];
    setUndoHistory([]);
    setFeedback(null);
    setDecision(null);
  }

  React.useEffect(() => {
    resetPair();
    preparedImagesRef.current = [];
  }, [requestedCategoryId, requestedCohort]);

  React.useEffect(() => {
    if (loading || !settings || !category) return;
    const targetPath = categoryPath(category!.id, cohort);
    rememberCategory(cohort, category!.id);
    if (
      location.pathname !== targetPath.split("?")[0] ||
      requestedCohort !== (targetPath.indexOf("?") !== -1 ? cohort : "")
    ) {
      history.replace(DirtyPlugins.captureUrl(targetPath));
    }
  }, [category, cohort, gauntletTargetId, history, loading, location.pathname, requestedCohort, settings]);

  function categoryPath(nextCategoryId: string, nextCohort: string) {
    const defaultCohort = battleCohortFor(settings!, gauntletTarget, "");
    return battleCategoryPath(nextCategoryId, gauntletTargetId, linkedBox(defaultCohort, nextCohort));
  }

  function selectCategory(nextCategoryId: string) {
    if (pendingVotes > 0) return;
    navigate(nextCategoryId, cohort);
    setCategoryId(nextCategoryId);
    rememberCategory(cohort, nextCategoryId);
  }

  function selectCohort(nextCohort: string) {
    const nextCategories = categoriesForPerformer(settings!, nextCohort, gauntletTarget);
    const preferredId = preferredCategoryId(settings!, nextCohort, category!.id);
    const nextCategoryId = nextCategories.some(item => item.id === preferredId) ? preferredId : nextCategories[0].id;
    setCategoryId(nextCategoryId);
    rememberCategory(nextCohort, nextCategoryId);
    navigate(nextCategoryId, nextCohort);
  }

  function navigate(nextCategoryId: string, nextCohort: string) {
    history.push(DirtyPlugins.captureUrl(categoryPath(nextCategoryId, nextCohort)));
    resetPair();
  }

  const refinementConfidence = React.useMemo(() => {
    return !gauntletMode && settings && category
      ? categoryConfidence(performers, category, cohort, Object.assign({}, settings, { confidenceGoal: "all" }))
      : null;
  }, [category, cohort, gauntletMode, performers, settings, getRatingIndexRevision()]);

  const selectModePair = React.useCallback(
    (
      sourcePerformers: RankPerformer[],
      sourceCategory: RankCategory,
      sourceCohort: string,
      sourceSettings: RankSettings,
      excluded: Set<string>,
    ) => {
      const target = findTarget(sourcePerformers);
      const poolVerdicts = verdictsRef.current;
      return target
        ? selectGauntletPair(
            sourcePerformers,
            target,
            sourceCategory,
            sourceCohort,
            sourceSettings,
            poolVerdicts,
            excluded,
          )
        : selectPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings, poolVerdicts, excluded);
    },
    [gauntletMode, gauntletTargetId],
  );

  const pickNext = React.useCallback(
    (
      sourcePerformers: RankPerformer[],
      sourceSettings: RankSettings | null,
      sourceCategory: RankCategory | null,
      sourceCohort: string,
      previous?: RankPerformer[] | null,
    ) => {
      if (!sourceSettings || !sourceCategory) return;
      const selected = keepSides(
        previous,
        selectModePair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings, new Set()),
      );
      selected.instanceId = battleId();
      setPairInfo(selected);
      setFeedback(null);
    },
    [selectModePair],
  );

  function preparedPairKey(sourceCategory: RankCategory, sourceCohort: string) {
    return sourceCohort + ":" + sourceCategory.id;
  }

  function preloadPairImages(selected: RankPairResult | null) {
    preparedImagesRef.current = [];
    if (!selected || !selected.pair || settings!.hidePerformerImages || typeof window.Image !== "function") return;
    selected.pair.forEach(performer => {
      if (!performer.image_path) return;
      const image = new window.Image();
      image.decoding = "async";
      image.src = performer.image_path;
      preparedImagesRef.current.push(image);
    });
  }

  function showPreparedOrPickNext() {
    const prepared = preparedPairRef.current;
    const contextKey = category ? preparedPairKey(category!, cohort) : "";
    if (
      prepared &&
      pairInfo &&
      prepared.sourceInstanceId === pairInfo.instanceId &&
      prepared.contextKey === contextKey
    ) {
      preparedPairRef.current = null;
      preparedImagesRef.current = [];
      const next = keepSides(pairInfo.pair, prepared.pairInfo);
      const pair = next.pair;
      // The prepared pair may have been judged by the verdict that was just given.
      const saved = pair ? verdictFor(verdictsRef.current, pair[0].id, pair[1].id) : null;
      setPairInfo(Object.assign({}, next, { saved }));
      setFeedback(null);
      return;
    }
    pickNext(performers, settings, category, cohort, pairInfo ? pairInfo.pair : null);
  }

  React.useEffect(() => {
    if (!loading && !error && verdictsReady && settings && category && !pairInfo && performers.length) {
      pickNext(performers, settings, category, cohort);
    }
  }, [category, cohort, error, loading, pairInfo, performers, pickNext, settings, verdictsReady]);

  React.useEffect(() => {
    preparedPairRef.current = null;
    preparedImagesRef.current = [];
    if (
      loading ||
      error ||
      !verdictsReady ||
      !settings ||
      !category ||
      !pairInfo ||
      !pairInfo!.pair! ||
      performers.length < 2
    )
      return undefined;

    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    function prepareNextPair() {
      if (cancelled) return;
      // The shown pair is about to be judged, so the next pair is another one.
      const shown = new Set([pairToken(pairInfo!.pair![0], pairInfo!.pair![1])]);
      const selected = selectModePair(performers, category!, cohort, settings!, shown);
      selected.instanceId = battleId();
      if (cancelled) return;
      preparedPairRef.current = {
        contextKey: preparedPairKey(category!, cohort),
        pairInfo: selected,
        sourceInstanceId: pairInfo!.instanceId,
      };
      preloadPairImages(selected);
    }

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(prepareNextPair, { timeout: 300 });
    } else {
      timeoutHandle = window.setTimeout(prepareNextPair, 0);
    }
    return () => {
      cancelled = true;
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [category, cohort, error, loading, pairInfo, performers, selectModePair, settings, verdictsReady]);

  /** Persist operations one at a time, after the UI has already moved on. */
  function enqueue(
    operation: () => Promise<RankOperationResult> | null,
    saved: (result: RankOperationResult | null) => void,
    failed: (caught: Error) => void,
  ) {
    pendingVotesRef.current += 1;
    setPendingVotes(pendingVotesRef.current);
    voteQueueRef.current = voteQueueRef.current
      .then(operation)
      .then(saved)
      .catch(failed)
      .finally(() => {
        pendingVotesRef.current = Math.max(0, pendingVotesRef.current - 1);
        if (mountedRef.current) setPendingVotes(pendingVotesRef.current);
      });
  }

  function publishStates(result: RankOperationResult) {
    // A refit can move other performers of the pool too.
    const updates = [result.left, result.right]
      .concat(result.changed || [])
      .filter((update): update is NonNullable<typeof update> => Boolean(update));
    if (updatePerformerStates(updates)) setPerformers(current => current.slice());
  }

  /** Save a verdict from the left performer's side: 3 is "left much better", -3 "right much better". */
  function submit(score: number) {
    if (!pairInfo || !pairInfo!.pair! || !category || !verdictsReady) return;
    if (!Number.isInteger(score) || Math.abs(score) > VERDICT_LIMIT) return;
    if (submittedPairRef.current === pairInfo.instanceId) return;
    const left = pairInfo!.pair![0];
    const right = pairInfo!.pair![1];
    const beforeLeft = poolFor(left, category!.id, cohort, settings!);
    const beforeRight = poolFor(right, category!.id, cohort, settings!);
    const id = battleId(),
      verdictCategoryId = category.id,
      verdictCohort = cohort,
      verdictSettings = settings!;
    const previous = verdictFor(verdictsRef.current, left.id, right.id);
    const confirmation = Boolean(previous && previous.score === score);
    const historyEntry: UndoEntry = {
      id,
      categoryId: verdictCategoryId,
      cohort,
      leftId: left.id,
      rightId: right.id,
      pairInfo,
      previous,
    };
    const operationStatus = { recordFailed: false, undone: false };
    const tone = (side: number) => (score === 0 ? "draw" : score * side > 0 ? "winner" : "loser");
    submittedPairRef.current = pairInfo.instanceId || "";
    setError("");
    setDecision({ id, score, left: { name: left.name, tone: tone(1) }, right: { name: right.name, tone: tone(-1) } });
    updatePool(verdictCategoryId, verdictCohort, current =>
      withVerdict(current, left.id, right.id, chosenVerdict(previous, score)),
    );
    const combinedUndoHistory = undoHistoryRef.current.concat([historyEntry]);
    combinedUndoHistory.slice(0, Math.max(0, combinedUndoHistory.length - UNDO_HISTORY_LIMIT)).forEach(entry => {
      operationStatusRef.current.delete(entry.id);
    });
    const nextUndoHistory = combinedUndoHistory.slice(-UNDO_HISTORY_LIMIT);
    undoHistoryRef.current = nextUndoHistory;
    setUndoHistory(nextUndoHistory);
    operationStatusRef.current.set(id, operationStatus);
    showPreparedOrPickNext();
    setChosen(score);
    cancelFlash();
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null;
      if (mountedRef.current) setChosen(null);
    }, CHOICE_FLASH_MS);
    setFeedback({ text: "Verdict queued" });

    enqueue(
      () =>
        runOperation({
          mode: "record",
          verdictId: id,
          categoryId: verdictCategoryId,
          cohort: verdictCohort,
          leftId: left.id,
          rightId: right.id,
          score,
        }),
      saved => {
        const result = saved!;
        if (!mountedRef.current || operationStatus.undone) return;
        publishStates(result);
        updatePool(verdictCategoryId, verdictCohort, current => applyVerdictResult(current, result));
        if (confirmation) {
          setFeedback({ text: "Verdict confirmed" });
          return;
        }
        const afterLeft = poolFor(left, verdictCategoryId, verdictCohort, verdictSettings);
        const afterRight = poolFor(right, verdictCategoryId, verdictCohort, verdictSettings);
        setFeedback({
          text:
            left.name +
            " " +
            ratingDelta(afterLeft.rating, beforeLeft.rating) +
            " · " +
            right.name +
            " " +
            ratingDelta(afterRight.rating, beforeRight.rating),
        });
      },
      caught => {
        if (!mountedRef.current) return;
        operationStatus.recordFailed = true;
        if (!operationStatus.undone) {
          updatePool(verdictCategoryId, verdictCohort, current => withVerdict(current, left.id, right.id, previous));
          undoHistoryRef.current = undoHistoryRef.current.filter(entry => entry.id !== id);
          setUndoHistory(undoHistoryRef.current.slice());
          setDecision(current => (current && current.id === id ? null : current));
        }
        setError("A queued verdict could not be saved: " + (caught.message || String(caught)));
      },
    );
  }

  function undo() {
    const lastVerdict = undoHistoryRef.current[undoHistoryRef.current.length - 1];
    if (!lastVerdict) return;
    const operationStatus = operationStatusRef.current.get(lastVerdict.id) || { recordFailed: false, undone: false };
    operationStatus.undone = true;
    operationStatusRef.current.set(lastVerdict.id, operationStatus);
    undoHistoryRef.current = undoHistoryRef.current.slice(0, -1);
    setUndoHistory(undoHistoryRef.current.slice());
    cancelFlash();
    setChosen(null);
    setError("");
    updatePool(lastVerdict.categoryId, lastVerdict.cohort, current =>
      withVerdict(current, lastVerdict.leftId, lastVerdict.rightId, lastVerdict.previous),
    );
    setPairInfo(Object.assign({}, lastVerdict.pairInfo, { instanceId: battleId() }));
    setDecision(null);
    setFeedback({ text: "Undo queued" });

    // A verdict that failed to record has nothing to undo on the server.
    enqueue(
      () =>
        operationStatus.recordFailed
          ? null
          : runOperation({
              mode: "undo",
              verdictId: lastVerdict.id,
              categoryId: lastVerdict.categoryId,
              cohort: lastVerdict.cohort,
              leftId: lastVerdict.leftId,
              rightId: lastVerdict.rightId,
            }),
      result => {
        operationStatusRef.current.delete(lastVerdict.id);
        if (!mountedRef.current || !result) return;
        publishStates(result);
        updatePool(lastVerdict.categoryId, lastVerdict.cohort, current => applyVerdictResult(current, result));
        setFeedback({ text: "Verdict undone." });
      },
      caught => {
        if (!mountedRef.current) return;
        setError(
          "A queued undo could not be saved: " +
            (caught.message || String(caught)) +
            ". Reload DirtyRank to reconcile the session.",
        );
      },
    );
  }

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!pairInfo || !pairInfo!.pair!) return;
      const tagName = document.activeElement && document.activeElement.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
      const score = scoreForCode(event.code);
      if (score !== null) {
        event.preventDefault();
        submit(score);
      } else if (event.key === "ArrowDown" || event.key === "u" || event.key === "U") {
        // U goes by the letter it types, so it is U on every layout; a scale key never undoes as well.
        event.preventDefault();
        undo();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  });

  React.useEffect(() => {
    if (pendingVotes <= 0) return undefined;
    function preventPendingOperationExit(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }
    window.addEventListener("beforeunload", preventPendingOperationExit);
    return () => {
      window.removeEventListener("beforeunload", preventPendingOperationExit);
    };
  }, [pendingVotes]);

  return {
    loading: loading || (!error && Boolean(settings && category) && !verdictsReady),
    error,
    settings,
    category,
    gauntletMode,
    censorMedia,
    pairInfo,
    chosen,
    keyLabels,
    performers,
    cohort,
    selectCategory,
    selectCohort,
    pendingVotes,
    feedback,
    decision,
    undoHistory,
    refinementConfidence,
    gauntletTarget,
    load,
    submit,
    undo,
  };
}
