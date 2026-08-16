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

    def test_hub_exposes_the_common_runtime_contract(self):
        hub = read("plugins/DirtyPlugins/dirtyPlugins.js")
        for export in (
            "hubApi.graphql",
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
            'var MAIN_PAGE_PLUGIN_IDS = ["dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy"]',
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
        self.assertGreaterEqual(tidy.count("setSavedSettings(draft)"), 2)

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


if __name__ == "__main__":
    unittest.main()
