import { DirtyPlugins, React } from "../runtime";
import type { Performer } from "../types";
import { icon } from "./Controls";

function PerformerNextButton({
  performer,
  screenIndex,
  busy,
  capture,
  onNext,
}: {
  performer: Performer;
  screenIndex: number;
  busy: boolean;
  capture: boolean;
  onNext(performerId: string): void;
}) {
  const [failedImage, setFailedImage] = React.useState<string | null>(null);
  const name = performer.name?.trim() || `Performer ${performer.id}`;
  const image = performer.image_path;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toLocaleUpperCase();
  return (
    <DirtyPlugins.react.Button
      className="ms-button ms-performer-next"
      ariaLabel={`Next scene featuring ${name} for screen ${screenIndex + 1}`}
      title={`Next scene featuring ${name} in this screen's session queue. Wraps at the end; other screens keep playing.`}
      disabled={busy}
      onClick={() => onNext(performer.id)}
    >
      {!capture && image && failedImage !== image ? (
        <img className="ms-performer-image" alt="" loading="lazy" src={image} onError={() => setFailedImage(image)} />
      ) : (
        <span className="ms-performer-placeholder" aria-hidden="true">
          {capture ? "◇" : initials}
        </span>
      )}
      <span className="ms-performer-next-mark" aria-hidden="true">
        <DirtyPlugins.react.Glyph icon={icon("next")} fallback="›" />
      </span>
    </DirtyPlugins.react.Button>
  );
}

export function PerformerNavigation({
  performers,
  screenIndex,
  busy,
  onNext,
}: {
  performers: Performer[];
  screenIndex: number;
  busy: boolean;
  onNext(performerId: string): void;
}) {
  const capture = DirtyPlugins.captureEnabled(window.location.search);
  if (!performers.length) return null;
  return (
    <div
      className="ms-performer-navigation"
      role="group"
      aria-label={`Next scenes by performer for screen ${screenIndex + 1}`}
    >
      {performers.map(performer => (
        <PerformerNextButton key={performer.id} {...{ performer, screenIndex, busy, capture, onNext }} />
      ))}
    </div>
  );
}
