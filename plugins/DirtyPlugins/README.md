# DirtyPlugins

DirtyPlugins provides the shared runtime and unlisted settings page used by
plugins in this repository. It is installed automatically as a dependency
when a Dirty plugin is installed from the package source.

The shared runtime includes the GraphQL client, plugin-configuration helpers,
value coercion, stacked notifications, reusable React settings-card, section,
toggle, icon, and state components, custom settings-panel registration, and
the visual tokens used by the Dirty plugins.

The page has no navigation entry. Open it using the link shown in the normal
Stash settings panel for a managed Dirty plugin. Each installed plugin has its
own inner tab, and the link opens that plugin's tab directly.
On Stash's main Plugins page, the Dirty plugin setting cards are kept together
in a stable shared-hub-first order without changing other plugins' order.
Unsaved settings are visibly marked and protected by confirmation when the
page is closed, refreshed, or left through an in-app link. Custom panels use
the same dirty-state contract as the standard settings forms.
The direct URL is `/plugins/dirty-plugins`; it remains unlisted in Stash's
navigation.

For a manual installation, copy this directory alongside the other Dirty
plugin directories and reload plugins in Stash.

## License

DirtyPlugins is distributed under the [MIT License](LICENSE).
