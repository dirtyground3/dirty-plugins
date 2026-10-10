import { PLUGIN_ID, UNDO_HISTORY_LIMIT } from "./constants";
import {
  categoryConfidence,
  selectGauntletPair,
  selectKingsPair,
  selectKingsStartingPair,
  selectPair,
} from "./domain/matchmaking";
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
import {
  CONFIGURATION_CHANGED_EVENT,
  battleCohortFor,
  categoriesForPerformer,
  preferredCategoryId,
  rememberCategory,
  settingsFromConfiguration,
} from "./domain/settings";
import { DirtyPlugins, React, Router, documentationCapture } from "./runtime";
import { linkedBox } from "./domain/navigation";
import type {
  ConfigurationEvent,
  Decision,
  DefeatedKing,
  Feedback,
  PreparedPair,
  RankCategory,
  RankOperationResult,
  RankPairResult,
  RankPerformer,
  RankSettings,
  UndoEntry,
} from "./types";

/** @param {{routeDetails: {categoryId?: string, kingsMode?: boolean}, routeTargetId?: string}} props */
export function useBattleSession(props: {
  routeDetails: { categoryId?: string; kingsMode?: boolean };
  routeTargetId?: string;
}) {
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
  const kingsMode = !gauntletMode && Boolean(routeDetails.kingsMode);
  DirtyPlugins.react.usePageTitle("DirtyRank", gauntletMode ? "Gauntlet" : kingsMode ? "King of the Hill" : "Battles");
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
  const recentPairs = React.useRef<string[]>([]);
  const submittedPairRef = React.useRef("");
  const pendingVotesRef = React.useRef(0);
  const voteQueueRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const mountedRef = React.useRef(true);
  const loadRequestRef = React.useRef(0);
  const undoHistoryRef = React.useRef<UndoEntry[]>([]);
  const defeatedKingsRef = React.useRef<DefeatedKing[]>([]);
  const operationStatusRef = React.useRef(new Map<string, { recordFailed: boolean; undone: boolean }>());
  const preparedPairRef = React.useRef<PreparedPair | null>(null);
  const preparedImagesRef = React.useRef<HTMLImageElement[]>([]);

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
          defeatedKingsRef.current = [];
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
    mountedRef.current = true;
    void load();
    function changed(event: ConfigurationEvent) {
      if (!event.detail || event.detail.pluginId === PLUGIN_ID) void load(true);
    }
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, changed);
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
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

  function resetPair() {
    setPairInfo(null);
    preparedPairRef.current = null;
    undoHistoryRef.current = [];
    defeatedKingsRef.current = [];
    setUndoHistory([]);
    setFeedback(null);
    setDecision(null);
  }

  React.useEffect(() => {
    resetPair();
    preparedImagesRef.current = [];
    recentPairs.current = [];
  }, [requestedCategoryId, requestedCohort, kingsMode]);

  React.useEffect(() => {
    if (loading || !settings || !category) return;
    const targetPath = categoryPath(category!.id, kingsMode, cohort);
    rememberCategory(cohort, category!.id);
    if (
      location.pathname !== targetPath.split("?")[0] ||
      requestedCohort !== (targetPath.indexOf("?") !== -1 ? cohort : "")
    ) {
      history.replace(DirtyPlugins.captureUrl(targetPath));
    }
  }, [category, cohort, gauntletTargetId, history, kingsMode, loading, location.pathname, requestedCohort, settings]);

  function categoryPath(nextCategoryId: string, nextKingsMode: boolean, nextCohort: string) {
    const defaultCohort = battleCohortFor(settings!, gauntletTarget, "");
    return battleCategoryPath(nextCategoryId, nextKingsMode, gauntletTargetId, linkedBox(defaultCohort, nextCohort));
  }

  /** @param {string} nextCategoryId */
  function selectCategory(nextCategoryId: string) {
    if (pendingVotes > 0) return;
    navigate(nextCategoryId, kingsMode, cohort);
    setCategoryId(nextCategoryId);
    rememberCategory(cohort, nextCategoryId);
  }

  function toggleBattleMode() {
    if (pendingVotes > 0) return;
    navigate(category!.id, !kingsMode, cohort);
  }

  /** @param {string} nextCohort */
  function selectCohort(nextCohort: string) {
    const nextCategories = categoriesForPerformer(settings!, nextCohort, gauntletTarget);
    const preferredId = preferredCategoryId(settings!, nextCohort, category!.id);
    const nextCategoryId = nextCategories.some(item => item.id === preferredId) ? preferredId : nextCategories[0].id;
    setCategoryId(nextCategoryId);
    rememberCategory(nextCohort, nextCategoryId);
    navigate(nextCategoryId, kingsMode, nextCohort);
  }

  /** @param {string} nextCategoryId @param {boolean} nextKingsMode @param {string} nextCohort */
  function navigate(nextCategoryId: string, nextKingsMode: boolean, nextCohort: string) {
    const nextPath = categoryPath(nextCategoryId, nextKingsMode, nextCohort);
    history.push(DirtyPlugins.captureUrl(nextPath));
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
      sourceRecentPairs: string[],
    ) => {
      if (kingsMode) return selectKingsStartingPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings);
      const target = findTarget(sourcePerformers);
      return target
        ? selectGauntletPair(sourcePerformers, target, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs)
        : selectPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs);
    },
    [gauntletMode, gauntletTargetId, kingsMode],
  );

  const pickNext = React.useCallback(
    (
      sourcePerformers: RankPerformer[],
      sourceSettings: RankSettings | null,
      sourceCategory: RankCategory | null,
      sourceCohort: string,
    ) => {
      if (!sourceSettings || !sourceCategory) return;
      const selected = selectModePair(
        sourcePerformers,
        sourceCategory,
        sourceCohort,
        sourceSettings,
        recentPairs.current,
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

  function showPreparedOrPickNext(outcome: string) {
    if (kingsMode) {
      if (outcome === "left" || outcome === "right") {
        const winner = pairInfo!.pair![outcome === "left" ? 0 : 1];
        const selected = selectKingsPair(
          performers,
          winner,
          outcome,
          defeatedKingsRef.current.map(entry => entry.performerId),
          category!,
          cohort,
          settings!,
        );
        selected.instanceId = battleId();
        setPairInfo(selected);
        setFeedback(null);
      } else {
        pickNext(performers, settings, category, cohort);
      }
      return;
    }
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
      setPairInfo(prepared.pairInfo);
      setFeedback(null);
      return;
    }
    pickNext(performers, settings, category, cohort);
  }

  React.useEffect(() => {
    if (!loading && !error && settings && category && !pairInfo && performers.length) {
      pickNext(performers, settings, category, cohort);
    }
  }, [category, cohort, error, loading, pairInfo, performers, pickNext, settings]);

  React.useEffect(() => {
    preparedPairRef.current = null;
    preparedImagesRef.current = [];
    if (
      loading ||
      error ||
      kingsMode ||
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
      const simulatedRecentPairs = recentPairs.current.concat([pairToken(pairInfo!.pair![0], pairInfo!.pair![1])]);
      const selected = selectModePair(performers, category!, cohort, settings!, simulatedRecentPairs);
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
  }, [category, cohort, error, kingsMode, loading, pairInfo, performers, selectModePair, settings]);

  /** Avoid repeating a pair that was just shown, voted on or skipped. */
  function rememberPair(left: RankPerformer, right: RankPerformer) {
    recentPairs.current.push(pairToken(left, right));
    recentPairs.current = recentPairs.current.slice(-Math.max(50, settings!.avoidRepeatWindow));
  }

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
    const updates = [result.left, result.right].filter((update): update is NonNullable<typeof update> =>
      Boolean(update),
    );
    if (updatePerformerStates(updates)) setPerformers(current => current.slice());
  }

  function submit(outcome: string) {
    if (!pairInfo || !pairInfo!.pair! || !category) return;
    if (kingsMode && outcome === "draw") return;
    if (submittedPairRef.current === pairInfo.instanceId) return;
    const left = pairInfo!.pair![0];
    const right = pairInfo!.pair![1];
    const beforeLeft = poolFor(left, category!.id, cohort, settings!);
    const beforeRight = poolFor(right, category!.id, cohort, settings!);
    const id = battleId(),
      battleCategoryId = category.id,
      battleSettings = settings!;
    const historyEntry = { id, categoryId: battleCategoryId, cohort, leftId: left.id, rightId: right.id, pairInfo };
    const operationStatus = { recordFailed: false, undone: false };
    const leftTone = outcome === "draw" ? "draw" : outcome === "left" ? "winner" : "loser";
    const rightTone = outcome === "draw" ? "draw" : outcome === "right" ? "winner" : "loser";
    submittedPairRef.current = pairInfo.instanceId || "";
    setError("");
    setDecision({ id, left: { name: left.name, tone: leftTone }, right: { name: right.name, tone: rightTone } });
    rememberPair(left, right);
    const combinedUndoHistory = undoHistoryRef.current.concat([historyEntry]);
    combinedUndoHistory.slice(0, Math.max(0, combinedUndoHistory.length - UNDO_HISTORY_LIMIT)).forEach(entry => {
      operationStatusRef.current.delete(entry.id);
    });
    const nextUndoHistory = combinedUndoHistory.slice(-UNDO_HISTORY_LIMIT);
    undoHistoryRef.current = nextUndoHistory;
    setUndoHistory(nextUndoHistory);
    operationStatusRef.current.set(id, operationStatus);
    if (kingsMode) {
      defeatedKingsRef.current.push({ battleId: id, performerId: String(outcome === "left" ? right.id : left.id) });
    }
    showPreparedOrPickNext(outcome);
    setFeedback({ text: "Vote queued" });

    enqueue(
      () =>
        runOperation({
          mode: "record",
          battleId: id,
          categoryId: battleCategoryId,
          cohort,
          leftId: left.id,
          rightId: right.id,
          outcome,
        }),
      saved => {
        const result = saved!;
        if (!mountedRef.current || operationStatus.undone) return;
        publishStates(result);
        const afterLeft = poolFor(left, battleCategoryId, cohort, battleSettings);
        const afterRight = poolFor(right, battleCategoryId, cohort, battleSettings);
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
          undoHistoryRef.current = undoHistoryRef.current.filter(entry => entry.id !== id);
          setUndoHistory(undoHistoryRef.current.slice());
          setDecision(current => (current && current.id === id ? null : current));
        }
        setError("A queued vote could not be saved: " + (caught.message || String(caught)));
      },
    );
  }

  function skip() {
    if (kingsMode) return;
    if (!pairInfo || !pairInfo!.pair! || !category) return;
    rememberPair(pairInfo.pair[0], pairInfo.pair[1]);
    setDecision(null);
    showPreparedOrPickNext("skip");
  }

  function undo() {
    const lastBattle = undoHistoryRef.current[undoHistoryRef.current.length - 1];
    if (!lastBattle) return;
    const operationStatus = operationStatusRef.current.get(lastBattle.id) || { recordFailed: false, undone: false };
    operationStatus.undone = true;
    operationStatusRef.current.set(lastBattle.id, operationStatus);
    undoHistoryRef.current = undoHistoryRef.current.slice(0, -1);
    defeatedKingsRef.current = defeatedKingsRef.current.filter(entry => entry.battleId !== lastBattle.id);
    setUndoHistory(undoHistoryRef.current.slice());
    setError("");
    setPairInfo(Object.assign({}, lastBattle.pairInfo, { instanceId: battleId() }));
    setDecision(null);
    setFeedback({ text: "Undo queued" });

    // A vote that failed to record has nothing to undo on the server.
    enqueue(
      () =>
        operationStatus.recordFailed
          ? null
          : runOperation({
              mode: "undo",
              battleId: lastBattle.id,
              categoryId: lastBattle.categoryId,
              cohort: lastBattle.cohort,
              leftId: lastBattle.leftId,
              rightId: lastBattle.rightId,
            }),
      result => {
        operationStatusRef.current.delete(lastBattle.id);
        if (!mountedRef.current || !result) return;
        publishStates(result);
        setFeedback({ text: "Battle undone." });
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

  function restartKings() {
    if (pendingVotesRef.current > 0) return;
    resetPair();
    recentPairs.current = [];
  }

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !pairInfo || !pairInfo!.pair!) return;
      const tagName = document.activeElement && document.activeElement.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        submit("left");
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        submit("right");
      }
      if (!kingsMode && event.key === "ArrowUp") {
        event.preventDefault();
        submit("draw");
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        undo();
      }
      if (!kingsMode && event.key.toLowerCase() === "t") {
        event.preventDefault();
        submit("draw");
      }
      if (!kingsMode && event.key.toLowerCase() === "s") {
        event.preventDefault();
        skip();
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
    loading,
    error,
    settings,
    category,
    gauntletMode,
    kingsMode,
    censorMedia,
    pairInfo,
    performers,
    cohort,
    defeatedCount: defeatedKingsRef.current.length,
    selectCategory,
    toggleBattleMode,
    selectCohort,
    pendingVotes,
    feedback,
    decision,
    undoHistory,
    refinementConfidence,
    gauntletTarget,
    load,
    submit,
    skip,
    undo,
    restartKings,
  };
}
