import type { NativeFilter, Criterion, CriterionOption, CriterionInput, CustomField, Definition, IntlContext } from "../types";
type NativeMethod = (this: NativeFilter, ...args: unknown[]) => unknown;
// Native CustomFieldsCriterion owns the value shape at this boundary.
function customValues(criterion: Criterion): CustomField[] { return (criterion.value || []) as CustomField[]; }
const ANY_FIELD = "Contains embedded captions", TEXT_FIELD = "Contains embedded text captions";
const STATUS_FIELD = "Caption index status";

const FILTER_TYPE = "dirty_captions", MESSAGE_ID = "dirtyCaptions.filter.embedded";
function fieldValue(field: string, value: string, modifier?: string): CustomField { return { field, modifier: modifier || "EQUALS", value: [value] }; }
export const DEFINITIONS: Definition[] = [
  { label: "Any captions", fields: [fieldValue(ANY_FIELD, "Yes")] },
  { label: "Text captions", fields: [fieldValue(TEXT_FIELD, "Yes")] },
  { label: "Bitmap / other", fields: [fieldValue(ANY_FIELD, "Yes"), fieldValue(TEXT_FIELD, "No")] },
  { label: "None", fields: [fieldValue(ANY_FIELD, "No")] },
  { label: "Verified", fields: [fieldValue(STATUS_FIELD, "Ready")] },
  { label: "Unverified", fields: [fieldValue(STATUS_FIELD, "Ready", "NOT_EQUALS")] }
];
function definitionFor(criterion: Criterion) { return DEFINITIONS.filter(item => criterion.value === item.label)[0]; }
function fieldsFor(definition: Definition) { return definition.fields.map(field => Object.assign({}, field, { value: field.value.slice() })); }

export function canonicalFilter(filter: NativeFilter): NativeFilter {
  let fields: CustomField[] = [], retained: Criterion[] = [], changed = false, customCount = 0;
  filter.criteria.forEach(criterion => {
    if (criterion.criterionOption.type === FILTER_TYPE) {
      changed = true;
      if (criterion.isValid()) fields = fields.concat(fieldsFor(definitionFor(criterion)!));
    } else if (criterion.criterionOption.type === "custom_fields") {
      customCount += 1;
      fields = fields.concat(customValues(criterion));
    } else retained.push(criterion);
  });
  if (!changed && customCount < 2) return filter;
  if (fields.length) {
    const custom = filter.makeCriterion("custom_fields");
    custom.value = fields; retained.push(custom);
  }
  const canonical: NativeFilter = Object.create(filter);
  canonical.criteria = retained;
  // Native URL serialization initializes randomSeed. Keep that initialization
  // on the active model so serializing a bookmark cannot reshuffle results.
  canonical.getSortBy = () => filter.getSortBy();
  return canonical;
}

export function installNativeFilters(filter: NativeFilter | null | undefined, intl?: IntlContext | null) {
  if (!filter || filter.mode !== "SCENES" || !filter.options) return false;
  const options = filter.options.criterionOptions || [];
  const seed = options.filter(option => option.type === "resolution")[0];
  if (!seed || !options.some(option => option.type === "custom_fields")) return false;
  // These are plugin-owned messages in the current native Intl context.
  if (intl && intl.messages && !intl.messages[MESSAGE_ID]) intl.messages[MESSAGE_ID] = "Embedded captions";
  if (!options.some(option => option.type === FILTER_TYPE)) {
    const option: CriterionOption = Object.assign(Object.create(Object.getPrototypeOf(seed)), seed, {
      type: FILTER_TYPE, messageID: MESSAGE_ID, sfwMessageID: MESSAGE_ID, hidden: false,
      options: DEFINITIONS.map(item => item.label), modifierOptions: ["EQUALS"], defaultModifier: "EQUALS"
    });
    option.makeCriterionFn = () => {
      // Use the native Resolution criterion and its enum radio controls.
      // These categories have no ordering or range operators.
      const criterion = seed.makeCriterion().clone();
      criterion.criterionOption = option;
      criterion.value = ""; criterion.modifier = "EQUALS";
      criterion.isValid = function () { return this.modifier === "EQUALS" && Boolean(definitionFor(this)); };
      criterion.toCriterionInput = function () { return this.isValid() ? fieldsFor(definitionFor(this)!) : []; };
      criterion.applyToCriterionInput = criterion.applyToSavedCriterion = function (input: CriterionInput) {
        if (this.isValid()) input.custom_fields = (input.custom_fields || []).concat(this.toCriterionInput!());
      };
      return criterion;
    };
    options.push(option);
  }
  const prototype = Object.getPrototypeOf(filter) as Record<string, unknown>, key = "__dirtyCaptionsNativeFilters";
  if (!prototype[key]) {
    // Convert only when serializing: the UI keeps one native enum criterion,
    // while GraphQL, saved filters and URLs use one normal custom-field list.
    ["makeFilter", "makeSavedFilter", "getEncodedParams"].forEach(name => {
      const original = prototype[name];
      if (typeof original !== "function") return;
      prototype[name] = function (this: NativeFilter, ...args: unknown[]) {
        return (original as NativeMethod).apply(this.mode === "SCENES" ? canonicalFilter(this) : this, args);
      };
    });
    ["configureFromDecodedParams", "configureFromSavedFilter"].forEach(name => {
      const original = prototype[name];
      if (typeof original !== "function") return;
      prototype[name] = function (this: NativeFilter, ...args: unknown[]) {
                const current = this;
        const result = (original as NativeMethod).apply(current, args);
        if (current.mode === "SCENES") current.criteria = normalizeFilter(current).criteria;
        return result;
      };
    });
    Object.defineProperty(prototype, key, { value: true });
  }
  return true;
}

export function normalizeFilter(filter: NativeFilter): NativeFilter {
  let values: CustomField[] = [];
  filter.criteria.forEach(criterion => {
    if (criterion.criterionOption.type === "custom_fields") values = values.concat(customValues(criterion));
  });
  if (filter.criteria.some(item => item.criterionOption.type === FILTER_TYPE)) return filter;
  // Prefer the two-field bitmap category over its generic Any captions part.
  // Leave additional predicates in Custom Fields to preserve their exact
  // meaning instead of broadening an existing URL or saved filter.
  const definition = DEFINITIONS.slice().sort((a, b) => b.fields.length - a.fields.length).filter(item => {
    return item.fields.every(expected => {
      const matches = values.filter(field => field.field === expected.field);
      return matches.length === 1 && matches[0].modifier === expected.modifier && matches[0].value &&
        matches[0].value.length === 1 && matches[0].value[0] === expected.value[0];
    });
  })[0];
  if (!definition) return filter;
  let next = filter.clone(), retained: Criterion[] = [], added = false;
  next.criteria.forEach(criterion => {
    if (criterion.criterionOption.type !== "custom_fields") { retained.push(criterion); return; }
    criterion.value = (customValues(criterion)).filter(field => {
      if (!definition.fields.some(expected => expected.field === field.field)) return true;
      if (!added) {
        const nativeCriterion = next.makeCriterion(FILTER_TYPE);
        nativeCriterion.value = definition.label; nativeCriterion.modifier = "EQUALS";
        retained.push(nativeCriterion); added = true;
      }
      return false;
    });
    if (customValues(criterion).length) retained.push(criterion);
  });
  next.criteria = retained;
  return next;
}

