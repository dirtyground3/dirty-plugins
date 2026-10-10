import { React, hub, ui } from "../runtime";
import * as rules from "../domain/rules";
import { copy, bytes, filterSummary } from "../domain/rules";
import { field, hidden } from "./RuleField";
import type { Rule, Sample, Capabilities, Option } from "../types";
export interface RuleRowProps {
  rule: Rule;
  index: number;
  capture: boolean;
  last: boolean;
  capabilities: Capabilities | null;
  open: boolean;
  detecting: boolean;
  onToggle(): void;
  onDetect(): void;
  onChange(rule: Rule): void;
  onMove(direction: number): void;
  onDuplicate(): void;
  onRemove(): void;
}
const ESTIMATE_SAMPLE = 200;
export function RuleRow(props: RuleRowProps) {
  const { useState, useEffect } = React;
  const r = props.rule;
  const [openFilter, setOpenFilter] = useState(false);
  const [sample, setSample] = useState<Sample | "unavailable" | null>(null);
  let preset = rules.RESOLUTIONS.some(item => item[0] === r.width + "x" + r.height);
  const [customSize, setCustomSize] = useState(!preset);
  let matchKey = JSON.stringify(r.condition);
  useEffect(() => {
    let active = true;
    setSample(null);
    let timer = setTimeout(() => {
      let condition = r.condition || {};
      if (!condition.all && !Object.keys(condition.scene || {}).length && !(condition.find || {}).q) return;
      // A fixed-seed random sample keeps the estimate stable while editing.
      hub
        .graphql<{ findScenes: Sample }>(
          "query($find:FindFilterType,$scene:SceneFilterType){findScenes(filter:$find,scene_filter:$scene){count filesize " +
            "scenes{files{size duration width height bit_rate frame_rate}}}}",
          {
            find: Object.assign({}, condition.find, { per_page: ESTIMATE_SAMPLE, page: 1, sort: "random_20260928" }),
            scene: condition.scene || {},
          },
        )
        .then(data => {
          if (active) setSample(data.findScenes);
        })
        .catch(() => {
          if (active) setSample("unavailable");
        });
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [matchKey]);
  function change<K extends keyof Rule>(key: K, value: Rule[K]) {
    let next = copy(r);
    next[key] = value;
    props.onChange(next);
  }
  let encoderOptions: Option[] = [
    ["auto", "Auto (GPU if available)"],
    ["cpu", "CPU"],
  ];
  ((props.capabilities && props.capabilities.encoders[r.codec]) || []).forEach(kind => {
    if (kind !== "cpu")
      encoderOptions.push([
        kind,
        ({ nvenc: "NVIDIA NVENC", qsv: "Intel QSV", amf: "AMD AMF" } as Record<string, string>)[kind] ||
          kind.toUpperCase(),
      ]);
  });
  if (!encoderOptions.some(option => option[0] === r.encoder))
    encoderOptions.push([r.encoder, r.encoder.toUpperCase() + " (not detected; CPU fallback)"]);
  let detected = props.capabilities && (props.capabilities.encoders[r.codec] || []);
  let matches = sample && typeof sample === "object" ? sample.count : null;
  let scenes = typeof matches === "number" ? matches + (matches === 1 ? " scene" : " scenes") : "";
  let guess = matches && sample && typeof sample === "object" ? rules.estimate(r, sample) : null;
  let saving =
    guess && guess.saved > 0 ? "≈ " + bytes(guess.saved) + (r.action === "delete" ? " freed" : " saved") : "";
  let condition = r.condition || {};
  let hasFilter = condition.all || Object.keys(condition.scene || {}).length || (condition.find || {}).q;
  let quality = rules.quality(r),
    advanced = [
      r.codec === "hevc" ? "H.265" : "H.264",
      r.encoder === "auto" ? "auto encoder" : r.encoder.toUpperCase(),
      r.format === "keep" ? "keep format" : "format may change",
    ];
  return (
    <div className={"dirty-ui-row" + (props.open ? " is-open" : "") + (r.enabled ? "" : " is-off")}>
      <div className="dirty-ui-row-main">
        <ui.SettingsToggle
          checked={r.enabled}
          label={hidden("Enable " + r.name)}
          onChange={value => {
            change("enabled", value);
          }}
        />
        <button type="button" className="dirty-ui-row-summary" aria-expanded={props.open} onClick={props.onToggle}>
          <span className="dirty-ui-row-title">{props.index + 1 + ". " + r.name}</span>
          <span className="dirty-ui-row-detail">
            {hasFilter ? (
              filterSummary(condition, props.capture)
            ) : (
              <span className="dirty-compactor-warning">Choose scenes</span>
            )}
            {scenes && " (" + scenes + (saving ? " · " + saving : "") + ")"}
            {" → "}
            <span className={r.action === "delete" ? "dirty-compactor-danger" : undefined}>
              {rules.actionSummary(r)}
            </span>
          </span>
        </button>
        {r.mode === "automatic" && <ui.Badge title="Runs automatically after library scans">Auto</ui.Badge>}
        <ui.ActionMenu
          ariaLabel={"Actions for " + r.name}
          items={[
            { label: props.open ? "Close editor" : "Edit", onSelect: props.onToggle },
            {
              label: "Move up",
              disabled: props.index === 0,
              onSelect: () => {
                props.onMove(-1);
              },
            },
            {
              label: "Move down",
              disabled: props.last,
              onSelect: () => {
                props.onMove(1);
              },
            },
            { label: "Duplicate", onSelect: props.onDuplicate },
            { label: "Delete rule", tone: "danger", onSelect: props.onRemove },
          ]}
        />
      </div>
      {props.open && (
        <div className="dirty-ui-row-editor">
          <div className="dirty-compactor-grid">
            {field(r.id + "-name", "Name", r.name, v => {
              change("name", v);
            })}
            <div className="dirty-ui-field">
              <span className="dirty-compactor-label">Scenes</span>
              <div className="dirty-ui-control-row">
                <ui.Button
                  disabled={condition.all}
                  onClick={() => {
                    setOpenFilter(true);
                  }}
                >
                  {hasFilter && !condition.all ? "Edit filter" : "Choose filter"}
                </ui.Button>
                <ui.SettingsToggle
                  checked={condition.all}
                  label="All scenes"
                  onChange={value => {
                    change("condition", { all: value, scene: {}, find: {}, query: "" });
                  }}
                />
                {scenes && <span className="dirty-compactor-muted">{scenes}</span>}
              </div>
            </div>
          </div>
          <ui.SceneFilterEditor
            open={openFilter}
            value={r.condition}
            onClose={() => {
              setOpenFilter(false);
            }}
            onChange={v => {
              change("condition", v);
            }}
          />
          <div className="dirty-compactor-grid">
            {field(
              r.id + "-action",
              "Action",
              r.action,
              v => {
                let next = copy(r);
                next.action = v as Rule["action"];
                props.onChange(rules.fitQuality(next));
              },
              [
                ["resize", "Resize"],
                ["reencode", "Reencode (keep resolution)"],
                ["delete", "Delete scene and files"],
              ],
            )}
            {r.action === "resize" &&
              field(
                r.id + "-preset",
                "Maximum resolution",
                customSize ? "custom" : r.width + "x" + r.height,
                v => {
                  if (v === "custom") {
                    setCustomSize(true);
                    return;
                  }
                  setCustomSize(false);
                  let next = copy(r),
                    d = v.split("x");
                  next.width = Number(d[0]);
                  next.height = Number(d[1]);
                  props.onChange(next);
                },
                rules.RESOLUTIONS.concat([["custom", "Custom size"]]),
                "Never upscales. Aspect ratio is kept.",
              )}
            {r.action === "resize" &&
              customSize &&
              field(r.id + "-width", "Maximum width", r.width, v => {
                change("width", v);
              })}
            {r.action === "resize" &&
              customSize &&
              field(r.id + "-height", "Maximum height", r.height, v => {
                change("height", v);
              })}
            {r.action !== "delete" &&
              field(
                r.id + "-quality",
                "Quality",
                quality,
                v => {
                  let next = copy(r);
                  next.quality = v as Rule["quality"];
                  if (v === "visual" && !next.vmaf) next.vmaf = 95;
                  props.onChange(next);
                },
                rules.qualities(r.action),
                rules.qualityHint(r),
              )}
            {r.action !== "delete" &&
              quality === "visual" &&
              field(
                r.id + "-vmaf",
                "Look compared with the original",
                String(r.vmaf || 95),
                v => {
                  change("vmaf", Number(v));
                },
                rules.VMAF_TARGETS,
              )}
            {r.action !== "delete" &&
              quality === "custom" &&
              field(r.id + "-rate", "Video bitrate (Mbps)", r.mbps, v => {
                change("mbps", v);
              })}
          </div>
          {guess && (
            <p
              className="dirty-compactor-estimate"
              title="Estimated from the matching scenes' sizes, durations, and resolutions before planning. Earlier rules may take some of these scenes; Preview gives the exact numbers."
            >
              {r.quality === "source" ? (
                "Same bitrate means about the same size. For the same look in less space, choose Match visual quality."
              ) : (
                <>
                  <strong>{"≈ " + bytes(guess.saved)}</strong>
                  {(r.action === "delete" ? " freed of " : " saved of ") +
                    bytes(guess.total) +
                    (guess.total ? " (" + Math.round((100 * guess.saved) / guess.total) + "%)" : "") +
                    (guess.sourceMbps
                      ? " · video about " + guess.sourceMbps.toFixed(1) + " → " + guess.targetMbps.toFixed(1) + " Mbps"
                      : "") +
                    (guess.exact ? "" : " · estimated from " + guess.sampled + " sample scenes") +
                    (r.quality === "visual" ? " · measured per video during the run" : "")}
                </>
              )}
            </p>
          )}
          {r.action === "delete" && (
            <p className="dirty-compactor-danger">
              Deletes the scene, all its media files, and generated assets through Stash.
              {r.mode === "automatic" ? " Automatic runs will not ask again." : ""}
            </p>
          )}
          <ui.SettingsToggle
            checked={r.mode === "automatic"}
            label="Run automatically after library scans"
            onChange={value => {
              change("mode", value ? "automatic" : "manual");
            }}
          />
          {r.action !== "delete" && (
            <details className="dirty-compactor-advanced">
              <summary>{"Advanced · " + advanced.join(" · ")}</summary>
              <div className="dirty-compactor-grid">
                {field(
                  r.id + "-codec",
                  "Video codec",
                  r.codec,
                  v => {
                    change("codec", v as Rule["codec"]);
                  },
                  [
                    ["h264", "H.264 · plays everywhere"],
                    ["hevc", "H.265 · smaller files"],
                  ],
                )}
                {field(
                  r.id + "-encoder",
                  "Encoder",
                  r.encoder,
                  v => {
                    change("encoder", v);
                  },
                  encoderOptions,
                  detected
                    ? detected.length
                      ? "Detected: " + detected.join(", ").toUpperCase()
                      : "No encoder detected for this codec."
                    : "Auto tries NVIDIA, Intel, then AMD before CPU.",
                  <ui.Button compact busy={props.detecting} onClick={props.onDetect}>
                    Detect
                  </ui.Button>,
                )}
                {field(
                  r.id + "-format",
                  "Container",
                  r.format,
                  v => {
                    change("format", v as Rule["format"]);
                  },
                  [
                    ["keep", "Keep original format"],
                    ["allow", "Allow MP4 or MKV if needed"],
                  ],
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
