"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../plugins/DirtyPlugins/dirtyPlugins.css"), "utf8");
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"));
  assert(match, `Missing ${selector} theme block`);
  return match[1];
}
const shared = declarations(":root");
function role(block, name, fallback) {
  const match = block.match(new RegExp("--dirty-theme-" + name + ":\\s*(#[0-9a-fA-F]{6})"));
  return match ? match[1] : fallback;
}
function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
for (const theme of ["classic", "candy", "tropical", "arcade", "paper", "destijl", "destijl-dark"]) {
  const block = theme === "classic" ? shared : declarations(".dirty-ui-theme-" + theme);
  const value = name => role(block, name, role(shared, name));
  const accentText = role(block, "accent-text", value("accent"));
  for (const surface of ["bg", "panel", "panel-alt"]) {
    for (const [name, color] of [["text", value("text")], ["muted", value("muted")], ["primary", value("primary")], ["accent text", accentText]]) {
      const measured = contrast(color, value(surface));
      assert(measured >= 4.5, `${theme} ${name} on ${surface} is ${measured.toFixed(2)}:1, below 4.5:1`);
    }
  }
}
function property(block, name) {
  const match = block.match(new RegExp(name + ":\\s*(#[0-9a-fA-F]{6})"));
  assert(match, "Missing colour token " + name);
  return match[1];
}
for (const theme of ["destijl", "destijl-dark"]) {
  const block = declarations(".dirty-ui-theme-" + theme);
  assert(contrast(role(block, "on-accent"), property(shared, "--dirty-ui-icon-blue")) >= 4.5,
    theme + " primary buttons and selected tabs have readable labels");
  assert(contrast(property(block, "--dirty-ui-on-danger-action"), property(block, "--dirty-ui-danger-action")) >= 4.5,
    theme + " destructive buttons have readable labels");
}
console.log("DirtyStats theme text contrast checks passed");
