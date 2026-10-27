import type * as R from "react";
import { getSceneTitle } from "../domain/items";
import { DirtyPlugins, PluginApi, React } from "../runtime";
import { SEARCH_PAGE_SIZE } from "../queries";
import type { Item, SessionSearch, SessionSearchResult } from "../types";
import { icon, PluginIconButton } from "./Controls";

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
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [search, setSearch] = React.useState({ text: "", page: 1, revision: 0 });
  const [result, setResult] = React.useState<{
    key: string;
    source: SessionSearch;
    data?: SessionSearchResult;
    error?: boolean;
  } | null>(null);
  const term = search.text.trim();
  const key = JSON.stringify([term, search.page, search.revision]);
  React.useEffect(() => {
    if (!term) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void searchSession(term, search.page, controller.signal).then(
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
  const current = term && result?.key === key && result.source === searchSession ? result : null;
  return (
    <DirtyPlugins.react.Dialog
      className="dirty-ui-dialog ms-scene-search-dialog"
      ariaLabel={`Search scenes for screen ${screenIndex + 1}`}
      initialFocusRef={inputRef}
      openerRef={openerRef}
      onClose={onClose}
    >
      <div className="ms-scene-search-heading">
        <h2>Scene for screen {screenIndex + 1}</h2>
        <PluginIconButton ariaLabel="Close scene search" fallback="x" icon={icon("close")} onClick={onClose} />
      </div>
      <DirtyPlugins.react.Field
        id={`ms-scene-search-${screenIndex}`}
        label="Search scenes"
        help="Search video titles in this session. Choosing a result changes only this screen."
      >
        <input
          ref={inputRef}
          type="search"
          className="form-control"
          value={search.text}
          placeholder="Search for a scene…"
          onChange={event => setSearch({ text: event.target.value, page: 1, revision: 0 })}
        />
      </DirtyPlugins.react.Field>
      <div className="ms-scene-search-results" aria-busy={!!term && !current}>
        {!term && <p role="status">Enter a search to find a scene.</p>}
        {!!term && !current && <p role="status">Searching scenes…</p>}
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
  item,
  screenIndex,
  onSelect,
  searchSession,
}: {
  item?: Item;
  screenIndex: number;
  onSelect(item: Item): void;
  searchSession: SessionSearch;
}) {
  const [open, setOpen] = React.useState(false);
  const openerRef = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <div className="ms-pane-header">
        {item ? (
          <PluginApi.libraries.ReactRouterDOM.NavLink
            aria-label={`Open scene page for ${item.title}`}
            className="ms-title"
            rel="noopener noreferrer"
            target="_blank"
            title={`Open scene page: ${item.title}`}
            to={`/scenes/${item.scene.id}`}
          >
            {item.title}
          </PluginApi.libraries.ReactRouterDOM.NavLink>
        ) : (
          <span className="ms-title">Screen {screenIndex + 1}</span>
        )}
        <PluginIconButton
          ariaLabel={`Search scenes for screen ${screenIndex + 1}`}
          fallback="⌕"
          icon={icon("search")}
          buttonRef={openerRef}
          onClick={() => setOpen(true)}
        />
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
