import type * as R from "react";
import { getSceneTitle } from "../domain/items";
import { DirtyPlugins, PluginApi, React } from "../runtime";
import { SEARCH_PAGE_SIZE } from "../queries";
import type { SceneCondition } from "../../../DirtyPlugins/src/types";
import type { Item, SearchCondition, SessionSearch, SessionSearchResult } from "../types";
import { icon, PluginIconButton } from "./Controls";
import { SceneOCounterButton } from "./Counter";
import { PerformerNavigation } from "./PerformerNavigation";

function SceneSearchDialog({
  screenIndex,
  onSelect,
  onClose,
  openerRef,
  searchSession,
}: {
  screenIndex: number;
  onSelect(item: Item): void;
  onClose(): void;
  openerRef: R.RefObject<HTMLButtonElement>;
  searchSession: SessionSearch;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const filterRef = React.useRef<HTMLDivElement>(null);
  // Nothing is searched until Stash's own controls report their first filter.
  const [search, setSearch] = React.useState<{ condition: SearchCondition | null; page: number; revision: number }>({
    condition: null,
    page: 1,
    revision: 0,
  });
  const [result, setResult] = React.useState<{
    key: string;
    source: SessionSearch;
    data?: SessionSearchResult;
    error?: boolean;
  } | null>(null);
  const condition = search.condition;
  const key = JSON.stringify([condition, search.page, search.revision]);
  React.useEffect(() => {
    if (!condition) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchSession(condition, search.page, controller.signal).then(
        data => {
          if (active) setResult({ key, source: searchSession, data });
        },
        () => {
          if (active) setResult({ key, source: searchSession, error: true });
        },
      );
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, searchSession]);
  const current = condition && result?.key === key && result.source === searchSession ? result : null;
  const changeCondition = (value: SceneCondition) => {
    const next = { find: value.find ?? {}, scene: value.scene ?? {} };
    // The first filter arrives once the native search box exists, which then takes focus.
    if (!search.condition && document.activeElement === closeRef.current)
      filterRef.current?.querySelector<HTMLInputElement>(".filtered-list-toolbar .search-term-input input")?.focus();
    setSearch(previous =>
      JSON.stringify(previous.condition) === JSON.stringify(next)
        ? previous
        : { condition: next, page: 1, revision: 0 },
    );
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
      <p className="ms-scene-search-help">
        Search and filter this session with Stash&apos;s own controls. Choosing a result changes only this screen.
      </p>
      <div ref={filterRef}>
        <DirtyPlugins.react.NativeSceneFilter className="ms-scene-search-filter" onChange={changeCondition} />
      </div>
      <div className="ms-scene-search-results" aria-busy={!!condition && !current}>
        {!!condition && !current && <p role="status">Searching scenes…</p>}
        {current?.error && (
          <div role="alert">
            <p>Could not search scenes.</p>
            <DirtyPlugins.react.Button onClick={() => setSearch(value => ({ ...value, revision: value.revision + 1 }))}>
              Retry
            </DirtyPlugins.react.Button>
          </div>
        )}
        {current?.data && (
          <>
            <p role="status">
              {current.data.count
                ? `${current.data.count} ${current.data.count === 1 ? "result" : "results"} found`
                : "No scenes match your search."}
            </p>
            <ul className="ms-scene-search-list">
              {current.data.items.map(item => (
                <li key={item.id}>
                  <DirtyPlugins.react.Button
                    className="ms-scene-search-result"
                    onClick={() => {
                      onSelect(item);
                    }}
                  >
                    <span>{item.title}</span>
                    <small>
                      Scene {item.scene.id}
                      {item.playbackRange
                        ? ` · ${getSceneTitle(item.scene)} @ ${Math.floor(item.playbackRange.start)}s`
                        : ""}
                    </small>
                  </DirtyPlugins.react.Button>
                </li>
              ))}
            </ul>
            <DirtyPlugins.react.Pagination
              ariaLabel="Scene search pages"
              page={search.page}
              totalPages={Math.ceil(current.data.count / SEARCH_PAGE_SIZE)}
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
  item,
  screenIndex,
  onSelect,
  searchSession,
  showPerformerNavigation,
  onNavigatePerformer,
}: {
  busy: boolean;
  item?: Item;
  screenIndex: number;
  onSelect(item: Item): void;
  searchSession: SessionSearch;
  showPerformerNavigation: boolean;
  onNavigatePerformer(performerId: string): void;
}) {
  const [open, setOpen] = React.useState(false);
  const openerRef = React.useRef<HTMLButtonElement>(null);
  const openedWithoutFocusRing = React.useRef(false);
  // The dialog returns focus to its opener, which would keep the header showing after a mouse user is done.
  React.useEffect(() => {
    if (!open && openedWithoutFocusRing.current) openerRef.current?.blur();
  }, [open]);
  return (
    <>
      <div className="ms-pane-header">
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
        {showPerformerNavigation && (
          <PerformerNavigation
            performers={item?.scene.performers ?? []}
            screenIndex={screenIndex}
            busy={busy}
            onNext={onNavigatePerformer}
          />
        )}
        {item && <SceneOCounterButton key={item.scene.id} sceneId={item.scene.id} screenIndex={screenIndex} />}
      </div>
      {open && (
        <SceneSearchDialog
          screenIndex={screenIndex}
          openerRef={openerRef}
          searchSession={searchSession}
          onClose={() => setOpen(false)}
          onSelect={item => {
            onSelect(item);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
