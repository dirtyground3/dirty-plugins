import type * as R from "react";
import { searchCatalog } from "../catalog";
import { getSceneTitle } from "../domain/items";
import { CONTROLS_IDLE_MS, useIdle } from "../hooks";
import { DirtyPlugins, PluginApi, React } from "../runtime";
import { SEARCH_PAGE_SIZE } from "../queries";
import type { SceneCondition } from "../../../DirtyPlugins/src/types";
import type { CatalogChoice, Item, SearchCondition, SessionSearch, SessionSearchResult } from "../types";
import { icon, PluginIconButton } from "./Controls";
import { SceneOCounterButton } from "./Counter";
import { PerformerNavigation } from "./PerformerNavigation";

/** Start from a random slot across every page, skipping pages without playable results. */
async function randomResult(
  source: SessionSearch,
  condition: SearchCondition,
  shownPage: number,
  shown: SessionSearchResult,
  signal: AbortSignal,
) {
  const slot = Math.floor(Math.random() * shown.count);
  const startPage = Math.floor(slot / SEARCH_PAGE_SIZE);
  const pages = Math.ceil(shown.count / SEARCH_PAGE_SIZE);
  for (let step = 0; step < pages && !signal.aborted; step++) {
    const page = ((startPage + step) % pages) + 1;
    const result = page === shownPage ? shown : await source(condition, page, signal);
    const item =
      (step === 0 && result.items[slot % SEARCH_PAGE_SIZE]) ||
      result.items[Math.floor(Math.random() * result.items.length)];
    if (item) return { item, page, result };
  }
  return null;
}

function SceneSearchDialog({
  screenIndex,
  onSelect,
  onClose,
  openerRef,
  searchSession,
}: {
  screenIndex: number;
  onSelect(item: Item, catalog?: CatalogChoice): void;
  onClose(): void;
  openerRef: R.RefObject<HTMLButtonElement>;
  searchSession: SessionSearch;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const filterRef = React.useRef<HTMLDivElement>(null);
  const randomRequest = React.useRef<AbortController>();
  const [pickStatus, setPickStatus] = React.useState<"picking" | "empty" | "error" | null>(null);
  const [randomSort] = React.useState(() => `random_${Math.floor(Math.random() * 2147483647)}`);
  // Nothing is searched until Stash's own controls report their first filter.
  const [search, setSearch] = React.useState<{
    condition: SearchCondition | null;
    page: number;
    revision: number;
    newQueue: boolean;
    shuffleSeed?: number;
  }>({
    condition: null,
    page: 1,
    revision: 0,
    newQueue: false,
  });
  const [result, setResult] = React.useState<{
    key: string;
    source: SessionSearch;
    data?: SessionSearchResult;
    error?: boolean;
  } | null>(null);
  const { newQueue, shuffleSeed } = search;
  let condition = search.condition;
  if (condition && shuffleSeed !== undefined) condition = { ...condition, shuffleSeed };
  else if (newQueue && condition?.find?.sort === "random")
    condition = { ...condition, find: { ...condition.find, sort: randomSort } };
  const source = newQueue ? searchCatalog : searchSession;
  const key = JSON.stringify([condition, search.page, search.revision, newQueue]);
  React.useEffect(() => {
    if (!condition) return;
    setPickStatus(null);
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void source(condition, search.page, controller.signal).then(
        data => {
          if (active) setResult({ key, source, data });
        },
        () => {
          if (active) setResult({ key, source, error: true });
        },
      );
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
      randomRequest.current?.abort();
      randomRequest.current = undefined;
    };
  }, [key, source]);
  const current = condition && result?.key === key && result.source === source ? result : null;
  const data = current?.data;
  const resultSummary = data?.count
    ? `${data.count} ${data.count === 1 ? "result" : "results"} found${shuffleSeed === undefined ? "" : " · Shuffled"}`
    : data
      ? "No scenes match your search."
      : condition && !current
        ? "Searching scenes…"
        : "";
  const choice = (page: number, result: SessionSearchResult) =>
    newQueue && condition ? { condition, page, result } : undefined;
  const playRandom = async () => {
    if (!condition || !data?.count || randomRequest.current) return;
    const controller = (randomRequest.current = new AbortController());
    setPickStatus("picking");
    try {
      const picked = await randomResult(source, condition, search.page, data, controller.signal);
      if (controller.signal.aborted) return;
      if (picked) onSelect(picked.item, choice(picked.page, picked.result));
      else setPickStatus("empty");
    } catch {
      if (!controller.signal.aborted) setPickStatus("error");
    } finally {
      if (randomRequest.current === controller) randomRequest.current = undefined;
    }
  };
  const changeCondition = (value: SceneCondition) => {
    const next = { find: value.find ?? {}, scene: value.scene ?? {} };
    // The first filter arrives once the native search box exists, which then takes focus.
    if (!search.condition && document.activeElement === closeRef.current)
      filterRef.current?.querySelector<HTMLInputElement>(".filtered-list-toolbar .search-term-input input")?.focus();
    setSearch(previous => {
      if (JSON.stringify(previous.condition) === JSON.stringify(next)) return previous;
      const lastSort = previous.condition?.find;
      const sortChanged = lastSort?.sort !== next.find.sort || lastSort?.direction !== next.find.direction;
      return {
        ...previous,
        condition: next,
        shuffleSeed: sortChanged ? undefined : previous.shuffleSeed,
        page: 1,
        revision: previous.revision + 1,
      };
    });
  };
  return (
    <DirtyPlugins.react.Dialog
      className="dirty-ui-dialog ms-scene-search-dialog"
      backdropClassName="dirty-ui-backdrop ms-scene-search-backdrop"
      ariaLabel={`Search scenes for screen ${screenIndex + 1}`}
      allowNativePopup={true}
      initialFocusRef={closeRef}
      openerRef={openerRef}
      onClose={onClose}
    >
      <div className="ms-scene-search-heading">
        <h2>Scene for screen {screenIndex + 1}</h2>
        <PluginIconButton
          ariaLabel="Close scene search"
          buttonRef={closeRef}
          fallback="x"
          icon={icon("close")}
          onClick={onClose}
        />
      </div>
      <DirtyPlugins.react.SettingsToggle
        label="Start a new queue"
        checked={newQueue}
        onChange={checked =>
          setSearch(value => ({ ...value, newQueue: checked, page: 1, revision: value.revision + 1 }))
        }
      />
      <p className="ms-scene-search-help">
        {newQueue
          ? "Search the whole catalog. Picking a scene gives this screen its own queue from these results."
          : "Search this screen’s current queue. Picking a scene keeps the queue in place."}
      </p>
      <div ref={filterRef}>
        <DirtyPlugins.react.NativeSceneFilter className="ms-scene-search-filter" onChange={changeCondition} />
      </div>
      <div className="ms-scene-search-results" aria-busy={!!condition && !current}>
        <div className="ms-scene-search-result-bar">
          <p role="status">{resultSummary}</p>
          <div className="ms-scene-search-actions">
            <DirtyPlugins.react.Button
              compact={true}
              title="Shuffle matching results"
              disabled={(data?.count ?? 0) < 2 || pickStatus === "picking"}
              onClick={() => {
                const seed = Math.floor(Math.random() * 2147483647);
                setSearch(value => ({ ...value, shuffleSeed: seed, page: 1, revision: value.revision + 1 }));
              }}
            >
              Shuffle
            </DirtyPlugins.react.Button>
            <DirtyPlugins.react.Button
              compact={true}
              title="Play a random matching scene"
              busy={pickStatus === "picking"}
              disabled={!data?.count}
              onClick={() => void playRandom()}
            >
              Random scene
            </DirtyPlugins.react.Button>
          </div>
        </div>
        {pickStatus === "picking" && <p role="status">Picking a random scene…</p>}
        {pickStatus === "empty" && <p role="status">No playable scenes match your search.</p>}
        {pickStatus === "error" && <p role="alert">Could not pick a random scene. Try again.</p>}
        {current?.error && (
          <div role="alert">
            <p>Could not search scenes.</p>
            <DirtyPlugins.react.Button onClick={() => setSearch(value => ({ ...value, revision: value.revision + 1 }))}>
              Retry
            </DirtyPlugins.react.Button>
          </div>
        )}
        {data && (
          <>
            <ul className="ms-scene-search-list">
              {data.items.map(item => {
                const detail =
                  `Scene ${item.scene.id}` +
                  (item.playbackRange
                    ? ` · ${getSceneTitle(item.scene)} @ ${Math.floor(item.playbackRange.start)}s`
                    : "");
                return (
                  <li key={item.id}>
                    <DirtyPlugins.react.Button
                      className="ms-scene-search-result"
                      onClick={() => onSelect(item, choice(search.page, data))}
                    >
                      <span>{item.title}</span>
                      {/* An untitled scene is already named by its number. */}
                      {detail !== item.title && <small>{detail}</small>}
                    </DirtyPlugins.react.Button>
                  </li>
                );
              })}
            </ul>
            <DirtyPlugins.react.Pagination
              ariaLabel="Scene search pages"
              page={search.page}
              totalPages={Math.ceil(data.count / SEARCH_PAGE_SIZE)}
              onPageChange={page => setSearch(value => ({ ...value, page }))}
            />
          </>
        )}
      </div>
    </DirtyPlugins.react.Dialog>
  );
}

export function PaneHeader({
  busy,
  editing,
  item,
  screenIndex,
  onSelect,
  searchSession,
  showPerformerNavigation,
  onNavigatePerformer,
}: {
  busy: boolean;
  editing: boolean;
  item?: Item;
  screenIndex: number;
  onSelect(item: Item, catalog?: CatalogChoice): void;
  searchSession: SessionSearch;
  showPerformerNavigation: boolean;
  onNavigatePerformer(performerId: string): void;
}) {
  const [open, setOpen] = React.useState(false);
  const openerRef = React.useRef<HTMLButtonElement>(null);
  const openedWithoutFocusRing = React.useRef(false);
  // The group hides and shows like the main buttons, by how near the mouse is to it.
  const groupRef = React.useRef<HTMLDivElement>(null);
  const idle = useIdle(groupRef, CONTROLS_IDLE_MS, editing);
  // The dialog returns focus to its opener, which would keep the header showing after a mouse user is done.
  React.useEffect(() => {
    if (!open && openedWithoutFocusRing.current) openerRef.current?.blur();
  }, [open]);
  // One group at the screen's top left: the scene link, the performers, search, then the scene's O button.
  return (
    <>
      <div className="ms-pane-header">
        <div className={"ms-pane-navigation" + (idle ? " ms-idle" : "")} ref={groupRef}>
          {item && (
            <PluginApi.libraries.ReactRouterDOM.NavLink
              aria-label={`Open scene page for ${item.title}`}
              className="dirty-ui-icon-button ms-button ms-scene-link"
              rel="noopener noreferrer"
              target="_blank"
              title={`Open scene page: ${item.title}`}
              to={`/scenes/${item.scene.id}`}
            >
              <DirtyPlugins.react.Glyph icon={icon("scene")} fallback="↗" />
            </PluginApi.libraries.ReactRouterDOM.NavLink>
          )}
          {showPerformerNavigation && (
            <PerformerNavigation
              performers={item?.scene.performers ?? []}
              screenIndex={screenIndex}
              busy={busy}
              onNext={onNavigatePerformer}
            />
          )}
          <PluginIconButton
            ariaLabel={`Search scenes for screen ${screenIndex + 1}`}
            fallback="⌕"
            icon={icon("search")}
            buttonRef={openerRef}
            onClick={() => {
              openedWithoutFocusRing.current = !openerRef.current?.matches(":focus-visible");
              setOpen(true);
            }}
          />
          {item && (
            <>
              <span className="ms-pane-separator" aria-hidden="true" />
              <SceneOCounterButton key={item.scene.id} sceneId={item.scene.id} screenIndex={screenIndex} />
            </>
          )}
        </div>
      </div>
      {open && (
        <SceneSearchDialog
          screenIndex={screenIndex}
          openerRef={openerRef}
          searchSession={searchSession}
          onClose={() => setOpen(false)}
          onSelect={(item, catalog) => {
            onSelect(item, catalog);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
