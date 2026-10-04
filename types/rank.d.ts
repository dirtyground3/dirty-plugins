interface RankCategory {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  weight: number | string;
}

interface RankGenderBox {
  id: string;
  name: string;
  enabled: boolean;
  genders: string[];
}

/** Editable settings retain numeric strings until validation succeeds. */
interface RankSettingsDraft {
  genderBoxes: RankGenderBox[];
  categoriesByCohort: Record<string, RankCategory[]>;
  enabledCohorts: string[];
  defaultCohort: string;
  overallScoreStrategy: string;
  showBattlesInMenu: boolean;
  showLeaderboardsInMenu: boolean;
  leaderboardTopCount: number | string;
  leaderboardPerformerCount: number | string;
  leaderboardView: string;
  overallPower: number | string;
  showRatingsBeforeVote: boolean;
  hidePerformerImages: boolean;
  hideBattleStandings: boolean;
  autoPlayTopScenes: boolean;
  includePerformersWithoutImages: boolean;
  confidenceGoal: string;
  confidenceTopN: number | string;
  avoidRepeatWindow: number | string;
  calibrationPercent: number | string;
  initialRating: number | string;
  initialDeviation: number | string;
  initialVolatility: number | string;
  evidenceWeight: number | string;
  tau: number | string;
  deviationFloor: number | string;
  provisionalDeviation: number | string;
}

/** Section callbacks own edits; section rendering never persists settings. */
interface RankSettingsSectionProps {
  draft: RankSettingsDraft;
  changed?: (update: Partial<RankSettingsDraft>) => void;
  busy?: boolean;
  saving?: boolean;
  dirty?: boolean;
  editingCohort?: string;
  editingCategories?: RankCategory[];
  setEditingCohort?: (cohort: string) => void;
  categoryNameError?: (category: RankCategory, index: number) => string;
  updateCategory?: (index: number, update: Partial<RankCategory>) => void;
  moveCategory?: (index: number, direction: number) => void;
  removeCategory?: (index: number) => void;
  addCategory?: () => void;
  resetCategoryPool?: (cohort: string, category: RankCategory) => void;
  toggleCohort?: (cohort: string, enabled: boolean) => void;
  updateBox?: (id: string, update: Partial<RankGenderBox>) => void;
  addBox?: () => void;
  removeBox?: (id: string) => void;
  currentParameters?: Partial<RankSettingsDraft>;
  presetEstimate?: { capped: boolean; battles: number; performers: number };
  estimateError?: boolean;
}

interface RankSettings extends Omit<RankSettingsDraft, "leaderboardTopCount" | "leaderboardPerformerCount" | "overallPower" | "confidenceTopN" | "avoidRepeatWindow" | "calibrationPercent" | "initialRating" | "initialDeviation" | "initialVolatility" | "evidenceWeight" | "tau" | "deviationFloor" | "provisionalDeviation"> {
  leaderboardTopCount: number;
  leaderboardPerformerCount: number;
  overallPower: number;
  confidenceTopN: number;
  avoidRepeatWindow: number;
  calibrationPercent: number;
  initialRating: number;
  initialDeviation: number;
  initialVolatility: number;
  evidenceWeight: number;
  tau: number;
  deviationFloor: number;
  provisionalDeviation: number;
}

interface RankPool { rating: number; deviation: number; volatility: number; matches: number; }
interface RankPerformer { id: string; name: string; gender?: string; image_path?: string; dirtyRankState?: Record<string, RankPool>; }
interface RankEntry { performer: RankPerformer; pool: RankPool; }
interface RankInformation { rdReduction: number; leftGain: number; rightGain: number; nextLeftDeviation: number; nextRightDeviation: number; }
interface RankPairCandidate { left: RankPerformer; right: RankPerformer; information: RankInformation; score: number; }
interface RankOpponentCandidate { opponent: RankPerformer; information: RankInformation; score: number; }
interface RankPairResult { pair: RankPerformer[] | null; eligible: number; ranks: Record<string, number>; instanceId?: string; calibration?: boolean; expectedRdReduction?: number; goalLabel?: string; incumbentId?: string; incumbentSide?: string; }
interface RankMatchmakerDependencies {
  categoryEligible(performer: RankPerformer, category: RankCategory, settings: RankSettings, cohort: string): boolean;
  poolFor(performer: RankPerformer, categoryId: string, cohort: string, settings: RankSettings): RankPool;
  precisionTier(pool: RankPool, settings: RankSettings): {id: string; label: string};
  rankPerformers(performers: RankPerformer[], categoryId: string, cohort: string, settings: RankSettings): RankPerformer[];
  settingsFromConfiguration(settings: unknown): RankSettings;
  pairToken(left: RankPerformer, right: RankPerformer): string;
  recentPairWindow(tokens: string[], limit: number): string[];
  expectedDeviationAfterBattle(subject: RankPool, opponent: RankPool, settings: RankSettings): number;
  pairInformationGain(left: RankPool, right: RankPool, settings: RankSettings): RankInformation;
}

interface RankPerformerState {revision: number; pools: Record<string, RankPool>;}
interface RankConfidence {
  activeWeights: Map<string, number>;
  entries: RankEntry[];
  completedBattles: number; remainingBattles: number; progress: number; eligible: number;
  excellent: number; established: number; rated: number; refined: number;
  goalLabel: string; goalTotal: number; goalUnit: string;
}
interface RankSelectionApi {
  categoryConfidence(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings): RankConfidence;
  selectPair(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings, recentTokens: string[]): RankPairResult;
  selectGauntletPair(performers: RankPerformer[], target: RankPerformer, category: RankCategory, cohort: string, settings: RankSettings, recentTokens: string[]): RankPairResult;
  selectKingsStartingPair(performers: RankPerformer[], category: RankCategory, cohort: string, settings: RankSettings): RankPairResult;
  selectKingsPair(performers: RankPerformer[], winner: RankPerformer, winnerSide: string, defeatedIds: string[], category: RankCategory, cohort: string, settings: RankSettings): RankPairResult;
}
interface RankOperationResult {revision?: number; settings?: Record<string, unknown>; left?: {id: string; state: RankPerformerState}; right?: {id: string; state: RankPerformerState}; undone?: boolean; duplicate?: boolean; [result: string]: unknown;}
interface RankSettingsPanelDependencies extends NativeReactHooks {
  Fragment: NativeComponent;
  leaderboardPerformerCountError: (settings: RankSettingsDraft) => string;
  COHORTS: string[][];
  DEFAULT_CATEGORY_DEFINITIONS: RankCategory[];
  DirtyPlugins: Window["DirtyPlugins"];
  Field: NativeComponent;
  LEADERBOARD_TOP_OPTIONS: Array<{count: number; name: string}>;
  OVERALL_SCORE_PARAMETERS: Array<{key: string; min: number; max: number; step: number; label: string; strategy: string; help: string}>;
  OVERALL_SCORE_STRATEGIES: Array<{id: string; name: string; description: string}>;
  PLUGIN_ID: string;
  RATING_PRESETS: Array<{id: string; name: string; description: string; settings: Partial<RankSettingsDraft>}>;
  RankButton: NativeComponent;
  Section: NativeComponent;
  SettingsCard: NativeComponent;
  SharedIconButton: NativeComponent;
  SharedSaveStatus: NativeComponent;
  Toggle: NativeComponent;
  boxFor: (settings: RankSettingsDraft, cohort: string) => RankGenderBox;
  boxOptions: (settings: RankSettingsDraft, enabledOnly?: boolean) => string[][];
  categoriesFor: (settings: RankSettingsDraft, cohort: string) => RankCategory[];
  categoryEligible: (performer: RankPerformer, category: Partial<RankCategory>, settings: RankSettings, cohort: string) => boolean;
  comparableSettings: (settings: RankSettingsDraft) => string;
  documentationCapture: () => boolean;
  freshCategoryBattleEstimate: (count: number, settings: RankSettingsDraft) => {battles: number; performers: number; capped: boolean};
  html: HtmlRenderer;
  leaderboardPerformerCount: (value: unknown, top?: unknown) => number;
  leaderboardTopCount: (value: unknown) => number;
  loadRatingIndex: () => Promise<unknown>;
  overallScoreParameterError: (value: unknown, definition: {min: number; max: number}) => string;
  overallScoreStrategy: (value: string) => {id: string; name: string; description: string};
  parseEnabledCohorts: (value: unknown, fallback: string[]) => string[];
  queryPerformers: (withCardData?: boolean) => Promise<RankPerformer[]>;
  ratingParameters: (settings: RankSettingsDraft) => Partial<RankSettingsDraft>;
  ratingPresetFor: (settings: RankSettingsDraft) => {id: string; name: string; description: string; settings: Partial<RankSettingsDraft>};
  runOperation: (args: Record<string, unknown>) => Promise<RankOperationResult>;
  serializedSettings: (settings: RankSettingsDraft) => Record<string, unknown>;
  settingsFromConfiguration: (value: unknown, fallback?: unknown) => RankSettings;
  uniqueCategoryId: (name: string, used: Set<string>) => string;
  validateSettings: (settings: RankSettingsDraft) => string;
}
interface RankBattleSessionDependencies extends NativeReactHooks {
  CONFIGURATION_CHANGED_EVENT: string;
  DirtyPlugins: Window["DirtyPlugins"];
  PLUGIN_ID: string;
  Router: any;
  UNDO_HISTORY_LIMIT: number;
  battleCategoryPath: (categoryId: string, kingsMode?: boolean, performerId?: string, cohort?: string) => string;
  battleCohortFor: (settings: RankSettings, performer: RankPerformer, requested: string) => string;
  battleId: () => string;
  categoriesForPerformer: (settings: RankSettings, cohort: string, performer: RankPerformer) => RankCategory[];
  categoryConfidence: RankSelectionApi["categoryConfidence"];
  cohortLabel: (cohort: string) => string;
  documentationCapture: () => boolean;
  loadNativePerformerCard: () => Promise<NativeComponent>;
  loadRatingIndex: () => Promise<unknown>;
  pairToken: RankMatchmakerDependencies["pairToken"];
  poolFor: RankMatchmakerDependencies["poolFor"];
  preferredCategoryId: (settings: RankSettings, cohort: string, fallback?: string) => string;
  queryPerformers: (withCardData?: boolean) => Promise<RankPerformer[]>;
  ratingDelta: (before: number, after: number) => string;
  rememberCategory: (cohort: string, categoryId: string) => void;
  runOperation: (args: Record<string, unknown>) => Promise<RankOperationResult>;
  selectGauntletPair: RankSelectionApi["selectGauntletPair"];
  selectKingsPair: RankSelectionApi["selectKingsPair"];
  selectKingsStartingPair: RankSelectionApi["selectKingsStartingPair"];
  selectPair: RankSelectionApi["selectPair"];
  settingsFromConfiguration: (value: unknown, fallback?: unknown) => RankSettings;
  updatePerformerState: (performer: RankPerformer, state: RankPerformerState) => RankPerformer;
  getRatingIndexRevision: () => number;
}
interface RankSettingsDependencies {
  DirtyPlugins: Window["DirtyPlugins"];
  leaderboardPerformerCountError: (settings: RankSettingsDraft) => string;
  cohortLabel: (cohort: string) => string;
  leaderboardTopCount: (value: unknown) => number;
  leaderboardPerformerCount: (value: unknown, top?: unknown) => number;
}
