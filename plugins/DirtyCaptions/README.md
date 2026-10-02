# DirtyCaptions

Display embedded text subtitles in Stash's native scene player without creating
separate subtitle files or re-encoding the video. Requires Stash 0.25 or newer,
Python 3.9+, FFmpeg/ffprobe, and **DirtyPlugins 0.5.4 or newer** on the Stash
server. Playback and seeking have been verified with Stash 0.31.1 and embedded
MP4 `mov_text` captions.

## Quick start

1. Install DirtyCaptions and update its DirtyPlugins dependency.
2. Reload Stash plugins, then hard-refresh the Stash tab (**Ctrl+F5**).
3. Open a scene with embedded text subtitles. Wait for **Loading embedded
   captions…** to finish; the first extraction can take a few seconds or longer.
4. Open the player's **CC** menu. An entry such as **English (embedded, track
   3)** identifies an embedded track. Select another language or **captions
   off** there.

Automatic display is enabled initially. To change it, open **Settings →
Plugins**, expand **DirtyCaptions**, and follow **Open Dirty Plugins settings**.
The **DirtyCaptions** tab also lets you choose a preferred language. Its direct
route on your Stash server is `/plugins/dirty-plugins?plugin=dirtyCaptions`.

## Playback

Open a scene as usual. DirtyCaptions reads its embedded subtitle tracks on the
Stash server, converts them to WebVTT through an in-memory pipe, and adds them
to the player's **CC** menu. Tracks are labelled with language, title, stream
number, and **embedded**. A track's title and forced flag are included when
present. Existing external captions remain available, and a caption track
already showing is kept selected.

When automatic display is enabled, selection follows this order:

1. The configured preferred language, or the browser language if blank.
2. The file's default subtitle track.
3. A forced subtitle track.
4. The first available text track.

Common three-letter codes such as `eng` and `fra` are matched to `en` and `fr`.
Turn captions off or change language in the native CC menu. The current
selection, including **captions off**, is retained when the player reloads its
stream. Seeking, playback speed, and standard
player fullscreen use Stash's existing caption handling, including timestamp
adjustments for transcoded streams. Native scene players in DirtyMultiscreen
and DirtyRank are also covered; plain HTML preview videos are not.

The first load can take time because FFmpeg must read through the container.
Concurrent players opening the same scene share an in-flight request. Subtitle
text and browser data URLs are released when the player changes scenes or
unmounts. Reopening a scene performs a new extraction; there is no persistent
caption cache. No subtitle text is persisted in SQLite, no sidecars are written,
and no rescan is needed. Only plugin settings are stored in the shared database.

Limits are 16 text tracks, 8 MiB of converted text, and a 120-second extraction
budget per scene, with probing limited to 30 seconds. Failed tracks do not hide
successful ones. Extraction or loading failures show a **Retry captions**
action; unsupported formats and fixed limits are reported as warnings.

## Settings

Open **Dirty Plugins settings → DirtyCaptions**. Settings autosave through the
shared hub:

| Setting | Default | Effect |
| --- | --- | --- |
| **Load embedded captions** | On | Detect and extract embedded text tracks when a native scene player opens. Turning this off removes DirtyCaptions tracks from open players. |
| **Show captions automatically** | On | Select an embedded track when no other captions are showing. Turn this off to select tracks manually in the CC menu. |
| **Preferred language** | Blank | Use the browser language. An explicit code such as `en`, `eng`, `fr`, or `fra` takes priority. |

FFmpeg and ffprobe use the paths configured in Stash's General settings, or
executables available on the Stash server's PATH. Extraction happens on that
server, including when viewing Stash from another computer.

## Formats and limitations

| Embedded format | Behavior |
| --- | --- |
| MP4 `mov_text`, SubRip/SRT, WebVTT | Converted to WebVTT and displayed in the native player. |
| ASS/SSA | Converted to ordinary caption text. Fonts, precise positioning, animation, and advanced styling are not preserved. |
| Common legacy text subtitles | Converted when supported by the installed FFmpeg. |
| PGS, VobSub/DVD, and other bitmap subtitles | Reported as unsupported; image subtitles are not converted through OCR or burned into the video. |

Empty embedded tracks are ignored. Scenes without supported, nonempty text
tracks receive no additional CC entry. If a scene has multiple media files,
DirtyCaptions reads the first file selected by Stash's native scene player.

Browser-local captions are intended for the web player. Casting to a separate
Chromecast/AirPlay receiver is not covered by this plugin. Compatibility with
browser-native fullscreen on mobile depends on its text-track support.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| DirtyCaptions is missing from the shared settings page | Update DirtyPlugins to 0.5.4 or newer, reload plugins, and hard-refresh the browser. |
| No embedded entry appears in the CC menu | Check that DirtyCaptions is enabled in Stash, **Load embedded captions** is on, and the file contains a supported, nonempty text subtitle track. Stash's Troubleshooting mode disables plugin JavaScript. |
| Captions are available but do not appear automatically | Check **Show captions automatically**, then select the embedded track manually. An external caption already showing keeps priority. Subtitles appear only during their timed dialogue; the first line may begin well after the video starts. |
| Caption loading is slow or times out | FFmpeg reads through the media container. Check server storage access, particularly network drives. Reopening the scene repeats extraction. |
| Extraction or loading fails | Open **Settings → Logs** and look for **[Plugin / DirtyCaptions]**. Check the configured FFmpeg/ffprobe paths and server access to the scene file, then use **Retry captions**. |
| ASS/SSA styling looks different | Conversion preserves dialogue and timing, with reduced styling. A dedicated ASS renderer is needed for the original appearance. |

## How it works

The Python entry point resolves the scene file through Stash using its scene
and file IDs. FFprobe lists subtitle streams; FFmpeg converts each supported
text track to WebVTT through stdout. The backend opens the source for reading
and does not create temporary subtitle files or modify media.

The browser receives text through `DirtyPlugins.runPluginOperation` and supplies
it to Video.js as in-memory data URLs. These work with Stash's default content
security policy without additional permissions or a separate subtitle server.
Tracks are registered through Stash's `sourceSelector` when available so its
existing middleware adjusts caption timestamps for transcoded playback.
Player listeners and DirtyCaptions tracks are removed when their controller
unmounts; the native player and external captions retain their own lifecycle.

## Documentation captures

With `?docsCapture=1`, the plugin hides the player video, poster, scrubber
thumbnails, and rendered captions. This covers the player area; inspect the
rest of the scene page for uncensored performer images and other media before
sharing or committing a screenshot. Do not commit uncensored Stash captures.

## Installation

Install DirtyCaptions from the suite package source. DirtyPlugins installs as
its dependency. See the [suite installation instructions](../../README.md#installation-from-stash).
For a manual installation, copy this directory to `<plugins_path>/dirtyCaptions`
and install/update DirtyPlugins alongside it. On Windows, the default target is
`%USERPROFILE%\.stash\plugins\dirtyCaptions`.
Reload Stash plugins, then hard-refresh the browser (**Ctrl+F5**).

## License

DirtyCaptions is distributed under the [MIT License](LICENSE).
