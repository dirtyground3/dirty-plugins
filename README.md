# Dirty Plugins

A collection of plugins for [Stash](https://stashapp.cc/).

## Plugins

| Plugin | Description | Version |
| --- | --- | --- |
| [DirtyFileExtractor](plugins/DirtyFileExtractor/) | Copy scene and image files or extract selected marker clips into a separate folder. | 0.3.3 |
| [DirtyMultiscreen](plugins/DirtyMultiscreen/) | Launch an immersive multiscreen grid for scenes and markers. | 0.3.5 |
| [DirtyTidy](plugins/DirtyTidy/) | Preview and apply metadata-based folder and filename organization. | 0.2.11 |

The plugins use the hidden [DirtyPlugins settings hub](plugins/DirtyPlugins/).
The hub is installed automatically from the package source and provides one
shared settings page without adding an item to Stash's navigation.
It also supplies the common GraphQL client, configuration helpers, notification
system, React primitives, and visual tokens used by both plugins.

## Install from Stash

Use this package-source URL in **Settings > Plugins > Available Plugins**:

```text
https://dirtyground3.github.io/dirty-plugins/main/index.yml
```

The URL must end in `index.yml`. The GitHub repository URL is a webpage and is not a valid Stash plugin source.

After adding the source, reload the available packages and install
**DirtyFileExtractor**, **DirtyMultiscreen**, or **DirtyTidy**. The required **DirtyPlugins**
settings hub is installed with it automatically.

## Manual installation

1. Download the folder for the plugin you want and the
   [`DirtyPlugins`](plugins/DirtyPlugins/) folder from [`plugins/`](plugins/).
2. Copy both entire folders into your Stash plugins directory:
   - Windows: `%USERPROFILE%\.stash\plugins`
   - Linux/macOS: `~/.stash/plugins`
3. In Stash, open **Settings > Plugins** and select **Reload Plugins**.
4. Expand the plugin under **Installed Plugins** and follow its settings link.

Keep each plugin's directory name and all files inside it unchanged.

## Repository layout

```text
plugins/
├── DirtyPlugins/
│   ├── LICENSE
│   ├── dirtyPlugins.yml
│   ├── dirtyPlugins.js
│   └── dirtyPlugins.css
├── DirtyFileExtractor/
│   ├── LICENSE
│   ├── extractScenes.yml
│   ├── extractScenes.js
│   ├── extractScenes.css
│   └── extract_scenes.py
├── DirtyMultiscreen/
│   ├── LICENSE
│   ├── multiscreen.yml
│   ├── multiscreen.js
│   └── multiscreen.css
└── DirtyTidy/
    ├── LICENSE
    ├── dirtyTidy.yml
    ├── dirtyTidy.js
    ├── dirtyTidy.css
    └── dirty_tidy.py
.github/workflows/deploy.yml
build_site.sh
```

## Publishing

Pushes to `main` that change a plugin, the package builder, or the deployment workflow automatically publish a GitHub Pages package source. The published layout is:

```text
main/
├── index.yml
├── dirtyPlugins.zip
├── extractScenes.zip
├── multiscreen.zip
└── dirtyTidy.zip
```

For the first deployment, configure **Settings > Pages > Build and deployment > Source** as **GitHub Actions**. The deployment can also be started manually from the repository's **Actions** tab.

To test the package build locally on a system with Bash and `zip` installed:

```bash
./build_site.sh _site/main
```

## License

This repository and its plugins are distributed under the [MIT License](LICENSE):

- [DirtyPlugins license](plugins/DirtyPlugins/LICENSE)
- [DirtyFileExtractor license](plugins/DirtyFileExtractor/LICENSE)
- [DirtyMultiscreen license](plugins/DirtyMultiscreen/LICENSE)
- [DirtyTidy license](plugins/DirtyTidy/LICENSE)
