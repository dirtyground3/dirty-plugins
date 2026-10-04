// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyRankBattleSession";
  if (window[INSTANCE_KEY]) return;

  /** Native rendering APIs and plugin-owned domain callbacks.
   * @param {RankBattleSessionDependencies} dependencies
   */
  function createBattleSession(dependencies) {
    var CONFIGURATION_CHANGED_EVENT = dependencies.CONFIGURATION_CHANGED_EVENT;
    var DirtyPlugins = dependencies.DirtyPlugins;
    var PLUGIN_ID = dependencies.PLUGIN_ID;
    var Router = dependencies.Router;
    var UNDO_HISTORY_LIMIT = dependencies.UNDO_HISTORY_LIMIT;
    var battleCategoryPath = dependencies.battleCategoryPath;
    var battleCohortFor = dependencies.battleCohortFor;
    var battleId = dependencies.battleId;
    var categoriesForPerformer = dependencies.categoriesForPerformer;
    var categoryConfidence = dependencies.categoryConfidence;
    var cohortLabel = dependencies.cohortLabel;
    var documentationCapture = dependencies.documentationCapture;
    var loadNativePerformerCard = dependencies.loadNativePerformerCard;
    var loadRatingIndex = dependencies.loadRatingIndex;
    var pairToken = dependencies.pairToken;
    var poolFor = dependencies.poolFor;
    var preferredCategoryId = dependencies.preferredCategoryId;
    var queryPerformers = dependencies.queryPerformers;
    var ratingDelta = dependencies.ratingDelta;
    var rememberCategory = dependencies.rememberCategory;
    var runOperation = dependencies.runOperation;
    var selectGauntletPair = dependencies.selectGauntletPair;
    var selectKingsPair = dependencies.selectKingsPair;
    var selectKingsStartingPair = dependencies.selectKingsStartingPair;
    var selectPair = dependencies.selectPair;
    var settingsFromConfiguration = dependencies.settingsFromConfiguration;
    var updatePerformerState = dependencies.updatePerformerState;
    var useCallback = dependencies.useCallback;
    var useEffect = dependencies.useEffect;
    var useMemo = dependencies.useMemo;
    var useRef = dependencies.useRef;
    var useState = dependencies.useState;
    var getRatingIndexRevision = dependencies.getRatingIndexRevision;

    /** @param {{routeDetails: {categoryId?: string, kingsMode?: boolean}, routeTargetId?: string}} props */
    function useBattleSession(props) {
      var routeDetails = props.routeDetails;
      var routeTargetId = props.routeTargetId;
      var requestedCategoryId = routeDetails.categoryId;
      var history = Router.useHistory();
      var location = Router.useLocation();
      var requestedCohort = new URLSearchParams(location.search).get("box") || new URLSearchParams(location.search).get("cohort") || "";
      var gauntletTargetId = routeTargetId;
      var gauntletMode = Boolean(gauntletTargetId);
      var censorMedia = documentationCapture();
      var kingsMode = !gauntletMode && routeDetails.kingsMode;
      DirtyPlugins.react.usePageTitle("DirtyRank", gauntletMode ? "Gauntlet" : kingsMode ? "King of the Hill" : "Battles");
      var settingsState = useState(null);
      var settings = settingsState[0];
      var setSettings = settingsState[1];
      var performersState = useState([]);
      var performers = performersState[0];
      var setPerformers = performersState[1];
      var cohort = settings ? battleCohortFor(settings, gauntletMode ? performers.find(function (performer) {
        return String(performer.id) === gauntletTargetId;
      }) : null, requestedCohort) : "";
      var requestedContextRef = useRef({});
      requestedContextRef.current = { cohort: requestedCohort, categoryId: requestedCategoryId };
      var categoryState = useState("");
      var categoryId = categoryState[0];
      var setCategoryId = categoryState[1];
      var pairState = useState(null);
      var pairInfo = pairState[0];
      var setPairInfo = pairState[1];
      var loadingState = useState(true);
      var loading = loadingState[0];
      var setLoading = loadingState[1];
      var errorState = useState("");
      var error = errorState[0];
      var setError = errorState[1];
      var feedbackState = useState(null);
      var feedback = feedbackState[0];
      var setFeedback = feedbackState[1];
      var decisionState = useState(null);
      var decision = decisionState[0];
      var setDecision = decisionState[1];
      var undoHistoryState = useState([]);
      var undoHistory = undoHistoryState[0];
      var setUndoHistory = undoHistoryState[1];
      var pendingState = useState(0);
      var pendingVotes = pendingState[0];
      var setPendingVotes = pendingState[1];
      var recentPairs = useRef([]);
      var submittedPairRef = useRef("");
      var pendingVotesRef = useRef(0);
      var voteQueueRef = useRef(Promise.resolve());
      var mountedRef = useRef(true);
      var undoHistoryRef = useRef([]);
      var defeatedKingsRef = useRef([]);
      var operationStatusRef = useRef(new Map());
      var preparedPairRef = useRef(null);
      var preparedImagesRef = useRef([]);

      var load = useCallback(function () {
        setLoading(true);
        setError("");
        return Promise.all([DirtyPlugins.getPluginSettings(PLUGIN_ID), queryPerformers(true), loadRatingIndex(), loadNativePerformerCard()])
          .then(function (values) {
            var nextSettings = settingsFromConfiguration(values[0]);
            var gauntletTarget = gauntletMode
              ? values[1].find(function (performer) { return String(performer.id) === gauntletTargetId; })
              : null;
            if (gauntletMode && !gauntletTarget) throw new Error("The selected Gauntlet performer could not be found.");
            var requestedContext = requestedContextRef.current;
            var nextCohort = battleCohortFor(nextSettings, gauntletTarget, requestedContext.cohort);
            if (!nextCohort) {
              throw new Error("Enable a category that includes " + cohortLabel(gauntletTarget ? gauntletTarget.gender : nextSettings.defaultCohort) + " performers in DirtyRank settings.");
            }
            var enabled = categoriesForPerformer(nextSettings, nextCohort, gauntletTarget);
            if (!enabled.length) throw new Error("Enable at least one DirtyRank category for the selected performer cohort.");
            setSettings(nextSettings);
            setPerformers(values[1]);
            setCategoryId(function (current) {
              if (enabled.some(function (item) { return item.id === requestedContext.categoryId; })) return requestedContext.categoryId;
              return preferredCategoryId(nextSettings, nextCohort, current);
            });
            setPairInfo(null);
            setDecision(null);
            undoHistoryRef.current = [];
            defeatedKingsRef.current = [];
            setUndoHistory([]);
          })
          .catch(function (caught) { setError(caught.message || String(caught)); })
          .finally(function () { setLoading(false); });
      }, [gauntletMode, gauntletTargetId]);

      useEffect(function () {
        mountedRef.current = true;
        void load();
        function changed(event) {
          if (!event.detail || event.detail.pluginId === PLUGIN_ID) void load();
        }
        window.addEventListener(CONFIGURATION_CHANGED_EVENT, changed);
        return function () {
          mountedRef.current = false;
          window.removeEventListener(CONFIGURATION_CHANGED_EVENT, changed);
        };
      }, [load]);

      var category = useMemo(function () {
        if (!settings) return null;
        var target = gauntletMode ? performers.find(function (performer) { return String(performer.id) === gauntletTargetId; }) : null;
        var cohortCategories = categoriesForPerformer(settings, cohort, target);
        return cohortCategories.find(function (item) { return item.id === (requestedCategoryId || categoryId); }) ||
          cohortCategories[0] || null;
      }, [categoryId, cohort, settings, requestedCategoryId, gauntletMode, gauntletTargetId, performers]);

      function resetPair() {
        setPairInfo(null);
        preparedPairRef.current = null;
        undoHistoryRef.current = [];
        defeatedKingsRef.current = [];
        setUndoHistory([]);
        setFeedback(null);
        setDecision(null);
      }

      useEffect(function () {
        resetPair();
        preparedImagesRef.current = [];
        recentPairs.current = [];
      }, [requestedCategoryId, requestedCohort, kingsMode]);

      useEffect(function () {
        if (loading || !settings || !category) return;
        var targetPath = categoryPath(category.id, kingsMode, cohort);
        rememberCategory(cohort, category.id);
        if (location.pathname !== targetPath.split("?")[0] || requestedCohort !== (targetPath.indexOf("?") !== -1 ? cohort : "")) {
          history.replace(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(targetPath) : targetPath);
        }
      }, [category, cohort, gauntletTargetId, history, kingsMode, loading, location.pathname, requestedCohort, settings]);

      var gauntletTarget = useMemo(function () {
        if (!gauntletMode) return null;
        return performers.find(function (performer) { return String(performer.id) === gauntletTargetId; }) || null;
      }, [gauntletMode, gauntletTargetId, performers]);

      function categoryPath(nextCategoryId, nextKingsMode, nextCohort) {
        var defaultCohort = battleCohortFor(settings, gauntletTarget, "");
        return battleCategoryPath(nextCategoryId, nextKingsMode, gauntletTargetId, nextCohort === defaultCohort && nextCohort.indexOf("BOX-") !== 0 ? "" : nextCohort);
      }

      /** @param {string} nextCategoryId */
      function selectCategory(nextCategoryId) {
        if (pendingVotes > 0) return;
        navigate(nextCategoryId, kingsMode, cohort);
        setCategoryId(nextCategoryId);
        rememberCategory(cohort, nextCategoryId);
      }

      function toggleBattleMode() {
        if (pendingVotes > 0) return;
        navigate(category.id, !kingsMode, cohort);
      }

      /** @param {string} nextCohort */
      function selectCohort(nextCohort) {
        var nextCategories = categoriesForPerformer(settings, nextCohort, gauntletTarget);
        var preferredId = preferredCategoryId(settings, nextCohort, category.id);
        var nextCategoryId = nextCategories.some(function (item) { return item.id === preferredId; }) ? preferredId : nextCategories[0].id;
        setCategoryId(nextCategoryId);
        rememberCategory(nextCohort, nextCategoryId);
        navigate(nextCategoryId, kingsMode, nextCohort);
      }

      /** @param {string} nextCategoryId @param {boolean} nextKingsMode @param {string} nextCohort */
      function navigate(nextCategoryId, nextKingsMode, nextCohort) {
        var nextPath = categoryPath(nextCategoryId, nextKingsMode, nextCohort);
        history.push(DirtyPlugins.captureUrl ? DirtyPlugins.captureUrl(nextPath) : nextPath);
        resetPair();
      }

      var refinementConfidence = useMemo(function () {
        return !gauntletMode && settings && category ? categoryConfidence(
          performers, category, cohort, Object.assign({}, settings, { confidenceGoal: "all" })
        ) : null;
      }, [category, cohort, gauntletMode, performers, settings, getRatingIndexRevision()]);

      var selectModePair = useCallback(function (sourcePerformers, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs) {
        if (kingsMode) return selectKingsStartingPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings);
        var target = gauntletMode
          ? sourcePerformers.find(function (performer) { return String(performer.id) === gauntletTargetId; })
          : null;
        return target
          ? selectGauntletPair(sourcePerformers, target, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs)
          : selectPair(sourcePerformers, sourceCategory, sourceCohort, sourceSettings, sourceRecentPairs);
      }, [gauntletMode, gauntletTargetId, kingsMode]);

      var pickNext = useCallback(function (sourcePerformers, sourceSettings, sourceCategory, sourceCohort) {
        if (!sourceSettings || !sourceCategory) return;
        var selected = selectModePair(
          sourcePerformers,
          sourceCategory,
          sourceCohort,
          sourceSettings,
          recentPairs.current
        );
        selected.instanceId = battleId();
        setPairInfo(selected);
        setFeedback(null);
      }, [selectModePair]);

      function preparedPairKey(sourceCategory, sourceCohort) {
        return sourceCohort + ":" + sourceCategory.id;
      }

      function preloadPairImages(selected) {
        preparedImagesRef.current = [];
        if (!selected || !selected.pair || settings.hidePerformerImages || typeof window.Image !== "function") return;
        selected.pair.forEach(function (performer) {
          if (!performer.image_path) return;
          var image = new window.Image();
          image.decoding = "async";
          image.src = performer.image_path;
          preparedImagesRef.current.push(image);
        });
      }

      function showPreparedOrPickNext(outcome) {
        if (kingsMode) {
          if (outcome === "left" || outcome === "right") {
            var winner = pairInfo.pair[outcome === "left" ? 0 : 1];
            var selected = selectKingsPair(performers, winner, outcome, defeatedKingsRef.current.map(function (entry) {
              return entry.performerId;
            }), category, cohort, settings);
            selected.instanceId = battleId();
            setPairInfo(selected);
            setFeedback(null);
          } else {
            pickNext(performers, settings, category, cohort);
          }
          return;
        }
        var prepared = preparedPairRef.current;
        var contextKey = category ? preparedPairKey(category, cohort) : "";
        if (prepared && pairInfo && prepared.sourceInstanceId === pairInfo.instanceId && prepared.contextKey === contextKey) {
          preparedPairRef.current = null;
          preparedImagesRef.current = [];
          setPairInfo(prepared.pairInfo);
          setFeedback(null);
          return;
        }
        pickNext(performers, settings, category, cohort);
      }

      useEffect(function () {
        if (!loading && !error && settings && category && !pairInfo && performers.length) {
          pickNext(performers, settings, category, cohort);
        }
      }, [category, cohort, error, loading, pairInfo, performers, pickNext, settings]);

      useEffect(function () {
        preparedPairRef.current = null;
        preparedImagesRef.current = [];
        if (loading || error || kingsMode || !settings || !category || !pairInfo || !pairInfo.pair || performers.length < 2) return undefined;

        var cancelled = false;
        var idleHandle = null;
        var timeoutHandle = null;
        function prepareNextPair() {
          if (cancelled) return;
          var simulatedRecentPairs = recentPairs.current.concat([pairToken(pairInfo.pair[0], pairInfo.pair[1])]);
          var selected = selectModePair(performers, category, cohort, settings, simulatedRecentPairs);
          selected.instanceId = battleId();
          if (cancelled) return;
          preparedPairRef.current = {
            contextKey: preparedPairKey(category, cohort),
            pairInfo: selected,
            sourceInstanceId: pairInfo.instanceId,
          };
          preloadPairImages(selected);
        }

        if (typeof window.requestIdleCallback === "function") {
          idleHandle = window.requestIdleCallback(prepareNextPair, { timeout: 300 });
        } else {
          timeoutHandle = window.setTimeout(prepareNextPair, 0);
        }
        return function () {
          cancelled = true;
          if (idleHandle !== null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
          if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
        };
      }, [category, cohort, error, kingsMode, loading, pairInfo, performers, selectModePair, settings]);

      function replaceStates(result, source) {
        return source.map(function (performer) {
          if (result.left && performer.id === result.left.id) return updatePerformerState(performer, result.left.state);
          if (result.right && performer.id === result.right.id) return updatePerformerState(performer, result.right.state);
          return performer;
        });
      }

      function submit(outcome) {
        if (!pairInfo || !pairInfo.pair || !category) return;
        if (kingsMode && outcome === "draw") return;
        if (submittedPairRef.current === pairInfo.instanceId) return;
        var left = pairInfo.pair[0];
        var right = pairInfo.pair[1];
        var beforeLeft = poolFor(left, category.id, cohort, settings);
        var beforeRight = poolFor(right, category.id, cohort, settings);
        var id = battleId();
        var queuedBattle = {
          id: id,
          categoryId: category.id,
          category: category,
          cohort: cohort,
          left: left,
          right: right,
          outcome: outcome,
          pairInfo: pairInfo,
          beforeLeft: beforeLeft,
          beforeRight: beforeRight,
          settings: settings,
        };
        var historyEntry = {
          id: queuedBattle.id,
          categoryId: queuedBattle.categoryId,
          cohort: queuedBattle.cohort,
          leftId: queuedBattle.left.id,
          rightId: queuedBattle.right.id,
          pairInfo: queuedBattle.pairInfo,
        };
        var operationStatus = { recordFailed: false, undone: false };
        var leftTone = outcome === "draw" ? "draw" : outcome === "left" ? "winner" : "loser";
        var rightTone = outcome === "draw" ? "draw" : outcome === "right" ? "winner" : "loser";
        submittedPairRef.current = pairInfo.instanceId;
        setError("");
        setDecision({
          id: id,
          left: { name: left.name, tone: leftTone },
          right: { name: right.name, tone: rightTone },
        });
        recentPairs.current.push(pairToken(left, right));
        recentPairs.current = recentPairs.current.slice(-Math.max(50, settings.avoidRepeatWindow));
        var combinedUndoHistory = undoHistoryRef.current.concat([historyEntry]);
        combinedUndoHistory.slice(0, Math.max(0, combinedUndoHistory.length - UNDO_HISTORY_LIMIT)).forEach(function (entry) {
          operationStatusRef.current.delete(entry.id);
        });
        var nextUndoHistory = combinedUndoHistory.slice(-UNDO_HISTORY_LIMIT);
        undoHistoryRef.current = nextUndoHistory;
        setUndoHistory(nextUndoHistory);
        operationStatusRef.current.set(queuedBattle.id, operationStatus);
        if (kingsMode) {
          defeatedKingsRef.current.push({ battleId: id, performerId: String(outcome === "left" ? right.id : left.id) });
        }
        showPreparedOrPickNext(outcome);
        setFeedback({ text: "Vote queued" });

        pendingVotesRef.current += 1;
        setPendingVotes(pendingVotesRef.current);
        voteQueueRef.current = voteQueueRef.current.then(function () {
          return runOperation({
            mode: "record",
            battleId: queuedBattle.id,
            categoryId: queuedBattle.categoryId,
            cohort: queuedBattle.cohort,
            leftId: queuedBattle.left.id,
            rightId: queuedBattle.right.id,
            outcome: queuedBattle.outcome,
          });
        }).then(function (result) {
          if (!mountedRef.current || operationStatus.undone) return;
          var afterLeft = poolFor(updatePerformerState(queuedBattle.left, result.left.state), queuedBattle.categoryId, queuedBattle.cohort, queuedBattle.settings);
          var afterRight = poolFor(updatePerformerState(queuedBattle.right, result.right.state), queuedBattle.categoryId, queuedBattle.cohort, queuedBattle.settings);
          setPerformers(function (current) { return replaceStates(result, current); });
          setFeedback({
            text: queuedBattle.left.name + " " + ratingDelta(afterLeft.rating, queuedBattle.beforeLeft.rating) + " · " +
              queuedBattle.right.name + " " + ratingDelta(afterRight.rating, queuedBattle.beforeRight.rating),
          });
        }).catch(function (caught) {
          if (!mountedRef.current) return;
          operationStatus.recordFailed = true;
          if (!operationStatus.undone) {
            undoHistoryRef.current = undoHistoryRef.current.filter(function (entry) { return entry.id !== queuedBattle.id; });
            setUndoHistory(undoHistoryRef.current.slice());
            setDecision(function (current) { return current && current.id === queuedBattle.id ? null : current; });
          }
          setError("A queued vote could not be saved: " + (caught.message || String(caught)));
        }).finally(function () {
          pendingVotesRef.current = Math.max(0, pendingVotesRef.current - 1);
          if (mountedRef.current) setPendingVotes(pendingVotesRef.current);
        });
      }

      function skip() {
        if (kingsMode) return;
        if (!pairInfo || !pairInfo.pair || !category) return;
        recentPairs.current.push(pairToken(pairInfo.pair[0], pairInfo.pair[1]));
        recentPairs.current = recentPairs.current.slice(-Math.max(50, settings.avoidRepeatWindow));
        setDecision(null);
        showPreparedOrPickNext("skip");
      }

      function undo() {
        var lastBattle = undoHistoryRef.current[undoHistoryRef.current.length - 1];
        if (!lastBattle) return;
        var operationStatus = operationStatusRef.current.get(lastBattle.id) || { recordFailed: false, undone: false };
        operationStatus.undone = true;
        operationStatusRef.current.set(lastBattle.id, operationStatus);
        undoHistoryRef.current = undoHistoryRef.current.slice(0, -1);
        defeatedKingsRef.current = defeatedKingsRef.current.filter(function (entry) { return entry.battleId !== lastBattle.id; });
        setUndoHistory(undoHistoryRef.current.slice());
        setError("");
        setPairInfo(Object.assign({}, lastBattle.pairInfo, { instanceId: battleId() }));
        setDecision(null);
        setFeedback({ text: "Undo queued" });

        pendingVotesRef.current += 1;
        setPendingVotes(pendingVotesRef.current);
        voteQueueRef.current = voteQueueRef.current.then(function () {
          if (operationStatus.recordFailed) return null;
          return runOperation({
            mode: "undo",
            battleId: lastBattle.id,
            categoryId: lastBattle.categoryId,
            cohort: lastBattle.cohort,
            leftId: lastBattle.leftId,
            rightId: lastBattle.rightId,
          });
        }).then(function (result) {
          operationStatusRef.current.delete(lastBattle.id);
          if (!mountedRef.current || !result) return;
          setPerformers(function (current) { return replaceStates(result, current); });
          setFeedback({ text: "Battle undone." });
        }).catch(function (caught) {
          if (!mountedRef.current) return;
          setError("A queued undo could not be saved: " + (caught.message || String(caught)) + ". Reload DirtyRank to reconcile the session.");
        }).finally(function () {
          pendingVotesRef.current = Math.max(0, pendingVotesRef.current - 1);
          if (mountedRef.current) setPendingVotes(pendingVotesRef.current);
        });
      }

      function restartKings() {
        if (pendingVotesRef.current > 0) return;
        defeatedKingsRef.current = [];
        undoHistoryRef.current = [];
        recentPairs.current = [];
        setUndoHistory([]);
        setPairInfo(null);
        setDecision(null);
        setFeedback(null);
      }

      useEffect(function () {
        function onKeyDown(event) {
          if (event.defaultPrevented || !pairInfo || !pairInfo.pair) return;
          var tagName = document.activeElement && document.activeElement.tagName;
          if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
          if (event.key === "ArrowLeft") { event.preventDefault(); submit("left"); }
          if (event.key === "ArrowRight") { event.preventDefault(); submit("right"); }
          if (!kingsMode && event.key === "ArrowUp") { event.preventDefault(); submit("draw"); }
          if (event.key === "ArrowDown") { event.preventDefault(); undo(); }
          if (!kingsMode && event.key.toLowerCase() === "t") { event.preventDefault(); submit("draw"); }
          if (!kingsMode && event.key.toLowerCase() === "s") { event.preventDefault(); skip(); }
        }
        document.addEventListener("keydown", onKeyDown);
        return function () { document.removeEventListener("keydown", onKeyDown); };
      });

      useEffect(function () {
        if (pendingVotes <= 0) return undefined;
        function preventPendingOperationExit(event) {
          event.preventDefault();
          event.returnValue = "";
          return "";
        }
        window.addEventListener("beforeunload", preventPendingOperationExit);
        return function () { window.removeEventListener("beforeunload", preventPendingOperationExit); };
      }, [pendingVotes]);


      return {
        loading: loading,
        error: error,
        settings: settings,
        category: category,
        gauntletMode: gauntletMode,
        kingsMode: kingsMode,
        censorMedia: censorMedia,
        pairInfo: pairInfo,
        performers: performers,
        cohort: cohort,
        defeatedCount: defeatedKingsRef.current.length,
        selectCategory: selectCategory,
        toggleBattleMode: toggleBattleMode,
        selectCohort: selectCohort,
        pendingVotes: pendingVotes,
        feedback: feedback,
        decision: decision,
        undoHistory: undoHistory,
        refinementConfidence: refinementConfidence,
        gauntletTarget: gauntletTarget,
        load: load,
        submit: submit,
        skip: skip,
        undo: undo,
        restartKings: restartKings,
      };
    }
    return useBattleSession;
  }

  window[INSTANCE_KEY] = { createBattleSession: createBattleSession };
})();
