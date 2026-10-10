import type * as R from "react";
import type { HubApi, SharedProps } from "../../DirtyPlugins/src/types";
export interface RankCategory {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  weight: number | string;
}

export interface RankGenderBox {
  id: string;
  name: string;
  enabled?: boolean;
  genders: string[];
}

/** Editable settings retain numeric strings until validation succeeds. */
export interface RankSettingsDraft {
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
export interface RankSettingsSectionProps {
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
  presetEstimate?: { capped: boolean; battles: number; performers: number } | null;
  estimateError?: boolean;
}

export interface RankSettings
  extends Omit<
    RankSettingsDraft,
    | "leaderboardTopCount"
    | "leaderboardPerformerCount"
    | "overallPower"
    | "confidenceTopN"
    | "avoidRepeatWindow"
    | "calibrationPercent"
    | "initialRating"
    | "initialDeviation"
    | "initialVolatility"
    | "evidenceWeight"
    | "tau"
    | "deviationFloor"
    | "provisionalDeviation"
  > {
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

export interface RankPool {
  rating: number;
  deviation: number;
  volatility: number;
  matches: number;
  wins?: number;
  losses?: number;
  draws?: number;
  lastRatedAt?: string | null;
}
export interface RankPerformer {
  id: string;
  name?: string;
  gender?: string;
  image_path?: string;
  scene_count?: number;
  dirtyRankState?: Record<string, RankPool>;
}
export interface RankEntry {
  performer: RankPerformer;
  pool: RankPool;
}
export interface RankInformation {
  rdReduction: number;
  leftGain: number;
  rightGain: number;
  nextLeftDeviation: number;
  nextRightDeviation: number;
}
export interface RankPairCandidate {
  left: RankPerformer;
  right: RankPerformer;
  information: RankInformation;
  score: number;
}
export interface RankOpponentCandidate {
  opponent: RankPerformer;
  information: RankInformation;
  score: number;
}
export interface RankPairResult {
  pair: RankPerformer[] | null;
  eligible: number;
  ranks: Record<string, number>;
  instanceId?: string;
  calibration?: boolean;
  expectedRdReduction?: number;
  goalLabel?: string;
  incumbentId?: string;
  incumbentSide?: string;
}

export interface RankPerformerState {
  revision: number;
  pools: Record<string, RankPool>;
}
export interface RankConfidence {
  activeWeights: Map<string, number>;
  entries: RankEntry[];
  completedBattles: number;
  remainingBattles: number;
  progress: number;
  eligible: number;
  excellent: number;
  established: number;
  rated: number;
  refined: number;
  goalLabel: string;
  goalTotal: number;
  goalUnit: string;
}
export interface RankSelectionApi {
  categoryConfidence(
    performers: RankPerformer[],
    category: RankCategory,
    cohort: string,
    settings: RankSettings,
  ): RankConfidence;
  selectPair(
    performers: RankPerformer[],
    category: RankCategory,
    cohort: string,
    settings: RankSettings,
    recentTokens: string[],
  ): RankPairResult;
  selectGauntletPair(
    performers: RankPerformer[],
    target: RankPerformer,
    category: RankCategory,
    cohort: string,
    settings: RankSettings,
    recentTokens: string[],
  ): RankPairResult;
  selectKingsStartingPair(
    performers: RankPerformer[],
    category: RankCategory,
    cohort: string,
    settings: RankSettings,
  ): RankPairResult;
  selectKingsPair(
    performers: RankPerformer[],
    winner: RankPerformer,
    winnerSide: string,
    defeatedIds: string[],
    category: RankCategory,
    cohort: string,
    settings: RankSettings,
  ): RankPairResult;
}
export interface RankOperationResult {
  revision?: number;
  settings?: Record<string, unknown>;
  left?: { id: string; state: RankPerformerState };
  right?: { id: string; state: RankPerformerState };
  undone?: boolean;
  duplicate?: boolean;
  [result: string]: unknown;
}

export interface PreviewMedia {
  id: string;
  title?: string;
  rating100?: number | null;
  files?: Array<{ duration?: number }>;
  paths?: { stream?: string };
  sceneStreams?: Array<{ url: string; mime_type: string; label?: string }>;
  marker?: { id: string; title?: string; seconds: number; end_seconds: number | null };
}
export interface DisplayPool {
  rating: number;
  deviation: number;
  matches: number;
  volatility?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  overallScore?: boolean;
  ratedCategories?: number;
  totalCategories?: number;
  precision?: { id: string; label: string };
  stable?: boolean;
}
export interface StandingEntry {
  performer: RankPerformer;
  rank: number;
}
export interface LeaderboardProps {
  ranked: RankPerformer[];
  leaderboardId: string;
  cohort: string;
  settings: RankSettings;
  topCount?: number;
  featuredCount?: number;
  entries?: StandingEntry[];
  showFeatured?: boolean;
  page?: number;
  emptyMessage?: string;
  onPageChange?(page: number): void;
}
export interface PerformerFilter {
  makeFindFilter(): Record<string, unknown>;
  makeFilter(): Record<string, unknown>;
  count?(): number;
}
export interface PerformerFilterModel {
  find: Record<string, unknown>;
  object: Record<string, unknown>;
  count: number;
}
export interface ConfidenceProps {
  performers: RankPerformer[];
  category: RankCategory;
  cohort: string;
  settings: RankSettings;
}
export interface BattleProps {
  routeDetails: { categoryId?: string; kingsMode?: boolean };
  routeTargetId?: string;
}
export type ConfigurationEvent = Event & { detail?: { pluginId?: string } };
export interface PerformerCardProps {
  performer: RankPerformer;
  pool: DisplayPool;
  settings: RankSettings;
  reveal?: boolean;
  disabled?: boolean;
  crowned?: boolean;
  rank?: number;
  gauntletTarget?: boolean;
  kingTarget?: boolean;
  hillMode?: boolean;
  hillOpening?: boolean;
  onChoose?(): void;
}
export interface Feedback {
  text: string;
}
export interface Decision {
  id: string;
  left: DecisionPerson;
  right: DecisionPerson;
}
export interface DecisionPerson {
  name?: string;
  tone: string;
}
export interface UndoEntry {
  id: string;
  categoryId: string;
  cohort: string;
  leftId: string;
  rightId: string;
  pairInfo: RankPairResult;
}
export interface DefeatedKing {
  performerId: string;
  battleId: string;
}
export interface PreparedPair {
  sourceInstanceId?: string;
  contextKey: string;
  pairInfo: RankPairResult;
}
