import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8")


class SharedUIContractTests(unittest.TestCase):
    def test_plugins_load_the_shared_hub_first(self):
        for manifest in (
            "plugins/DirtyFileExtractor/extractScenes.yml",
            "plugins/DirtyMultiscreen/multiscreen.yml",
            "plugins/DirtyRank/dirtyRank.yml",
            "plugins/DirtyTidy/dirtyTidy.yml",
        ):
            contents = read(manifest)
            self.assertIn("requires:", contents)
            self.assertIn("- dirtyPlugins", contents)

    def test_plugin_scripts_use_the_shared_graphql_client(self):
        extractor = read("plugins/DirtyFileExtractor/extractScenes.js")
        multiscreen = read("plugins/DirtyMultiscreen/multiscreen.js")

        self.assertNotIn('fetch("/graphql"', extractor)
        self.assertNotIn('fetch("/graphql"', multiscreen)
        self.assertIn("hubApi.graphql", extractor)
        self.assertIn("DirtyPlugins.graphql", multiscreen)

    def test_plugins_use_shared_visual_primitives(self):
        extractor_js = read("plugins/DirtyFileExtractor/extractScenes.js")
        extractor_css = read("plugins/DirtyFileExtractor/extractScenes.css")
        multiscreen_js = read("plugins/DirtyMultiscreen/multiscreen.js")
        multiscreen_css = read("plugins/DirtyMultiscreen/multiscreen.css")

        self.assertIn("dirty-ui-backdrop", extractor_js)
        self.assertIn("var(--dirty-ui-shadow)", extractor_css)
        self.assertIn("DirtyPlugins.react.IconButton", multiscreen_js)
        self.assertIn("DirtyPlugins.react.StateView", multiscreen_js)
        self.assertIn("var(--dirty-ui-radius-small)", multiscreen_css)

    def test_documentation_capture_modes_hide_private_paths_and_media(self):
        hub_js = read("plugins/DirtyPlugins/dirtyPlugins.js")
        hub_css = read("plugins/DirtyPlugins/dirtyPlugins.css")
        multiscreen_js = read("plugins/DirtyMultiscreen/multiscreen.js")
        multiscreen_css = read("plugins/DirtyMultiscreen/multiscreen.css")
        rank_css = read("plugins/DirtyRank/dirtyRank.css")

        self.assertIn('get("docsCapture") === "1"', hub_js)
        self.assertIn("dirty-plugins-docs-capture", hub_css)
        self.assertIn("#dirty-plugins-panel-extractScenes", hub_css)
        self.assertIn('get("docsCapture") === "1"', multiscreen_js)
        self.assertIn(".ms-docs-capture .ms-native-tile .VideoPlayer", multiscreen_css)
        self.assertIn(".dirty-rank-censored-media .dirty-rank-podium-image", rank_css)
        self.assertIn(".dirty-rank-censored-media .dirty-rank-table-performer img", rank_css)

    def test_hub_exposes_the_common_runtime_contract(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        for export in (
            "hubApi.graphql",
            "hubApi.runPluginOperation",
            "hubApi.getPluginSettings",
            "hubApi.configurePlugin",
            "hubApi.values",
            "hubApi.ui",
            "hubApi.react",
            "hubApi.registerSettingsPanel",
        ):
            self.assertIn(export, hub)
        for component in ("SettingsCard", "SettingsSection", "SettingsToggle"):
            self.assertIn(component + ": " + component, hub)

    def test_settings_panels_share_the_same_building_blocks(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        tidy_js = read("plugins/DirtyTidy/dirtyTidy.js")
        tidy_css = read("plugins/DirtyTidy/dirtyTidy.css")

        self.assertIn("SettingsCard,", hub)
        self.assertIn("DirtyPlugins.react.SettingsCard", tidy_js)
        self.assertIn("DirtyPlugins.react.SettingsSection", tidy_js)
        self.assertIn("DirtyPlugins.react.SettingsToggle", tidy_js)
        self.assertNotIn("dirty-tidy-header", tidy_js + tidy_css)
        self.assertNotIn("dirty-tidy-section", tidy_js + tidy_css)
        self.assertNotIn("dirty-tidy-toggle", tidy_js + tidy_css)

    def test_hub_owns_shared_setting_order(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        multiscreen = read("plugins/DirtyMultiscreen/multiscreen.js")

        self.assertIn("var PLUGIN_SETTING_ORDER", hub)
        self.assertNotIn('PluginApi.patch.before("PluginSettings"', multiscreen)

    def test_hub_uses_one_inner_tab_per_installed_plugin(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")

        self.assertIn('role: "tablist"', hub)
        self.assertIn('role: "tab"', hub)
        self.assertIn('role: "tabpanel"', hub)
        self.assertIn("activePlugin && createElement", hub)
        self.assertIn("settingsRoute(props.pluginId)", hub)

    def test_hub_settings_patch_preserves_unmanaged_plugins(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")

        self.assertIn("var next = args.pop()", hub)
        self.assertIn("return next.apply(null, args)", hub)

    def test_main_plugins_page_groups_dirty_plugins(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")

        self.assertIn(
            'var MAIN_PAGE_PLUGIN_IDS = ["dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy", "dirtyRank"]',
            hub,
        )
        self.assertIn('"data-dirty-plugin-id": props.pluginId', hub)
        self.assertIn("orderMainPluginSettingsGroups", hub)
        self.assertIn("document.createComment", hub)
        self.assertIn("MAIN_PAGE_PLUGIN_ID_SET.has(pluginId)", hub)

    def test_settings_page_protects_unsaved_changes(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")

        self.assertIn("standardDraftsAreDirty", hub)
        self.assertIn('window.addEventListener("beforeunload", beforeUnload)', hub)
        self.assertIn('document.addEventListener("click", confirmLinkNavigation, true)', hub)
        self.assertIn("UNSAVED_SETTINGS_MESSAGE", hub)
        self.assertIn("onDirtyChange: reportCustomDirty", hub)
        self.assertIn("savedSettingsState", tidy)
        self.assertIn("props.onDirtyChange(PLUGIN_ID, settingsDirty)", tidy)
        self.assertGreaterEqual(tidy.count("setSavedSettings(draft)"), 1)

    def test_shared_settings_link_is_centered(self):
        css = read("plugins/DirtyPlugins/dirtyPlugins.css")

        self.assertIn(".dirty-plugins-settings-link", css)
        self.assertIn("margin: 0.75rem auto", css)
        self.assertIn("width: fit-content", css)

    def test_hub_uses_stash_direct_navigation_route_namespace(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")

        self.assertIn('var ROUTE_PATH = "/plugins/dirty-plugins"', hub)
        self.assertNotIn('var ROUTE_PATH = "/plugin/dirty-plugins"', hub)

    def test_dirty_tidy_registers_a_custom_shared_settings_panel(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")

        self.assertIn('"dirtyTidy"', hub)
        self.assertIn("registerSettingsPanel(PLUGIN_ID, DirtyTidySettings)", tidy)
        self.assertIn("DirtyPlugins.configurePlugin", tidy)
        self.assertIn("runPluginOperation", tidy)
        self.assertIn("runPluginTask", tidy)
        self.assertIn("includeAll: true", tidy)
        self.assertIn("filteredOperations.slice", tidy)
        self.assertNotIn("Loading filtered preview", tidy)

    def test_dirty_rank_uses_the_shared_runtime_and_custom_panel(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        script = read("plugins/DirtyRank/dirtyRank.js")
        manifest = read("plugins/DirtyRank/dirtyRank.yml")

        self.assertIn('"dirtyRank"', hub)
        self.assertIn("- dirtyPlugins", manifest)
        self.assertIn("DirtyPlugins.graphql", script)
        self.assertIn("DirtyPlugins.react.SettingsCard", script)
        self.assertIn("registerSettingsPanel(PLUGIN_ID, DirtyRankSettings)", script)
        self.assertIn("PluginApi.register.route(ROUTE_PATH, DirtyRankRoute)", script)
        self.assertIn('to: "/plugins/dirty-plugins?plugin=dirtyRank"', script)

    def test_dirty_plugins_settings_are_database_backed(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        backend = read("plugins/DirtyPlugins/dirty_plugins.py")
        storage = read("plugins/DirtyPlugins/dirty_plugins_storage.py")

        self.assertIn('runPluginOperation(plugin_id:$pluginId,args:$args)', hub)
        self.assertIn('mode: "getSettings"', hub)
        self.assertIn('mode: "setSettings"', hub)
        self.assertNotIn('configurePlugin(plugin_id:$pluginId,input:$input)', hub)
        self.assertIn("dirty_plugin_settings", storage)
        self.assertIn('mode == "getAllSettings"', backend)

    def test_dirty_rank_separates_tie_from_skip_and_preserves_native_rating(self):
        script = read("plugins/DirtyRank/dirtyRank.js")
        backend = read("plugins/DirtyRank/dirty_rank.py")

        self.assertIn('submit("draw")', script)
        self.assertIn("function skip()", script)
        self.assertNotIn('outcome: "skip"', script)
        self.assertIn("CREATE TABLE IF NOT EXISTS dirty_rank_pools", backend)
        self.assertNotIn('STATE_FIELD = "dirty_rank_state"', backend)
        self.assertNotIn("rating100:", backend)

    def test_dirty_rank_settings_are_editable_weighted_and_cohort_scoped(self):
        script = read("plugins/DirtyRank/dirtyRank.js")
        backend = read("plugins/DirtyRank/dirty_rank.py")
        battle_ui = script.split("function DirtyRankSettings", 1)[0]
        settings_ui = script.split("function DirtyRankSettings", 1)[1]

        self.assertIn("DirtyPlugins.getPluginSettings(PLUGIN_ID)", script)
        self.assertIn("function addCategory()", script)
        self.assertIn("categoriesByCohort", script)
        self.assertIn("function overallPoolFor", script)
        self.assertIn('label: "Overall weight"', script)
        self.assertIn('label: "Evidence per battle"', script)
        self.assertIn("evidenceWeight: 2", script)
        self.assertIn('"evidenceWeight": 2.0', backend)
        self.assertIn('"Advanced configuration"', script)
        self.assertNotIn("Eligibility tag IDs", script)
        self.assertNotIn("ratingPeriodDays", script)
        self.assertNotIn("ratingPeriodDays", backend)
        self.assertNotIn("inflate_deviation", backend)
        self.assertNotIn("Performer pool", battle_ui)
        self.assertNotIn("Export ratings", battle_ui)
        self.assertIn('title: "Options"', settings_ui)
        self.assertIn('"Export ratings"', settings_ui)

    def test_standard_and_dirty_rank_settings_save_automatically(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        rank = read("plugins/DirtyRank/dirtyRank.js")
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")

        self.assertIn("Saving automatically…", hub)
        self.assertIn("Saved automatically.", hub)
        self.assertIn("saveChainsRef", hub)
        self.assertNotIn('saving ? "Saving…" : "Save"', hub)
        self.assertIn("Waiting to save automatically…", rank)
        self.assertIn("Saving automatically…", rank)
        self.assertNotIn('Save settings")', rank)
        self.assertIn('}, "Confirm and save")', tidy)

    def test_dirty_rank_advances_before_background_vote_persistence(self):
        script = read("plugins/DirtyRank/dirtyRank.js")
        backend = read("plugins/DirtyRank/dirty_rank.py")
        submit = script.split("function submit(outcome)", 1)[1].split("function skip()", 1)[0]

        self.assertIn("voteQueueRef.current", submit)
        self.assertIn("pendingVotesRef.current += 1", submit)
        self.assertLess(
            submit.index("showPreparedOrPickNext()"),
            submit.index("voteQueueRef.current"),
        )
        self.assertNotIn("setTimeout", submit)
        self.assertIn('pendingVotes + " queued operation"', script)
        self.assertNotIn("performerUpdate", backend)
        self.assertIn('connection.execute("BEGIN IMMEDIATE")', backend)

    def test_dirty_rank_shows_decision_colors_and_category_confidence(self):
        script = read("plugins/DirtyRank/dirtyRank.js")
        stylesheet = read("plugins/DirtyRank/dirtyRank.css")

        self.assertIn("function DecisionIndicator", script)
        self.assertIn('outcome === "left" ? "winner" : "loser"', script)
        self.assertIn("dirty-rank-decision-winner", stylesheet)
        self.assertIn("dirty-rank-decision-loser", stylesheet)
        self.assertIn("function categoryConfidence", script)
        self.assertIn("estimatedMatchesToConfidence", script)
        self.assertIn("function representativeOpponent", script)
        self.assertIn("nextOpponentDeviation", script)
        self.assertIn('" battles estimated"', script)
        self.assertIn("battlePurpose", script)
        self.assertIn("settings.provisionalDeviation", script)

    def test_dirty_rank_can_play_each_performers_top_rated_scene(self):
        script = read("plugins/DirtyRank/dirtyRank.js")
        stylesheet = read("plugins/DirtyRank/dirtyRank.css")
        playback_url = script.split("function scenePlaybackUrl", 1)[1].split(
            "function parseState", 1
        )[0]

        self.assertIn("function loadPreferredMedia", script)
        self.assertIn('sort: "rating", direction: "DESC"', script)
        self.assertIn('modifier: "INCLUDES"', script)
        self.assertIn("findSceneMarkers", script)
        self.assertIn("markerEndSeconds", script)
        self.assertIn("startMarkerPlayback", script)
        self.assertIn('"Close marker"', script)
        self.assertIn('"▶ Play top scene"', script)
        self.assertIn('h("video"', script)
        self.assertIn("event.stopPropagation()", script)
        self.assertIn("dirty-rank-scene-player", stylesheet)
        self.assertLess(
            playback_url.index("directPath"),
            playback_url.index("/720p/i"),
        )

    def test_dirty_rank_adds_global_overall_elo_sort_to_performers(self):
        script = read("plugins/DirtyRank/dirtyRank.js")

        self.assertIn('OVERALL_SORT_VALUE = "dirty_rank_overall"', script)
        self.assertIn('OVERALL_SORT_LABEL = "Overall Elo"', script)
        self.assertIn('PluginApi.patch.before("FilteredPerformerList"', script)
        self.assertIn('PluginApi.patch.after("FilteredPerformerList"', script)
        self.assertIn('PluginApi.patch.instead("PerformerList"', script)
        self.assertIn("function sortPerformersByOverall", script)
        self.assertIn('var cohort = String(performer.gender || "").toUpperCase()', script)
        self.assertIn("if (left.rated !== right.rated) return left.rated ? -1 : 1", script)
        self.assertIn("queryFilter.itemsPerPage = -1", script)
        self.assertIn("queryFilter[OVERALL_SORT_ACTIVE] = true", script)
        self.assertIn("filter.currentPage", script)
        self.assertIn("filter.itemsPerPage", script)

    def test_dirty_tidy_supports_approved_scan_and_generate_automation(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")
        backend = read("plugins/DirtyTidy/dirty_tidy.py")

        self.assertIn('value: "scan"', tidy)
        self.assertIn('value: "generate"', tidy)
        self.assertNotIn('disabled: true, value: "manual"', tidy)
        self.assertIn("useJobsSubscribeSubscription", tidy)
        self.assertIn('job.status !== "FINISHED"', tidy)
        self.assertIn("approveAutomation", tidy)
        self.assertIn('if mode == "automation":', backend)
        self.assertIn('settings["approvedStrategyHash"]', backend)

    def test_dirty_tidy_preview_links_blocked_scenes(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")

        self.assertIn("function PreviewNotes", tidy)
        self.assertIn("operation.blocked_scenes", tidy)
        self.assertIn('href: "/scenes/" + encodeURIComponent(scene.id)', tidy)
        self.assertIn('["female_performers", "Female performers"]', tidy)
        self.assertIn('["male_performers", "Male performers"]', tidy)

    def test_dirty_tidy_preview_does_not_save_the_draft(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")
        preview_function = tidy.split("function generatePreview()", 1)[1].split(
            "function changePreviewFilter", 1
        )[0]

        self.assertIn("runPreview(draft)", preview_function)
        self.assertNotIn("configurePlugin", preview_function)
        self.assertNotIn("setSavedSettings", preview_function)
        self.assertIn('Working…" : "Preview"', tidy)
        self.assertIn("!previewReady || settingsDirty", tidy)

    def test_dirty_tidy_has_independent_stash_id_safeguards(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")
        backend = read("plugins/DirtyTidy/dirty_tidy.py")

        self.assertIn("moveRequireStashId", tidy)
        self.assertIn("renameRequireStashId", tidy)
        self.assertIn("Only move files for scenes with a Stash ID", tidy)
        self.assertIn("Only rename files for scenes with a Stash ID", tidy)
        self.assertIn('stash_ids { stash_id }', backend)
        self.assertIn("def scene_has_stash_id", backend)

    def test_dirty_tidy_confirms_and_saves_with_a_button(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")

        self.assertIn("function confirmAndSavePreview", tidy)
        self.assertIn('}, "Confirm and save")', tidy)
        self.assertIn("setConfirmed(true)", tidy)
        self.assertIn("DirtyPlugins.configurePlugin(PLUGIN_ID, draft)", tidy)
        self.assertNotIn("I reviewed this preview", tidy)

    def test_automation_mode_change_can_be_confirmed_and_saved_again(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")
        changed_function = tidy.split("function changed(update, affectsStrategy)", 1)[1].split(
            "function updateLevel", 1
        )[0]

        self.assertIn(
            'setConfirmed(false);\n      if (affectsStrategy !== false) {\n        setPreview(null)',
            changed_function,
        )
        self.assertIn(
            'changed({ automationMode: event.target.value }, false)',
            tidy,
        )

    def test_dirty_tidy_exposes_the_grade_variable(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")
        backend = read("plugins/DirtyTidy/dirty_tidy.py")

        self.assertIn('["grade", "Grade (A–F)"]', tidy)
        self.assertIn('"grade": _grade(rating)', backend)

    def test_dirty_tidy_exposes_the_stash_id_variable(self):
        tidy = read("plugins/DirtyTidy/dirtyTidy.js")
        backend = read("plugins/DirtyTidy/dirty_tidy.py")

        self.assertIn('["stash_id", "Stash ID"]', tidy)
        self.assertIn('"stash_id": stash_ids[0] if stash_ids else UNKNOWN_VALUE', backend)


if __name__ == "__main__":
    unittest.main()
