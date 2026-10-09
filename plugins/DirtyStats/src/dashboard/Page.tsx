import type * as R from "react";
import type { DashboardDependencies } from "../dashboardView";
import type { DashboardPageProps } from "../props";
import type { SavedFilter } from "../runtime";
import type { Capacity, DashboardResource, DashboardWidgetModel, ResourceState } from "../types";
export function createDashboardPage(dependencies: DashboardDependencies) {
  const { clone, normalizeOptions, normalizeFilter, normalizeTitle, widgetTitle, normalizeWidgets, dashboardNeedsInitialSave, nextWidgetId, requiredResources, reorderWidgets, fetchPages, State, SelectControl, WidgetOptions, filterSummary, DashboardFilterChooser, DashboardFilterDialog, DashboardWidget, hub, core, React, Field, SIZES, SIZE_LABELS, DASHBOARD_VERSION, MAX_WIDGETS, WIDGETS, WIDGET_ORDER } = dependencies;
  function DashboardPage(props: DashboardPageProps): R.ReactElement | null {
    var widgetsState = React.useState<DashboardWidgetModel[]>([]), widgets = widgetsState[0], setWidgets = widgetsState[1];
    var readyState = React.useState(false), ready = readyState[0], setReady = readyState[1];
    var editState = React.useState(false), editing = editState[0], setEditing = editState[1];
    var addState = React.useState(false), adding = addState[0], setAdding = addState[1];
    var draftState = React.useState<(Omit<DashboardWidgetModel, "filter"> & { filter: SavedFilter | null }) | null>(null), draft = draftState[0], setDraft = draftState[1];
    var filterEditState = React.useState<number | null>(null), filterEdit = filterEditState[0], setFilterEdit = filterEditState[1];
    var pendingFilterState = React.useState<SavedFilter | null>(null), pendingFilter = pendingFilterState[0], setPendingFilter = pendingFilterState[1];
    var dragState = React.useState<string | null>(null), draggingId = dragState[0], setDraggingId = dragState[1];
    var announcementState = React.useState(""), dragAnnouncement = announcementState[0], setDragAnnouncement = announcementState[1];
    var dragCleanup = React.useRef<((announce: boolean) => void) | null>(null);
    var initialSave = React.useRef<boolean | null>(null);
    var resourcesState = React.useState<Record<string, ResourceState>>({}), resources = resourcesState[0], setResources = resourcesState[1];
    React.useEffect(function () {
      var active = true;
      Promise.resolve(core.settingsReady).then(function () {
        if (!active) return;
        var storedVersion = core.getSettingExtra("dashboardSchemaVersion", 0);
        var storedWidgets = core.getSettingExtra("dashboardWidgets", null);
        initialSave.current = dashboardNeedsInitialSave(storedVersion, storedWidgets);
        setWidgets(normalizeWidgets(storedWidgets, storedVersion !== DASHBOARD_VERSION));
        setReady(true);
      });
      return function () { active = false; };
    }, []);
    React.useEffect(function () {
      if (!ready) return;
      var saveLoadedState = initialSave.current;
      initialSave.current = null;
      if (saveLoadedState === false) return;
      core.setSettingExtra("dashboardSchemaVersion", DASHBOARD_VERSION);
      core.setSettingExtra("dashboardWidgets", widgets);
    }, [ready, widgets]);
    var resourcesKey = JSON.stringify(requiredResources(widgets));
    React.useEffect(function () {
      if (!ready) return;
      var controller = new AbortController();
      var requested: DashboardResource[] = JSON.parse(resourcesKey);
      requested.forEach(function (request) {
        setResources(function (current) { var next = Object.assign({}, current); next[request.key] = { loading: true, rows: [], error: "", capacity: null }; return next; });
        fetchPages(request.group, request.filter, controller.signal, request.limit).then(async function (rows) {
          var capacity: Capacity | null = null;
          if (request.group === "growth" && !controller.signal.aborted) {
            try {
              var configuration = await hub.graphql<{ configuration: { general: { stashes: Array<{ path: string; excludeVideo: boolean }> } } }>("query DirtyStatsDashboardSources{configuration{general{stashes{path excludeVideo}}}}", {}, { signal: controller.signal });
              var paths = configuration.configuration.general.stashes.filter(function (source) { return !source.excludeVideo; }).map(function (source) { return source.path; });
              capacity = await hub.runPluginOperation<Capacity>("dirtyStats", { mode: "capacity", paths: paths });
            } catch (_capacityError) { capacity = null; }
          }
          if (!controller.signal.aborted) setResources(function (current) { var next = Object.assign({}, current); next[request.key] = { loading: false, rows: rows, error: "", capacity: capacity }; return next; });
        }).catch(function (error) {
          if (!controller.signal.aborted) setResources(function (current) { var next = Object.assign({}, current); next[request.key] = { loading: false, rows: [], error: error.message || String(error), capacity: null }; return next; });
        });
      });
      return function () { controller.abort(); };
    }, [ready, resourcesKey]);
    React.useEffect(function () { return function () { if (dragCleanup.current) dragCleanup.current(false); }; }, []);
    function replace(index: number, patch: Partial<DashboardWidgetModel>) { setWidgets(function (current) { return current.map(function (widget, position) { return position === index ? Object.assign({}, widget, patch) : widget; }); }); }
    function startDrag(index: number, event: R.PointerEvent<HTMLButtonElement>) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (dragCleanup.current) dragCleanup.current(false);
      event.preventDefault();
      var pointerId = event.pointerId;
      var dragged = widgets[index];
      var draggedId = dragged.id;
      var label = widgetTitle(dragged);
      var lastTarget = index;
      var moved = false;
      function finish(announce: boolean) {
        document.removeEventListener("pointermove", pointerMove);
        document.removeEventListener("pointerup", pointerEnd);
        document.removeEventListener("pointercancel", pointerEnd);
        dragCleanup.current = null;
        setDraggingId(null);
        if (announce) setDragAnnouncement(moved ? label + " placed at position " + (lastTarget + 1) + "." : label + " position unchanged.");
      }
      function pointerMove(pointerEvent: PointerEvent) {
        if (pointerEvent.pointerId !== pointerId) return;
        pointerEvent.preventDefault();
        var target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
        var card = target && target.closest ? target.closest("[data-widget-index]") : null;
        if (!card) return;
        var targetIndex = Number(card.getAttribute("data-widget-index"));
        if (!Number.isInteger(targetIndex) || targetIndex === lastTarget) return;
        setWidgets(function (current) {
          var from = current.findIndex(function (widget) { return widget.id === draggedId; });
          return reorderWidgets(current, from, targetIndex);
        });
        lastTarget = targetIndex;
        moved = true;
        setDragAnnouncement(label + " moved to position " + (targetIndex + 1) + ".");
      }
      function pointerEnd(pointerEvent: PointerEvent) { if (pointerEvent.pointerId === pointerId) finish(true); }
      setDraggingId(draggedId);
      setDragAnnouncement("Dragging " + label + ". Move over another widget to reorder.");
      document.addEventListener("pointermove", pointerMove, { passive: false });
      document.addEventListener("pointerup", pointerEnd);
      document.addEventListener("pointercancel", pointerEnd);
      dragCleanup.current = finish;
    }
    function remove(index: number) { setWidgets(function (current) { return current.filter(function (_widget, position) { return position !== index; }); }); }
    function moveWithKeyboard(index: number, event: R.KeyboardEvent<HTMLButtonElement>) {
      var delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (!delta || index + delta < 0 || index + delta >= widgets.length) return;
      event.preventDefault();
      setWidgets(function (current) { return reorderWidgets(current, index, index + delta); });
      setDragAnnouncement(widgetTitle(widgets[index]) + " moved to position " + (index + delta + 1) + ".");
    }
    function beginAdd(statistic: string) { var definition = WIDGETS[statistic]; setDraft({ id: nextWidgetId(statistic, widgets), statistic: statistic, title: "", size: definition.size, options: normalizeOptions(definition, definition.options), filter: null }); }
    function updateDraft(patch: Partial<Omit<DashboardWidgetModel, "filter"> & { filter: SavedFilter | null }>) { setDraft(function (current) { return current ? Object.assign({}, current, patch) : current; }); }
    function addDraft() { if (!draft || !draft!.filter) return; setWidgets(function (current) { return current.concat([Object.assign({}, draft, { title: normalizeTitle(draft!.title), filter: normalizeFilter(draft!.filter) })]); }); setDraft(null); setAdding(false); }
    function beginFilterEdit(index: number) { setAdding(false); setDraft(null); setFilterEdit(index); setPendingFilter(null); }
    function applyFilterEdit() { if (filterEdit == null || !pendingFilter) return; replace(filterEdit, { filter: normalizeFilter(pendingFilter) }); setFilterEdit(null); setPendingFilter(null); }
    function toggleEditing() {
      if (dragCleanup.current) dragCleanup.current(false);
      if (editing) { setAdding(false); setDraft(null); setFilterEdit(null); setPendingFilter(null); }
      setEditing(!editing);
    }
    function toggleAdding() { setAdding(!adding); setDraft(null); setFilterEdit(null); setPendingFilter(null); }
    var filterWidget = filterEdit == null ? null : widgets[filterEdit];
    if (!ready) return (<State title="Loading dashboard…" />);
    return (<section className="dirty-stats-dashboard" aria-label="DirtyStats dashboard">

      <div className="dirty-stats-dashboard-heading">

        {props.selector}

        <div className="dirty-stats-actions dirty-ui-control-row">

          {editing ? (<button
            type="button"
            className="btn btn-secondary dirty-ui-button dirty-ui-control"
            disabled={!adding && widgets.length >= MAX_WIDGETS}
            onClick={toggleAdding}>

            {adding ? "Close widget picker" : "Add widget"}

          </button>) : null}

          <button type="button" className="btn btn-primary dirty-ui-button dirty-ui-control" onClick={toggleEditing}>

            {editing ? "Done editing" : "Edit dashboard"}

          </button>

        </div>

      </div>

      <p className="dirty-stats-dashboard-visually-hidden" role="status" aria-live="polite">

        {dragAnnouncement}

      </p>

      {adding ? (<section className="dirty-stats-dashboard-picker dirty-ui-panel" aria-label="Add a statistic widget">

        <h2>

          {"Add widget"}

        </h2>

        <p>

          {"Add another view of any statistic and give it its own filters and display options."}

        </p>

        <div className="dirty-stats-dashboard-picker-grid">

          {WIDGET_ORDER.map(function (statistic) {
            return (<button
              key={statistic}
              type="button"
              className="btn btn-secondary dirty-ui-button"
              disabled={widgets.length >= MAX_WIDGETS}
              onClick={function () { beginAdd(statistic); }}>

              {WIDGETS[statistic].label}

            </button>);
          })}

        </div>

      </section>) : null}

      {draft ? (<DashboardFilterDialog
        labelId="dirty-stats-add-widget-dialog"
        title={"Add " + WIDGETS[draft!.statistic].label}
        onClose={function () { setDraft(null); }}>

        <div className="dirty-stats-dashboard-add-settings">

          <Field
            id="dirty-stats-widget-title"
            label="Custom title"
            className="dirty-stats-dashboard-field dirty-stats-dashboard-title-field">

            <input
              type="text"
              className="form-control form-control-sm"
              value={draft!.title || ""}
              placeholder={WIDGETS[draft!.statistic].label}
              maxLength={100}
              onChange={function (event) { updateDraft({ title: event.target.value }); }} />

          </Field>

          <SelectControl
            label="Size"
            value={draft.size}
            values={SIZES}
            labels={SIZE_LABELS}
            onChange={function (size) { updateDraft({ size: String(size) }); }} />

          <div className="dirty-stats-dashboard-options">

            <WidgetOptions
              widget={draft}
              onChange={function (options) { updateDraft({ options: normalizeOptions(WIDGETS[draft!.statistic], options) }); }} />

          </div>

        </div>

        <div className="dirty-stats-dashboard-filter-heading">

          <div>

            <h3>

              {"Filters"}

            </h3>

            <p>

              {"Use the same native filters as the full view. Changes apply to this widget only."}

            </p>

          </div>

          {draft!.filter ? (<strong>

            {filterSummary(draft!.filter, WIDGETS[draft!.statistic].entity)}

          </strong>) : null}

        </div>

        <DashboardFilterChooser
          filterKey={"add-" + draft.id}
          entity={WIDGETS[draft!.statistic].entity}
          onChange={function (filter) { updateDraft({ filter: filter }); }} />

        <div className="dirty-stats-dashboard-picker-actions">

          <button type="button" className="btn btn-secondary dirty-ui-button" onClick={function () { setDraft(null); }}>

            {"Cancel"}

          </button>

          <button
            type="button"
            className="btn btn-primary dirty-ui-button"
            disabled={!draft!.filter}
            onClick={addDraft}>

            {"Add widget"}

          </button>

        </div>

      </DashboardFilterDialog>) : null}

      {filterWidget ? (<DashboardFilterDialog
        labelId="dirty-stats-edit-filter-dialog"
        title={"Change filters · " + WIDGETS[filterWidget.statistic].label}
        onClose={function () { setFilterEdit(null); setPendingFilter(null); }}>

        <p>

          {"Current selection: " + filterSummary(filterWidget.filter, WIDGETS[filterWidget.statistic].entity) + ". Choose a new selection below; it will replace the current filters when applied."}

        </p>

        <DashboardFilterChooser
          filterKey={"edit-" + filterWidget.id}
          entity={WIDGETS[filterWidget.statistic].entity}
          onChange={setPendingFilter} />

        <div className="dirty-stats-dashboard-picker-actions">

          <button
            type="button"
            className="btn btn-secondary dirty-ui-button"
            onClick={function () { setFilterEdit(null); setPendingFilter(null); }}>

            {"Cancel"}

          </button>

          <button
            type="button"
            className="btn btn-primary dirty-ui-button"
            disabled={!pendingFilter}
            onClick={applyFilterEdit}>

            {"Apply filters"}

          </button>

        </div>

      </DashboardFilterDialog>) : null}

      {!widgets.length ? (<State
        title="Your dashboard is empty"
        detail={editing ? "Choose Add widget to build your library overview." : "Enter edit mode to add your first widget."}
        actions={editing ? (<button type="button" className="btn btn-primary dirty-ui-button" onClick={function () { setAdding(true); }}>

          {"Add widget"}

        </button>) : (<button type="button" className="btn btn-primary dirty-ui-button" onClick={toggleEditing}>

          {"Edit dashboard"}

        </button>)} />) :
        (<div
          className={"dirty-stats-dashboard-grid" + (editing ? " is-editing" : "") + (draggingId ? " is-reordering" : "")}>

          {widgets.map(function (widget, index) {
            return (<DashboardWidget
              key={widget.id}
              widget={widget}
              index={index}
              editing={editing}
              dragging={draggingId === widget.id}
              resources={resources}
              onDragStart={function (event) { startDrag(index, event); }}
              onDragKeyDown={function (event) { moveWithKeyboard(index, event); }}
              onRemove={function () { remove(index); }}
              onTitle={function (title) { replace(index, { title: title }); }}
              onSize={function (size) { replace(index, { size: String(size) }); }}
              onFilter={function () { beginFilterEdit(index); }}
              onOptions={function (options) { replace(index, { options: normalizeOptions(WIDGETS[widget.statistic], options) }); }} />);
          })}

        </div>)}

    </section>);
  }
  return { DashboardPage };
}
