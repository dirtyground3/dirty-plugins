import { React, ui } from "../runtime";
import { bytes } from "../domain/rules";
import type { WorkflowRecord, Act, MediaInfo } from "../types";
export interface OutputReviewProps {
  run: WorkflowRecord;
  act: Act;
  capture: boolean;
  settingsPending: boolean;
  onLater(): void;
}
export function OutputReview(props: OutputReviewProps) {
  const { useState, useRef, useEffect } = React;
  let review = props.run.review!,
    player = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(false);
    setFailed(false);
  }, [review.operationId]);
  function release() {
    if (player.current) {
      player.current.pause();
      player.current.removeAttribute("src");
      player.current.load();
    }
  }
  useEffect(() => release, []);
  function decide(mode: "acceptOutput" | "discardOutput") {
    release();
    setBusy(true);
    props.act(mode, { id: props.run.id, operationId: review.operationId }).finally(() => {
      setBusy(false);
    });
  }
  let saved = review.originalSize - review.outputSize;
  let card = { name: "Check this encoded file", description: "The original is untouched until you accept." };
  function media(item: MediaInfo, size: number) {
    return (
      item.width +
      " × " +
      item.height +
      " · " +
      item.codec +
      " · " +
      (item.bitrate / 1e6).toFixed(2) +
      " Mbps · " +
      bytes(size)
    );
  }
  return (
    <ui.SettingsCard className="dirty-compactor-review" plugin={card}>
      <h3>{props.capture ? "Scene hidden" : review.title}</h3>
      {props.capture ? (
        <div className="dirty-compactor-media-placeholder">Media hidden for documentation</div>
      ) : (
        !busy && (
          <video
            ref={player}
            src={review.url}
            controls
            preload="metadata"
            playsInline
            onError={() => {
              setFailed(true);
            }}
            aria-label="Encoded output preview"
          />
        )
      )}
      {failed && (
        <ui.StateView
          title="This browser cannot play the output"
          detail="Download it to check it in another player. The preview is never transcoded."
        />
      )}
      <div className="dirty-compactor-metrics">
        <ui.Metric
          label="Saves"
          value={bytes(saved)}
          detail={((100 * saved) / review.originalSize).toFixed(1) + "% smaller"}
        />
        <ui.Metric
          label="Original"
          value={bytes(review.originalSize)}
          detail={media(review.original, review.originalSize)}
        />
        <ui.Metric label="Output" value={bytes(review.outputSize)} detail={media(review.output, review.outputSize)} />
      </div>
      <details className="dirty-compactor-advanced">
        <summary>Details</summary>
        <p>
          {"Encoder: " +
            review.encoder +
            (review.fallback ? " · CPU fallback" : "") +
            (review.crf != null ? " · CRF " + review.crf : "") +
            (review.vmaf ? " · VMAF " + review.vmaf + " on sample clips" : "")}
        </p>
        <p className="dirty-compactor-path">{props.capture ? "Destination hidden" : review.destination}</p>
      </details>
      {review.reason && <ui.StateView title="Output requires attention" detail={review.reason} />}
      <div className="dirty-ui-control-row">
        <ui.Button
          tone="primary"
          disabled={busy || props.settingsPending}
          onClick={() => {
            decide("acceptOutput");
          }}
        >
          Accept and replace
        </ui.Button>
        <ui.Button
          disabled={busy}
          onClick={() => {
            decide("discardOutput");
          }}
        >
          Discard
        </ui.Button>
        <span className="dirty-ui-spacer" />
        <ui.ActionMenu
          ariaLabel="More review actions"
          items={[
            {
              label: "Review later",
              disabled: busy,
              onSelect: () => {
                release();
                props.onLater();
              },
            },
            !props.capture && { label: "Download output", href: review.url, download: true },
          ]}
        />
      </div>
    </ui.SettingsCard>
  );
}
