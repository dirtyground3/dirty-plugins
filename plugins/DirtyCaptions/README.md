# DirtyCaptions

Display embedded text subtitles in Stash's native scene player without creating
separate subtitle files or re-encoding the video. Includes scene filters for
embedded subtitle tracks. Requires Stash 0.31.1 or newer,
Python 3.9+, FFmpeg/ffprobe, and **DirtyPlugins 0.5.6 or newer** on the Stash
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
and no media rescan is needed. Settings, file fingerprints, and caption-index
metadata are stored in the shared database.

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
| **Maintain caption index automatically** | On | Queue checks for new or updated scenes and reuse subtitle metadata discovered during playback. The first Stash tab opened starts the initial library check. |
| **Refresh caption index after Scan** | Off | With automatic index maintenance enabled, index new or changed files after each successful Scan. Skip known unchanged media. Keep a Stash tab open until Scan finishes, as with DirtyTidy automation. |

FFmpeg and ffprobe use the paths configured in Stash's General settings, or
executables available on the Stash server's PATH. Extraction happens on that
server, including when viewing Stash from another computer.

## Filtering scenes by embedded captions

Open **Edit filters** on a native scene list, including scene lists embedded in
other Dirty plugins. Choose **Embedded captions** in the normal filter dialog,
then select one value using Stash's native radio controls, like **Resolution**.
This single filter combines with existing search, performer, rating, and other
filters, and uses normal pagination and sorting.
Apply or cancel edits, pin criteria, and save the combination through Stash's
normal filter and bookmark controls.

| Embedded captions value | Matches |
| --- | --- |
| **Any captions** | At least one attached file has an embedded subtitle track, including bitmap formats. |
| **Text captions** | At least one attached file has a text subtitle stream supported by DirtyCaptions. This detects track metadata; an empty or damaged track may still fail to display. |
| **Bitmap / other** | All attached files were checked, at least one contains subtitles, and none has a supported text track. This includes bitmap and unsupported formats. |
| **None** | All attached files were successfully checked and none contains a subtitle track. |
| **Verified** | All attached files were successfully checked. |
| **Unverified** | Scenes not yet indexed, scenes with no attached files, or scenes whose files could not all be checked. |

The choices use **is**; caption categories have no greater-than or less-than
ordering. Scenes with both text and bitmap tracks match **Text captions**.

The plugin maintains the custom fields **Contains embedded captions** and
**Contains embedded text captions** (`Yes`/`No`), and **Caption index status**
(`Ready`, `Unknown`, or `Error`). Other custom fields are preserved. An unknown
result has no `No` value: missing files and failed probes cannot masquerade as
confirmed absence. If one accessible file has subtitles and another cannot be
checked, it matches **Any captions** and also **Unverified**. Saved filters and
URLs store ordinary Stash custom-field criteria, so they keep working when
DirtyCaptions is disabled. Existing caption
custom-field filters are displayed in the single native picker when possible.
Complex legacy combinations keep additional predicates under **Custom Fields**
so their results remain unchanged. Selecting a new value uses the existing file
map and does not trigger file probes.

The initial check runs as a Stash background job. It uses ffprobe metadata,
without extracting or storing subtitle dialogue. The shared database retains a
file map keyed by Stash file ID, with caption results, size, modification time,
and Stash's existing MD5/oshash fingerprints. Later refreshes read Stash's stored
metadata to discover new or changed files. Known unchanged media are skipped
before opening, statting, hashing, or probing the file. Renaming or moving an
indexed file does not require another probe. A content hash, size, or
modification-time change invalidates that file's entry; adding a generated
perceptual hash does not. Existing maps are upgraded from saved size and time
metadata without repeating successful probes.

Scene creation and update hooks queue checks even with the browser closed;
deletion hooks remove the scene's index record. Adding or removing a previously
indexed file recalculates scene flags from cached results. Playback reuses its
existing probe result and queues a check of the other attached files.

Enable **Refresh caption index after Scan** to index only new or changed files
reported by a successful Stash Scan. Like DirtyTidy automation, this listens
for Scan completion in the browser: a Stash tab must remain open until the Scan
finishes. Once queued, the caption-index job continues after the browser closes.
Failed or cancelled scans and DirtyCompactor's internal refresh scans do not
trigger it. Events replayed or received by multiple tabs request only one
refresh per Scan. There are no hourly or other timer-based library checks.
**Maintain caption index automatically** can be turned off independently of
subtitle playback; this also disables refresh after Scan. Existing indexed
fields remain available until another check updates them.

In **Dirty Plugins settings → DirtyCaptions → Caption index**, use **Refresh
caption index** for an incremental refresh, view progress (including skipped
unchanged scenes), or **Stop refresh**. With no changes, a refresh probes zero
files. A stopped refresh remains paused until manually refreshed.
**Reprobe all files** bypasses the map and checks every file again. Use it to
retry failed checks after restoring access, or when a replacement kept the same
stored identity. Failed unchanged files otherwise remain unverified and are
skipped on later refreshes. Both refresh tasks are also available on
Stash's **Tasks** page. Interrupted server jobs are recovered on the next
Stash tab opening, enabled Scan completion, or manual refresh; previously
completed file probes are reused.

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
| DirtyCaptions is missing from the shared settings page | Update DirtyPlugins to 0.5.6 or newer, reload plugins, and hard-refresh the browser. |
| No embedded entry appears in the CC menu | Check that DirtyCaptions is enabled in Stash, **Load embedded captions** is on, and the file contains a supported, nonempty text subtitle track. Stash's Troubleshooting mode disables plugin JavaScript. |
| Captions are available but do not appear automatically | Check **Show captions automatically**, then select the embedded track manually. An external caption already showing keeps priority. Subtitles appear only during their timed dialogue; the first line may begin well after the video starts. |
| Caption loading is slow or times out | FFmpeg reads through the media container. Check server storage access, particularly network drives. Reopening the scene repeats extraction. |
| Extraction or loading fails | Open **Settings → Logs** and look for **[Plugin / DirtyCaptions]**. Check the configured FFmpeg/ffprobe paths and server access to the scene file, then use **Retry captions**. |
| ASS/SSA styling looks different | Conversion preserves dialogue and timing, with reduced styling. A dedicated ASS renderer is needed for the original appearance. |
| A scene is missing from a caption filter | Wait for the initial caption-index job or run **Refresh caption index**. Choose **Embedded captions → Unverified** and check the Stash log for inaccessible files. |
| A replaced file keeps its old caption result | Run a Stash Scan to update its stored identity, or use **Reprobe all files** to bypass the map. |
| A previously inaccessible file remains unverified after restoring access | Use **Reprobe all files** to retry saved failed checks. |

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
