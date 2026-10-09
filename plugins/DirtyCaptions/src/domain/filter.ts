import type { NativeFilter, Criterion, CriterionOption, CriterionInput, CustomField, Definition, IntlContext } from "../types";
type NativeMethod = (this: NativeFilter, ...args: unknown[]) => unknown;
// Native CustomFieldsCriterion owns the value shape at this boundary.
function customValues(criterion: Criterion): CustomField[] { return (criterion.value || []) as CustomField[]; }
var ANY_FIELD = "Contains embedded captions", TEXT_FIELD = "Contains embedded text captions";
var STATUS_FIELD = "Caption index status";

var FILTER_TYPE = "dirty_captions", MESSAGE_ID = "dirtyCaptions.filter.embedded";
function fieldValue(field: string, value: string, modifier?: string): CustomField { return { field: field, modifier: modifier || "EQUALS", value: [value] }; }
export const DEFINITIONS: Definition[] = [
  { label: "Any captions", fields: [fieldValue(ANY_FIELD, "Yes")] },
  { label: "Text captions", fields: [fieldValue(TEXT_FIELD, "Yes")] },
  { label: "Bitmap / other", fields: [fieldValue(ANY_FIELD, "Yes"), fieldValue(TEXT_FIELD, "No")] },
  { label: "None", fields: [fieldValue(ANY_FIELD, "No")] },
  { label: "Verified", fields: [fieldValue(STATUS_FIELD, "Ready")] },
  { label: "Unverified", fields: [fieldValue(STATUS_FIELD, "Ready", "NOT_EQUALS")] }
];
function definitionFor(criterion: Criterion) { return DEFINITIONS.filter(function (item) { return criterion.value === item.label; })[0]; }
function fieldsFor(definition: Definition) { return definition.fields.map(function (field) { return Object.assign({}, field, { value: field.value.slice() }); }); }

export function canonicalFilter(filter: NativeFilter): NativeFilter {
  var fields: CustomField[] = [], retained: Criterion[] = [], changed = false, customCount = 0;
  filter.criteria.forEach(function (criterion) {
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
    var custom = filter.makeCriterion("custom_fields");
    custom.value = fields; retained.push(custom);
  }
  var canonical: NativeFilter = Object.create(filter);
  canonical.criteria = retained;
  // Native URL serialization initializes randomSeed. Keep that initialization
  // on the active model so serializing a bookmark cannot reshuffle results.
  canonical.getSortBy = function () { return filter.getSortBy(); };
  return canonical;
}

export function installNativeFilters(filter: NativeFilter | null | undefined, intl?: IntlContext | null) {
  if (!filter || filter.mode !== "SCENES" || !filter.options) return false;
  var options = filter.options.criterionOptions || [];
  var seed = options.filter(function (option) { return option.type === "resolution"; })[0];
  if (!seed || !options.some(function (option) { return option.type === "custom_fields"; })) return false;
  // These are plugin-owned messages in the current native Intl context.
  if (intl && intl.messages && !intl.messages[MESSAGE_ID]) intl.messages[MESSAGE_ID] = "Embedded captions";
  if (!options.some(function (option) { return option.type === FILTER_TYPE; })) {
    var option: CriterionOption = Object.assign(Object.create(Object.getPrototypeOf(seed)), seed, {
      type: FILTER_TYPE, messageID: MESSAGE_ID, sfwMessageID: MESSAGE_ID, hidden: false,
      options: DEFINITIONS.map(function (item) { return item.label; }), modifierOptions: ["EQUALS"], defaultModifier: "EQUALS"
    });
    option.makeCriterionFn = function () {
      // Use the native Resolution criterion and its enum radio controls.
      // These categories have no ordering or range operators.
      var criterion = seed.makeCriterion().clone();
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
  for (var old = options.length - 1; old >= 0; old -= 1) {
    if (/^dirty_captions_(any|text|verified)$/.test(options[old].type)) options.splice(old, 1);
  }
  var prototype = Object.getPrototypeOf(filter) as Record<string, unknown>, key = "__dirtyCaptionsNativeFilters";
  if (!prototype[key]) {
    // Convert only when serializing: the UI keeps one native enum criterion,
    // while GraphQL, saved filters and URLs use one normal custom-field list.
    ["makeFilter", "makeSavedFilter", "getEncodedParams"].forEach(function (name) {
      var original = prototype[name];
      if (typeof original !== "function") return;
      prototype[name] = function (this: NativeFilter, ...args: unknown[]) {
        return (original as NativeMethod).apply(this.mode === "SCENES" ? canonicalFilter(this) : this, args);
      };
    });
    ["configureFromDecodedParams", "configureFromSavedFilter"].forEach(function (name) {
      var original = prototype[name];
      if (typeof original !== "function") return;
      prototype[name] = function (this: NativeFilter, ...args: unknown[]) {
                var current = this;
        var result = (original as NativeMethod).apply(current, args);
        if (current.mode === "SCENES") current.criteria = normalizeFilter(current).criteria;
        return result;
      };
    });
    Object.defineProperty(prototype, key, { value: true });
  }
  return true;
}

export function normalizeFilter(filter: NativeFilter): NativeFilter {
  var values: CustomField[] = [];
  filter.criteria.forEach(function (criterion) {
    if (criterion.criterionOption.type === "custom_fields") values = values.concat(customValues(criterion));
  });
  if (filter.criteria.some(function (item) { return item.criterionOption.type === FILTER_TYPE; })) return filter;
  // Prefer the two-field bitmap category over its generic Any captions part.
  // Leave additional legacy predicates in Custom Fields to preserve their
  // exact meaning instead of broadening an existing URL or saved filter.
  var definition = DEFINITIONS.slice().sort(function (a, b) { return b.fields.length - a.fields.length; }).filter(function (item) {
    return item.fields.every(function (expected) {
      var matches = values.filter(function (field) { return field.field === expected.field; });
      return matches.length === 1 && matches[0].modifier === expected.modifier && matches[0].value &&
        matches[0].value.length === 1 && matches[0].value[0] === expected.value[0];
    });
  })[0];
  if (!definition) return filter;
  var next = filter.clone(), retained: Criterion[] = [], added = false;
  next.criteria.forEach(function (criterion) {
    if (criterion.criterionOption.type !== "custom_fields") { retained.push(criterion); return; }
    criterion.value = (customValues(criterion)).filter(function (field) {
      if (!definition.fields.some(function (expected) { return expected.field === field.field; })) return true;
      if (!added) {
        var nativeCriterion = next.makeCriterion(FILTER_TYPE);
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

