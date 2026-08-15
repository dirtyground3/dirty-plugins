# Dirty Plugins

A collection of plugins for [Stash](https://stashapp.cc/).

## Plugins

| Plugin | Description | Version |
| --- | --- | --- |
| [DirtyFileExtractor](plugins/extractScenes/) | Copy the media files attached to selected scenes into a separate folder. | 0.2.2 |
| [DirtyMultiscreen](plugins/multiscreen/) | Launch an immersive multiscreen grid for scenes and markers. | 0.3.2 |

## Install from Stash

Use this package-source URL in **Settings > Plugins > Available Plugins**:

```text
https://dirtyground3.github.io/dirty-plugins/main/index.yml
```

The URL must end in `index.yml`. The GitHub repository URL is a webpage and is not a valid Stash plugin source.

After adding the source, reload the available packages and install
**DirtyFileExtractor** or **DirtyMultiscreen**.

## Manual installation

1. Download the folder for the plugin you want from [`plugins/`](plugins/).
2. Copy the entire folder into your Stash plugins directory:
   - Windows: `%USERPROFILE%\.stash\plugins`
   - Linux/macOS: `~/.stash/plugins`
3. In Stash, open **Settings > Plugins** and select **Reload Plugins**.
4. Configure the plugin under **Installed Plugins**.

Keep each plugin's directory name and all files inside it unchanged.

## Repository layout

```text
plugins/
├── extractScenes/
│   ├── LICENSE
│   ├── extractScenes.yml
│   ├── extractScenes.js
│   ├── extractScenes.css
│   └── extract_scenes.py
└── multiscreen/
    ├── LICENSE
    ├── multiscreen.yml
    ├── multiscreen.js
    └── multiscreen.css
.github/workflows/deploy.yml
build_site.sh
```

## Publishing

Pushes to `main` that change a plugin, the package builder, or the deployment workflow automatically publish a GitHub Pages package source. The published layout is:

```text
main/
├── index.yml
├── extractScenes.zip
└── multiscreen.zip
```

For the first deployment, configure **Settings > Pages > Build and deployment > Source** as **GitHub Actions**. The deployment can also be started manually from the repository's **Actions** tab.

To test the package build locally on a system with Bash and `zip` installed:

```bash
./build_site.sh _site/main
```

## License

This repository and both plugins are distributed under the [MIT License](LICENSE):

- [DirtyFileExtractor license](plugins/extractScenes/LICENSE)
- [DirtyMultiscreen license](plugins/multiscreen/LICENSE)
