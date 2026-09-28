# DirtyCompactor

Reclaim media space with ordered scene-filter rules. Requires Stash 0.31.1+,
DirtyPlugins, Python 3.9+, FFmpeg, and FFprobe. No Python packages are required.
The installed plugin ID is `dirtyCompactor`.

The UI uses `DirtyPlugins.react.html` to render React components from plain
JavaScript without a build step. The shared hub bundles HTM locally.

## Rules

Open **Dirty Plugins → DirtyCompactor** and select **Add rule**. Rules appear
as one-line rows; click a row to edit it. Move, duplicate, and delete rules
from the row's ⋮ menu. Choose the rule's scenes and one action:

| Action | Effect |
| --- | --- |
| Resize | Fit the video inside a maximum resolution, preserve aspect ratio, and encode at a target video bitrate. Never upscale. |
| Reencode | Keep the resolution and lower the video bitrate. |
| Delete | Remove the scene, its media files, and generated assets using Stash's deletion workflow. |

![DirtyCompactor rule list with one rule open showing its quality preset](../../docs/images/dirty-compactor-settings.png)

Three rules as compact rows, with the Reencode rule open: its scenes, action,
and Balanced quality preset. Codec, encoder, and container sit under
**Advanced**. The toolbar holds automation, **Add rule**, and **Preview**; run
history appears below.

Rules autosave after a short delay. New rules are disabled and Manual. Enable
them after choosing a native Stash filter, or explicitly select **All scenes**.
Use Move up/down to set priority. The first enabled matching rule wins;
unsupported or already-small files do not fall through to a later rule.
Every eligible file associated with a scene is processed.

Encoding rules pick a **Quality** preset instead of a bitrate:

| Preset | 1080p H.264 | 1080p H.265 |
| --- | --- | --- |
| High quality | 8 Mbps | 5 Mbps |
| Balanced (default) | 5 Mbps | 3 Mbps |
| Smallest files | 3 Mbps | 1.8 Mbps |

The bitrate is chosen per file from its output resolution (scaled by pixel
count to the power 0.75) and frame rate (up to ×1.41 for 60 fps), so one
Balanced rule suits a mixed 720p/4K library. **Custom bitrate** sets a fixed
Mbps for every file; rules saved before presets existed keep their bitrate.
The preview table shows the bitrate chosen for each file.

**Same as source (convert only)** keeps each file's video bitrate and only
changes the codec (and, with **Allow format change**, the container), for
example to make WMV/VC-1 files playable. These outputs are not required to be
smaller, and files already in the selected codec are skipped.

### Estimated savings before previewing

As soon as a rule has scenes, its row and editor show a rough estimate such as
"≈ 24.9 GiB saved of 45.8 GiB (54%)". It uses Stash's total size for the
filter plus a fixed random sample of up to 200 matching scenes (their size,
duration, resolution, bitrate, and frame rate), applying the same skip rules as
the planner with a typical 128 kbps audio track. It treats each rule on its
own, so earlier rules may claim some scenes. **Preview** gives exact numbers.

Codec (H.264 or H.265), encoder, and container live under **Advanced**.
**Detect** next to the encoder tests actual availability. Auto GPU tries
NVIDIA NVENC, Intel QSV, and AMD AMF before CPU. Hardware-specific failures
retry once on CPU with the same codec. Audio, subtitles, chapters, and supported
metadata are retained rather than deliberately compressed or removed.

**Keep format** preserves the container and filename. **Allow format change**
permits MP4 or MKV when the source container cannot retain the selected codec
and streams. Unrelated destination files are never overwritten.

## Manual runs and output review

1. Select **Preview**. Planning runs as a Stash background task.
2. Review the totals: ready files, estimated savings, and skipped files. The
   reasons for skipped files are listed with counts (for example "12 Already
   at or below target bitrate"). **Show files** lists each operation and lets
   you exclude scenes.
3. Select **Run…** and confirm the operations. Optionally enable
   **Let me check each encoded file before it replaces the original**.

With output review enabled, DirtyCompactor encodes and validates one complete
file, then pauses. **The original and its Stash association remain unchanged.**
The output player and download link expose the actual encoded file, including
its measured size and bitrate. No second encode is used to make it playable.
For codecs the browser cannot play, download the output for an external player.

- **Accept and replace** installs exactly the reviewed bytes, refreshes Stash,
  and removes the original backup after reconciliation succeeds.
- **Discard** removes the trial output, keeps the original, and continues.
- **Review later** (⋮ menu, next to **Download output**) retains the pending output without accepting it. Reopen
  DirtyCompactor to resume. There is no automatic expiry or acceptance.

Each encoded file needs its own decision. Delete rules have no output review;
their destructive action is covered by the initial operation confirmation.
Changing a rule or source while review is pending makes acceptance stale;
discard the trial and build a new preview.

## Automatic execution

Enable **Run automatically after library scans** on selected rules and turn
on **Automatic runs** in the toolbar. After a
successful Stash scan, enabled rules are evaluated against the whole library.
The Stash UI must be open to observe scan completion; queued jobs continue if
the browser closes. A first matching Manual rule protects that scene from
later Automatic rules.

Automatic runs never pause for output review. Their own metadata refresh scans
are excluded from both DirtyCompactor and DirtyTidy automation. Duplicate scan
events across tabs are deduplicated in the shared database. Additional triggers
during an active or review-paused run are coalesced into one later evaluation.

## Storage, cancellation, and recovery

Rules, run snapshots, decisions, progress, and recovery journals live in
DirtyPlugins' shared `dirty_plugins.sqlite3`. Only one Compactor run is active
at a time. Successful output fingerprints prevent repeated processing with
the same action settings.

Trial encodes use the installed plugin's `runtime/private` directory. Only
validated review outputs are moved to `runtime/previews` and served by Stash.
Normal encodes stage beside the original. Acceptance may temporarily need a
second output-sized copy when staging from the preview cache. The UI reports
potential savings during review and reclaimed bytes after successful cleanup.
Delete results report library bytes removed separately because Stash's trash
configuration can retain the files on disk.

**Cancel run** stops encoding cooperatively, removes unaccepted outputs, and
retains original files. Once replacement begins, reconciliation or recovery
must finish before stopping. A Windows job object also contains FFmpeg when
Stash forcibly terminates a worker.

If a job is interrupted, use **Recover interrupted run** from the run's ⋮ menu
once its Stash tasks have stopped. Reconciliation failures keep recovery files
and offer **Retry recovery** and **Restore original**. Never manually remove a recorded backup while recovery
is pending. The plugin never writes Stash's database directly.

## Initial compatibility boundaries

- Exactly one video stream, even source dimensions, and known duration.
- HDR tone mapping is not supported.
- Shared file associations, hard links, and symbolic links are blocked.
- MP4/M4V/MOV and Matroska are retained when compatible; other containers need
  Allow format change. Unsupported stream combinations are reported.
- Outputs must be smaller (except **Same as source** conversions) and pass
  probing plus a complete decode check.
- Bitrate is measured from video packets if stream metadata omits it or reports
  an impossible value, such as the 1 bit/s ffprobe gives many WMV/VC-1 files.
- Settings saves, installation, and startup do not launch automatic runs.

The panel uses shared DirtyPlugins themes, controls, and navigation protection.
`?docsCapture=1` replaces media and private paths with placeholders. Runtime
files are excluded from Git and plugin packages.

## Development checks

```powershell
python -B -m unittest discover -s tests -v
node --check plugins/DirtyCompactor/dirtyCompactor.js
node tests/test_dirty_compactor.js
python -B tests/test_dirty_compactor_stash_integration.py --binary 'C:\path\to\stash.exe'
```

The opt-in integration fixture creates its own database, plugin directory,
synthetic media, and localhost port. It never modifies the normal Stash library.
Add `--serve` to inspect the synthetic interface until stopping the fixture.

## License

MIT; see [LICENSE](LICENSE). FFmpeg is supplied by the host installation and is
not redistributed in this plugin.
