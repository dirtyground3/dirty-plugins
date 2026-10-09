import { installNativeFilters, normalizeFilter } from "./domain/filter";
import type * as R from "react";
import type { ReactNode } from "react";
import type { NativeProps, Criterion, IntlContext } from "./types";
export function createListDecorator(React: typeof R) {
    function nativeFilterProps(result: ReactNode): NativeProps | null {
      if (Array.isArray(result)) {
        for (let i = 0; i < result.length; i += 1) { const found = nativeFilterProps(result[i]); if (found) return found; }
        return null;
      }
      if (!React.isValidElement<NativeProps>(result)) return null;
      const props = result.props || {};
      if (props.filter && props.filter.mode === "SCENES" && props.setFilter) return props;
      return props.children ? nativeFilterProps(props.children) : null;
    }
    function updateCriteriaProps(result: ReactNode, previous: Criterion[], criteria: Criterion[]): ReactNode {
      if (Array.isArray(result)) {
        const children = result.map(item => updateCriteriaProps(item, previous, criteria));
        return children.every((item, index) => item === result[index]) ? result : children;
      }
      if (!React.isValidElement<NativeProps>(result)) return result;
      const props = result.props || {}, changes: Partial<NativeProps> = props.criteria === previous ? { criteria } : {};
      if (!props.children) return props.criteria === previous ? React.cloneElement(result, changes) : result;
      const updatedChildren = updateCriteriaProps(props.children, previous, criteria);
      if (props.criteria !== previous && updatedChildren === props.children) return result;
      return React.cloneElement(result, changes, updatedChildren);
    }
    function decorateList(result: ReactNode, intl?: IntlContext | null): ReactNode {
      const props = nativeFilterProps(result);
      if (!props || !installNativeFilters(props.filter, intl)) return result;
      const normalized = normalizeFilter(props.filter);
      if (normalized === props.filter) return result;
      // URL-backed Stash lists reconstruct their model from query parameters.
      // Calling setFilter with equivalent parameters cannot update that model.
      // Adapt its criteria before native child controls render instead.
      const previous = props.filter.criteria;
      props.filter.criteria = normalized.criteria;
      return updateCriteriaProps(result, previous, normalized.criteria);
    }
return decorateList;
}
