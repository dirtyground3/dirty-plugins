# DirtyPlugins

DirtyPlugins provides the shared runtime and unlisted settings page used by
plugins in this repository. It is installed automatically as a dependency
when a Dirty plugin is installed from the package source.

The shared runtime includes the GraphQL client, plugin-configuration helpers,
value coercion, stacked notifications, reusable React settings-card, section,
toggle, icon, and state components, custom settings-panel registration, and
the visual tokens used by the Dirty plugins.

DirtyPlugins also owns `dirty_plugins.sqlite3`, the shared WAL-enabled database
for high-frequency plugin data that should not trigger Stash entity-update
hooks. Runtime database and WAL files are excluded from plugin packages and
remain in the installed DirtyPlugins directory across ordinary updates.

The database is also the authoritative settings store for DirtyFileExtractor,
DirtyMultiscreen, DirtyTidy, and DirtyRank. The Stash manifests retain setting
definitions so the shared hub can render typed controls, but Stash's plugin
configuration values are not read or written by Dirty plugins.

Managed plugins currently include DirtyFileExtractor, DirtyMultiscreen,
DirtyTidy, and DirtyRank. DirtyRank uses a custom hub panel for its categories,
performer cohort, Glicko-2 parameters, and guarded data tools.

The page has no navigation entry. Open it using the link shown in the normal
Stash settings panel for a managed Dirty plugin. Each installed plugin has its
own inner tab, and the link opens that plugin's tab directly.
On Stash's main Plugins page, the Dirty plugin setting cards are kept together
in a stable shared-hub-first order without changing other plugins' order.
Standard settings and DirtyRank's custom settings save automatically shortly
after a control changes. Pending or invalid values remain visibly marked and
are protected by confirmation when the page is closed, refreshed, or left
through an in-app link. DirtyTidy deliberately keeps its explicit preview and
confirmation workflow because its strategy can move and rename files.
The direct URL is `/plugins/dirty-plugins`; it remains unlisted in Stash's
navigation.

## Screenshot

![Dirty Plugins shared settings hub showing DirtyRank configuration](../../docs/images/dirty-rank-settings.png)

The hub gives every installed Dirty plugin its own tab and consistent settings
layout. This capture shows DirtyRank's custom panel inside the shared page.

For a manual installation, copy this directory alongside the other Dirty
plugin directories and reload plugins in Stash.

## License

DirtyPlugins is distributed under the [MIT License](LICENSE).
