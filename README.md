# Dirty Plugins

A collection of plugins for [Stash](https://stashapp.cc/).

## Plugins

| Plugin | Description | Version |
| --- | --- | --- |
| [Extract Scenes](plugins/extractScenes/) | Copy the media files attached to selected scenes into a separate folder. | 0.1.5 |
| [Multiscreen](plugins/multiscreen/) | Launch an immersive multiscreen grid for scenes and markers. | 0.3.0 |

## Installation

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
│   ├── extractScenes.yml
│   ├── extractScenes.js
│   ├── extractScenes.css
│   └── extract_scenes.py
└── multiscreen/
    ├── multiscreen.yml
    ├── multiscreen.js
    └── multiscreen.css
```

## License

Licensing is documented per plugin. Extract Scenes is distributed under the MIT License. Multiscreen does not currently include an explicit license.
