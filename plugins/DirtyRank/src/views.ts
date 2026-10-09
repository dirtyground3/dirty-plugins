import { createBattleSession } from "./battleSession";
import { createBattles } from "./components/Battles";
import { createLeaderboards } from "./components/Leaderboards";
import { createNative } from "./components/Native";
import { createPerformerCard } from "./components/PerformerCard";
import { createPreview } from "./components/Preview";
import { createPrimitives } from "./components/Primitives";
import { LEADERBOARD_TOP_OPTIONS, PLUGIN_ID, UNDO_HISTORY_LIMIT } from "./constants";
import { createRankDomain } from "./domain/rank";
import type { UIRuntime } from "./host";
import { createSettingsPanel } from "./settingsPanel";
export function createViews(runtime: UIRuntime) {
  const domain = createRankDomain(runtime), { React, PluginApi, DirtyPlugins } = runtime;
  const Router = PluginApi.libraries.ReactRouterDOM, shared = DirtyPlugins.react;
  function documentationCapture() { return DirtyPlugins.captureEnabled ? DirtyPlugins.captureEnabled(window.location.search) : new URLSearchParams(window.location.search).get("docsCapture") === "1" || new URLSearchParams(window.location.search).get("censorMedia") === "1"; }
  const base = {
    ...runtime, ...domain, ...React, useEffect: runtime.useEffect || React.useEffect, Fragment: React.Fragment, Router,
    NavLink: Router.NavLink, Prompt: Router.Prompt, useIntl: PluginApi.libraries.Intl.useIntl, documentationCapture,
    SettingsCard: shared.SettingsCard, Section: shared.SettingsSection, Toggle: shared.SettingsToggle,
    StateView: shared.StateView, SharedButton: shared.Button, SharedBadge: shared.Badge, SharedField: shared.Field,
    SharedIconButton: shared.IconButton, SharedMetric: shared.Metric, SharedNavAction: shared.NavAction,
    SharedPagination: shared.Pagination, SharedSaveStatus: shared.SaveStatus, SharedStatisticSelector: shared.StatisticSelector,
    SharedDialog: shared.Dialog
  };
  const primitives = createPrimitives(base), preview = createPreview(base);
  const cards = createPerformerCard({ ...base, ...primitives, ...preview });
  const leaderboards = createLeaderboards({ ...base, ...primitives, ...cards });
  const useBattleSession = createBattleSession({ ...base, PLUGIN_ID, UNDO_HISTORY_LIMIT });
  const battles = createBattles({ ...base, ...primitives, ...cards, useBattleSession });
  const native = createNative({ ...base, ...primitives, ...leaderboards });
  const DirtyRankSettings = createSettingsPanel({ ...base, ...primitives, PLUGIN_ID, LEADERBOARD_TOP_OPTIONS });
  return {
    ...domain, ...primitives, ...preview, ...cards, ...leaderboards, ...battles, ...native,
    DirtyRankSettings, documentationCapture
  };
}
