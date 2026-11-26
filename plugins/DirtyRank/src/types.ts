import type * as R from "react";
import type { HubApi, SharedProps } from "../../DirtyPlugins/src/types";
import type { SavedVerdict, VerdictInformation } from "./domain/rating";
import type { PoolVerdicts } from "./domain/verdicts";
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
  initialRating: number | string;
  initialDeviation: number | string;
  evidenceWeight: number | string;
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
  showCategories?: () => void;
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
    | "initialRating"
    | "initialDeviation"
    | "evidenceWeight"
    | "deviationFloor"
    | "provisionalDeviation"
  > {
  leaderboardTopCount: number;
  leaderboardPerformerCount: number;
  overallPower: number;
  confidenceTopN: number;
  initialRating: number;
  initialDeviation: number;
  evidenceWeight: number;
  deviationFloor: number;
  provisionalDeviation: number;
}

export interface RankPool {
  rating: number;
  deviation: number;
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
export interface RankPairCandidate {
  left: RankPerformer;
  right: RankPerformer;
  information: VerdictInformation;
  score: number;
  saved: SavedVerdict | null;
}
export interface RankOpponentCandidate {
  opponent: RankPerformer;
  information: VerdictInformation;
  score: number;
  saved: SavedVerdict | null;
}
export interface RankPairResult {
  pair: RankPerformer[] | null;
  eligible: number;
  ranks: Record<string, number>;
  instanceId?: string;
  /** Expected information (nats) the verdict adds to the two ratings. */
  expectedInformation?: number;
  goalLabel?: string;
  /** The pair's saved verdict, from the left performer's side, when it was judged before. */
  saved?: SavedVerdict | null;
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
    verdicts: PoolVerdicts | null,
    excluded?: Set<string>,
  ): RankPairResult;
  selectGauntletPair(
    performers: RankPerformer[],
    target: RankPerformer,
    category: RankCategory,
    cohort: string,
    settings: RankSettings,
    verdicts: PoolVerdicts | null,
    excluded?: Set<string>,
  ): RankPairResult;
}
export interface RankOperationResult {
  revision?: number;
  settings?: Record<string, unknown>;
  left?: { id: string; state: RankPerformerState };
  right?: { id: string; state: RankPerformerState };
  /** Every performer a refit moved, including both performers of the verdict. */
  changed?: Array<{ id: string; state: RankPerformerState }>;
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
  /** Likely leaderboard positions, from the ratings' uncertainty. */
  range?: RankRange;
}
export interface RankRange {
  low: number;
  high: number;
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
  routeDetails: { categoryId?: string };
  routeTargetId?: string;
}
export type ConfigurationEvent = Event & { detail?: { pluginId?: string } };
export interface PerformerCardProps {
  performer: RankPerformer;
  pool: DisplayPool;
  settings: RankSettings;
  reveal?: boolean;
  rank?: number;
  gauntletTarget?: boolean;
  onSceneChange?(id: string | null): void;
}
export interface Feedback {
  text: string;
}
export interface Decision {
  id: string;
  /** From the left performer's side, -3 to 3. */
  score: number;
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
  /** What the pair had before this verdict, from the left performer's side. */
  previous: SavedVerdict | null;
}
export interface PreparedPair {
  sourceInstanceId?: string;
  contextKey: string;
  pairInfo: RankPairResult;
}
