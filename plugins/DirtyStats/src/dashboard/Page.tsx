import { State } from "./Chart";
import { SelectControl, WidgetOptions } from "./Controls";
import { DashboardFilterChooser, DashboardFilterDialog } from "./Filter";
import { DashboardWidget } from "./Widget";
import { useDashboardResources } from "./resources";
import {
  DASHBOARD_VERSION,
  MAX_WIDGETS,
  SIZES,
  SIZE_LABELS,
  WIDGETS,
  WIDGET_ORDER,
  dashboardNeedsInitialSave,
  filterSummary,
  nextWidgetId,
  normalizeFilter,
  normalizeOptions,
  normalizeTitle,
  normalizeWidgets,
  reorderWidgets,
  requiredResources,
  widgetTitle,
} from "../domain/dashboard";
import { React, ui } from "../runtime";
import { getStatsSettingExtra, setStatsSettingExtra, statsSettingsReady } from "../settings";
import type * as R from "react";
import type { DashboardPageProps } from "../props";
import type { SavedFilter } from "../runtime";
import type { DashboardWidgetModel } from "../types";
export function DashboardPage(props: DashboardPageProps): R.ReactElement | null {
  const [widgets, setWidgets] = React.useState<DashboardWidgetModel[]>([]);
  const [ready, setReady] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<
    (Omit<DashboardWidgetModel, "filter"> & { filter: SavedFilter | null }) | null
  >(null);
  const [filterEdit, setFilterEdit] = React.useState<number | null>(null);
  const [pendingFilter, setPendingFilter] = React.useState<SavedFilter | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragAnnouncement, setDragAnnouncement] = React.useState("");
  const dragCleanup = React.useRef<((announce: boolean) => void) | null>(null);
  const initialSave = React.useRef<boolean | null>(null);
  const resources = useDashboardResources(requiredResources(widgets), ready);
  React.useEffect(() => {
    let active = true;
    Promise.resolve(statsSettingsReady).then(() => {
      if (!active) return;
      const storedVersion = getStatsSettingExtra<number>("dashboardSchemaVersion", 0);
      const storedWidgets = getStatsSettingExtra("dashboardWidgets", null);
      initialSave.current = dashboardNeedsInitialSave(storedVersion, storedWidgets);
      setWidgets(normalizeWidgets(storedWidgets, storedVersion !== DASHBOARD_VERSION));
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);
  React.useEffect(() => {
    if (!ready) return;
    const saveLoadedState = initialSave.current;
    initialSave.current = null;
    if (saveLoadedState === false) return;
    setStatsSettingExtra("dashboardSchemaVersion", DASHBOARD_VERSION);
    setStatsSettingExtra("dashboardWidgets", widgets);
  }, [ready, widgets]);
  React.useEffect(
    () => () => {
      if (dragCleanup.current) dragCleanup.current(false);
    },
    [],
  );
  function replace(index: number, patch: Partial<DashboardWidgetModel>) {
    setWidgets(current =>
      current.map((widget, position) => (position === index ? Object.assign({}, widget, patch) : widget)),
    );
  }
  function startDrag(index: number, event: R.PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (dragCleanup.current) dragCleanup.current(false);
    event.preventDefault();
    const pointerId = event.pointerId;
    const dragged = widgets[index];
    const draggedId = dragged.id;
    const label = widgetTitle(dragged);
    let lastTarget = index;
    let moved = false;
    function finish(announce: boolean) {
      document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerEnd);
      document.removeEventListener("pointercancel", pointerEnd);
      dragCleanup.current = null;
      setDraggingId(null);
      if (announce)
        setDragAnnouncement(
          moved ? label + " placed at position " + (lastTarget + 1) + "." : label + " position unchanged.",
        );
    }
    function pointerMove(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      const card = target && target.closest ? target.closest("[data-widget-index]") : null;
      if (!card) return;
      const targetIndex = Number(card.getAttribute("data-widget-index"));
      if (!Number.isInteger(targetIndex) || targetIndex === lastTarget) return;
      setWidgets(current => {
        const from = current.findIndex(widget => widget.id === draggedId);
        return reorderWidgets(current, from, targetIndex);
      });
      lastTarget = targetIndex;
      moved = true;
      setDragAnnouncement(label + " moved to position " + (targetIndex + 1) + ".");
    }
    function pointerEnd(pointerEvent: PointerEvent) {
      if (pointerEvent.pointerId === pointerId) finish(true);
    }
    setDraggingId(draggedId);
    setDragAnnouncement("Dragging " + label + ". Move over another widget to reorder.");
    document.addEventListener("pointermove", pointerMove, { passive: false });
    document.addEventListener("pointerup", pointerEnd);
    document.addEventListener("pointercancel", pointerEnd);
    dragCleanup.current = finish;
  }
  function remove(index: number) {
    setWidgets(current => current.filter((_widget, position) => position !== index));
  }
  function moveWithKeyboard(index: number, event: R.KeyboardEvent<HTMLButtonElement>) {
    const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!delta || index + delta < 0 || index + delta >= widgets.length) return;
    event.preventDefault();
    setWidgets(current => reorderWidgets(current, index, index + delta));
    setDragAnnouncement(widgetTitle(widgets[index]) + " moved to position " + (index + delta + 1) + ".");
  }
  function beginAdd(statistic: string) {
    const definition = WIDGETS[statistic];
    setDraft({
      id: nextWidgetId(statistic, widgets),
      statistic,
      title: "",
      size: definition.size,
      options: normalizeOptions(definition, definition.options),
      filter: null,
    });
  }
  function updateDraft(patch: Partial<Omit<DashboardWidgetModel, "filter"> & { filter: SavedFilter | null }>) {
    setDraft(current => (current ? Object.assign({}, current, patch) : current));
  }
  function addDraft() {
    if (!draft || !draft!.filter) return;
    setWidgets(current =>
      current.concat([
        Object.assign({}, draft, { title: normalizeTitle(draft!.title), filter: normalizeFilter(draft!.filter) }),
      ]),
    );
    setDraft(null);
    setAdding(false);
  }
  function beginFilterEdit(index: number) {
    setAdding(false);
    setDraft(null);
    setFilterEdit(index);
    setPendingFilter(null);
  }
  function applyFilterEdit() {
    if (filterEdit == null || !pendingFilter) return;
    replace(filterEdit, { filter: normalizeFilter(pendingFilter) });
    setFilterEdit(null);
    setPendingFilter(null);
  }
  function toggleEditing() {
    if (dragCleanup.current) dragCleanup.current(false);
    if (editing) {
      setAdding(false);
      setDraft(null);
      setFilterEdit(null);
      setPendingFilter(null);
    }
    setEditing(!editing);
  }
  function toggleAdding() {
    setAdding(!adding);
    setDraft(null);
    setFilterEdit(null);
    setPendingFilter(null);
  }
  const filterWidget = filterEdit == null ? null : widgets[filterEdit];
  if (!ready) return <State title="Loading dashboard…" />;
  return (
    <section className="dirty-stats-dashboard" aria-label="DirtyStats dashboard">
      <div className="dirty-stats-dashboard-heading">
        {props.selector}
        <div className="dirty-stats-actions dirty-ui-control-row">
          {editing ? (
            <button
              type="button"
              className="btn btn-secondary dirty-ui-button dirty-ui-control"
              disabled={!adding && widgets.length >= MAX_WIDGETS}
              onClick={toggleAdding}
            >
              {adding ? "Close widget picker" : "Add widget"}
            </button>
          ) : null}
          <button type="button" className="btn btn-primary dirty-ui-button dirty-ui-control" onClick={toggleEditing}>
            {editing ? "Done editing" : "Edit dashboard"}
          </button>
        </div>
      </div>
      <p className="dirty-stats-dashboard-visually-hidden" role="status" aria-live="polite">
        {dragAnnouncement}
      </p>
      {adding ? (
        <section className="dirty-stats-dashboard-picker dirty-ui-panel" aria-label="Add a statistic widget">
          <h2>Add widget</h2>
          <p>Add another view of any statistic and give it its own filters and display options.</p>
          <div className="dirty-stats-dashboard-picker-grid">
            {WIDGET_ORDER.map(statistic => {
              return (
                <button
                  key={statistic}
                  type="button"
                  className="btn btn-secondary dirty-ui-button"
                  disabled={widgets.length >= MAX_WIDGETS}
                  onClick={() => {
                    beginAdd(statistic);
                  }}
                >
                  {WIDGETS[statistic].label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      {draft ? (
        <DashboardFilterDialog
          labelId="dirty-stats-add-widget-dialog"
          title={"Add " + WIDGETS[draft!.statistic].label}
          onClose={() => {
            setDraft(null);
          }}
        >
          <div className="dirty-stats-dashboard-add-settings">
            <ui.Field
              id="dirty-stats-widget-title"
              label="Custom title"
              className="dirty-stats-dashboard-field dirty-stats-dashboard-title-field"
            >
              <input
                type="text"
                className="form-control form-control-sm"
                value={draft!.title || ""}
                placeholder={WIDGETS[draft!.statistic].label}
                maxLength={100}
                onChange={event => {
                  updateDraft({ title: event.target.value });
                }}
              />
            </ui.Field>
            <SelectControl
              label="Size"
              value={draft.size}
              values={SIZES}
              labels={SIZE_LABELS}
              onChange={size => {
                updateDraft({ size: String(size) });
              }}
            />
            <div className="dirty-stats-dashboard-options">
              <WidgetOptions
                widget={draft}
                onChange={options => {
                  updateDraft({ options: normalizeOptions(WIDGETS[draft!.statistic], options) });
                }}
              />
            </div>
          </div>
          <div className="dirty-stats-dashboard-filter-heading">
            <div>
              <h3>Filters</h3>
              <p>Use the same native filters as the full view. Changes apply to this widget only.</p>
            </div>
            {draft!.filter ? <strong>{filterSummary(draft!.filter, WIDGETS[draft!.statistic].entity)}</strong> : null}
          </div>
          <DashboardFilterChooser
            filterKey={"add-" + draft.id}
            entity={WIDGETS[draft!.statistic].entity}
            onChange={filter => {
              updateDraft({ filter });
            }}
          />
          <div className="dirty-stats-dashboard-picker-actions">
            <button
              type="button"
              className="btn btn-secondary dirty-ui-button"
              onClick={() => {
                setDraft(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary dirty-ui-button"
              disabled={!draft!.filter}
              onClick={addDraft}
            >
              Add widget
            </button>
          </div>
        </DashboardFilterDialog>
      ) : null}
      {filterWidget ? (
        <DashboardFilterDialog
          labelId="dirty-stats-edit-filter-dialog"
          title={"Change filters · " + WIDGETS[filterWidget.statistic].label}
          onClose={() => {
            setFilterEdit(null);
            setPendingFilter(null);
          }}
        >
          <p>
            {"Current selection: " +
              filterSummary(filterWidget.filter, WIDGETS[filterWidget.statistic].entity) +
              ". Choose a new selection below; it will replace the current filters when applied."}
          </p>
          <DashboardFilterChooser
            filterKey={"edit-" + filterWidget.id}
            entity={WIDGETS[filterWidget.statistic].entity}
            onChange={setPendingFilter}
          />
          <div className="dirty-stats-dashboard-picker-actions">
            <button
              type="button"
              className="btn btn-secondary dirty-ui-button"
              onClick={() => {
                setFilterEdit(null);
                setPendingFilter(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary dirty-ui-button"
              disabled={!pendingFilter}
              onClick={applyFilterEdit}
            >
              Apply filters
            </button>
          </div>
        </DashboardFilterDialog>
      ) : null}
      {!widgets.length ? (
        <State
          title="Your dashboard is empty"
          detail={
            editing ? "Choose Add widget to build your library overview." : "Enter edit mode to add your first widget."
          }
          actions={
            editing ? (
              <button
                type="button"
                className="btn btn-primary dirty-ui-button"
                onClick={() => {
                  setAdding(true);
                }}
              >
                Add widget
              </button>
            ) : (
              <button type="button" className="btn btn-primary dirty-ui-button" onClick={toggleEditing}>
                Edit dashboard
              </button>
            )
          }
        />
      ) : (
        <div
          className={
            "dirty-stats-dashboard-grid" + (editing ? " is-editing" : "") + (draggingId ? " is-reordering" : "")
          }
        >
          {widgets.map((widget, index) => {
            return (
              <DashboardWidget
                key={widget.id}
                widget={widget}
                index={index}
                editing={editing}
                dragging={draggingId === widget.id}
                resources={resources}
                onDragStart={event => {
                  startDrag(index, event);
                }}
                onDragKeyDown={event => {
                  moveWithKeyboard(index, event);
                }}
                onRemove={() => {
                  remove(index);
                }}
                onTitle={title => {
                  replace(index, { title });
                }}
                onSize={size => {
                  replace(index, { size: String(size) });
                }}
                onFilter={() => {
                  beginFilterEdit(index);
                }}
                onOptions={options => {
                  replace(index, { options: normalizeOptions(WIDGETS[widget.statistic], options) });
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
