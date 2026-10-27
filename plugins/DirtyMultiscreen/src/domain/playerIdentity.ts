import type { Player } from "../types";

interface NativeIdentity extends Player {
  id(): string;
  id_: string;
  options_: { id?: string };
  el(): Element & { playerId?: string };
  tech_?: {
    id_: string;
    options_: { playerId?: string; techId?: string };
    el(): Element & { playerId?: string };
  };
}

/** Stash gives every ScenePlayer the same ID; streaming techs look it up globally. */
export function isolateNativePlayer(player: Player, id: string) {
  const native = player as NativeIdentity;
  const players = (native.constructor as { players?: Record<string, Player | null> }).players;
  if (!players || !native.id || !native.el || native.id() === id) return;
  const previous = native.id();
  native.id_ = id;
  native.options_.id = id;
  native.el().id = id;
  native.el().playerId = id;
  players[id] = native;
  if (players[previous] === native) delete players[previous];
  const tech = native.tech_;
  if (tech) {
    const techId = tech.id_.startsWith(previous) ? id + tech.id_.slice(previous.length) : `${id}_tech`;
    tech.id_ = techId;
    tech.options_.playerId = id;
    tech.options_.techId = techId;
    tech.el().id = techId;
    tech.el().playerId = id;
  }
}
