import { getSceneItem } from "./domain/items";
import { catalogScope, SEARCH_PAGE_SIZE } from "./queries";
import { queries } from "./runtime";
import type { SearchCondition, SessionSearchResult } from "./types";

export const catalogPageCount = (count: number) => Math.max(1, Math.ceil(count / SEARCH_PAGE_SIZE));

export async function searchCatalog(
  condition: SearchCondition,
  page: number,
  signal: AbortSignal,
  scope?: SearchCondition,
): Promise<SessionSearchResult> {
  const { findScenes } = await queries.searchSession(
    scope ? catalogScope(scope) : { filter: {} },
    false,
    condition,
    page,
    signal,
  );
  return { count: findScenes.count, items: findScenes.scenes.map(getSceneItem).filter(item => item !== null) };
}

export async function findCatalogPerformerItems(scope: SearchCondition, performerId: string, signal: AbortSignal) {
  const { findScenes } = await queries.findPerformerItems(
    catalogScope(scope),
    false,
    performerId,
    signal,
    undefined,
    true,
  );
  return findScenes.scenes.map(getSceneItem).filter(item => item !== null);
}
