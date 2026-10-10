"use strict";

const assert = require("node:assert/strict");
const { requireSource } = require("./plugin_paths");

const firstContents = "export const value = 1;";
const secondContents = "export const value = 2;";
const first = requireSource("DirtyPlugins", "source-loader-test.ts", { contents: firstContents });
const second = requireSource("DirtyPlugins", "source-loader-test.ts", { contents: secondContents });
assert.equal(first.value, 1);
assert.equal(second.value, 2, "different virtual contents at the same filename are evaluated separately");
assert.equal(
  requireSource("DirtyPlugins", "source-loader-test.ts", { contents: firstContents }),
  first,
  "the same virtual source is evaluated once, like require()",
);
assert.deepEqual(
  requireSource("DirtyPlugins", "source-loader-test.ts", { contents: "" }),
  {},
  "empty virtual contents compile without reading a nonexistent source file",
);
console.log("Source module cache respects virtual contents");
