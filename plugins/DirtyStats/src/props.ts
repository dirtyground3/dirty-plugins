import type * as R from "react";
import type { SharedProps } from "../../DirtyPlugins/src/types";
import type { SavedFilter, StatsFilter } from "./runtime";
import type { BirthdayEntry, BirthdaySelection, ChartOption, DashboardWidgetModel, ResourceState, SettingValue, StatsPerformer, StatsScene } from "./types";
export interface PageProps { filter: StatsFilter; performerMode?: boolean; }
export interface PerformerCardsProps {
  performers: Array<StatsPerformer & { deceased?: boolean }>; filter?: StatsFilter; title?: string; country?: string;
  selection?: unknown; clearCountry?: () => void; clearSelection?: () => void; clearLabel?: string;
}
export interface SceneCardsProps { scenes: StatsScene[]; filter: StatsFilter; title?: string; selection?: unknown; clearSelection?: () => void; clearLabel?: string; }
export interface BirthdayCalendarProps { entries: BirthdayEntry[]; year: number; selected: BirthdaySelection | null; nowMonth: number; nowDay: number; onSelect(month: number, day: number): void; }
export interface SelectorProps { value: string; page?: R.RefObject<HTMLElement>; }
export interface FilterCaptureProps { filter: StatsFilter; entity?: string; }
export type StateProps = SharedProps;
export interface ChartProps { option: ChartOption; label: string; map?: boolean; }
export interface CardWidgetProps { widget: DashboardWidgetModel; rows: StatsPerformer[]; }
export interface SelectProps { label: string; value: SettingValue; values: SettingValue[]; className?: string; labels?: Record<string, string>; onChange(value: SettingValue): void; }
export interface NumberProps { label: string; value: number; min: number; max: number; invalidLabel: string; className?: string; onChange(value: number): void; }
export interface CheckProps { label: string; value: boolean; onChange(value: boolean): void; }
export interface FilterControlProps { filter: SavedFilter; entity: string; onChange(): void; }
export interface WidgetOptionsProps { widget: Omit<DashboardWidgetModel, "filter"> & { filter: SavedFilter | null }; kind?: "toggles" | "fields"; onChange(options: DashboardWidgetModel["options"]): void; }
export interface FilterChooserProps { entity: string; filterKey: string; onChange(filter: SavedFilter): void; }
export interface FilterDialogProps { labelId: string; title: string; onClose(): void; children?: R.ReactNode; }
export interface DashboardWidgetProps {
  widget: DashboardWidgetModel; index: number; resources: Record<string, ResourceState>; editing?: boolean; dragging?: boolean;
  onDragStart(event: R.PointerEvent<HTMLButtonElement>): void; onDragKeyDown(event: R.KeyboardEvent<HTMLButtonElement>): void;
  onRemove(): void; onTitle(title: string): void; onSize(size: string): void; onFilter(): void; onOptions(options: DashboardWidgetModel["options"]): void;
}
export interface DashboardPageProps { selector?: R.ReactNode; }
