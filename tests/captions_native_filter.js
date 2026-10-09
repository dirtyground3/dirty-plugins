"use strict";
function createNativeModels(){
class NativeCriterion {
  constructor(option, value) { this.criterionOption = option; this.value = value; }
  clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { value: structuredClone(this.value) }); }
  getId() { return this.criterionOption.type; }
  toQueryParams() { return { type: this.criterionOption.type, value: this.value }; }
  setFromSavedCriterion(value) { this.value = structuredClone(value); }
  fromDecodedParams(value) { this.value = structuredClone(value.value); }
  applyToCriterionInput(input) { input[this.criterionOption.type] = this.value; }
  applyToSavedCriterion(input) { this.applyToCriterionInput(input); }
}
class NativeBooleanCriterion extends NativeCriterion {
  isValid() { return this.value === "true" || this.value === "false"; }
  getLabel(intl) { return intl.messages[this.criterionOption.messageID] + " is " + this.value; }
}
class NativeResolutionCriterion extends NativeCriterion {
  constructor(option) { super(option, ""); this.modifier = "EQUALS"; }
  isValid() { return this.value.length > 0; }
  getLabel(intl) { return intl.messages[this.criterionOption.messageID] + " is " + this.value; }
}
class NativeCustomFieldsCriterion extends NativeCriterion {
  isValid() { return this.value.length > 0; }
}
class NativeOption {
  constructor(type, makeCriterion) { this.type = type; this.messageID = type; this.makeCriterionFn = makeCriterion; }
  makeCriterion() { return this.makeCriterionFn(this); }
}
const options = { criterionOptions: [
  new NativeOption("organized", option => new NativeBooleanCriterion(option, "")),
  new NativeOption("resolution", option => new NativeResolutionCriterion(option)),
  new NativeOption("custom_fields", option => new NativeCustomFieldsCriterion(option, [])),
  new NativeOption("performers", option => new NativeCriterion(option, []))
] };
class NativeFilter {
  constructor(mode = "SCENES") {
    Object.assign(this, { mode, options, criteria: [], currentPage: 5, sortBy: "rating", searchTerm: "test", randomSeed: -1 });
  }
  clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { criteria: this.criteria.map(c => c.clone()) }); }
  makeCriterion(type) { return this.options.criterionOptions.find(option => option.type === type).makeCriterion(); }
  makeFilter() { const input = {}; this.criteria.forEach(c => c.applyToCriterionInput(input)); return input; }
  makeSavedFilter() { const input = {}; this.criteria.forEach(c => c.applyToSavedCriterion(input)); return input; }
  getSortBy() {
    if (this.sortBy !== "random") return this.sortBy;
    if (this.randomSeed === -1) this.randomSeed = 123;
    return "random_" + this.randomSeed;
  }
  getEncodedParams() { return { sortby: this.getSortBy(), c: this.criteria.map(c => c.toQueryParams()) }; }
  configureFromSavedFilter(saved) { this.criteria = Object.entries(saved).map(([type, value]) => {
    const c = this.makeCriterion(type); c.setFromSavedCriterion(value); return c;
  }); }
  configureFromDecodedParams(params) { this.criteria = params.c.map(value => {
    const c = this.makeCriterion(value.type); c.fromDecodedParams(value); return c;
  }); }
}
function criterion(type, value, filter = new NativeFilter()) {
  const c = filter.makeCriterion(type); c.value = value; return c;
}
return {NativeFilter, NativeResolutionCriterion, options, criterion};
}
module.exports={createNativeModels};
