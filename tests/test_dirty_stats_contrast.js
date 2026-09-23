"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../plugins/DirtyStats/dirtyStats.css"), "utf8");
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"));
  assert(match, `Missing ${selector} theme block`);
  return match[1];
}
const shared = declarations(".dirty-stats-dashboard-dialog-backdrop");
function role(block, name, fallback) {
  const match = block.match(new RegExp("--dirty-stats-" + name + ":\\s*(#[0-9a-fA-F]{6})"));
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
for (const theme of ["classic", "candy", "tropical", "arcade", "paper"]) {
  const block = theme === "classic" ? shared : declarations(".dirty-stats-theme-" + theme);
  const value = name => role(block, name, role(shared, name));
  const accentText = role(block, "accent-text", value("accent"));
  for (const surface of ["bg", "panel", "panel-alt"]) {
    for (const [name, color] of [["text", value("text")], ["muted", value("muted")], ["primary", value("primary")], ["accent text", accentText]]) {
      const measured = contrast(color, value(surface));
      assert(measured >= 4.5, `${theme} ${name} on ${surface} is ${measured.toFixed(2)}:1, below 4.5:1`);
    }
  }
}
console.log("DirtyStats theme text contrast checks passed");
