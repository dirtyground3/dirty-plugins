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

Encoding rules pick a **Quality** instead of a bitrate:

| Quality | How it encodes | Speed |
| --- | --- | --- |
| High quality / Balanced / Smallest files | Constant quality (CRF) | Fast preview |
| Match visual quality (slower) | Measures CRF per video for a VMAF target | Fast preview; ~0.5 min extra per video in the run |
| Same bitrate (convert only) | Keeps each video's bitrate | Fast preview |
| Custom bitrate | Fixed Mbps for every video | Fast preview |

**Constant-quality presets** use each encoder's quality mode (x264/x265
`-crf`, NVENC `-cq`, Quick Sync `-global_quality`, AMF constant QP), so the
encoder spends as many bits as each scene needs and quality stays consistent
across resolutions and source codecs. The output's peak rate is capped at the
source's video bitrate where the encoder supports it (CPU and NVENC).

| Preset | H.264 CRF | H.265 CRF | Typical 1080p H.264 | Typical 1080p H.265 |
| --- | --- | --- | --- | --- |
| High quality | 19 | 21 | 8 Mbps | 5 Mbps |
| Balanced (default) | 22 | 24 | 5 Mbps | 3 Mbps |
| Smallest files | 25 | 27 | 3 Mbps | 1.8 Mbps |

The typical bitrates (scaled by pixel count to the power 0.75 and by frame
rate, up to ×1.41 for 60 fps) are only used for estimates and to skip files
that are already smaller; real sizes depend on the content. Hardware encoders
use the same number on their own quality scale. If an output still does not
come out smaller, the original is kept and later previews skip that file with
the same settings ("Would not get smaller with these settings").

**Match visual quality (slower)** targets how close the result looks to the
original, measured with VMAF (an FFmpeg build with libvmaf is required): Nearly
identical (97), Very close (95, default), Close (93), or Good enough (90).
Preview stays quick: it lists these files with typical estimates, since its
job is to show what a run would touch before anything changes. When the run
reaches each video, it test-encodes three 4-second clips (at 20%, 50%, and
80%, in parallel) with the encoder the run uses, scores them with VMAF, and
keeps the highest CRF whose average reaches the target (H.264 14–34, H.265
16–36). The search starts at the matching preset and interpolates between
measurements, so it needs at most four tests, usually two or three. Frames are
compared by position, not timestamp, because WMV/ASF timestamps are irregular.
On a 1080p WMV this takes about 25 seconds with NVENC or 50 seconds on the CPU.
Files that would not get at least 5% smaller at the target are left unchanged
("Would not get smaller at this visual quality"). The chosen CRF and measured
VMAF appear in the run's file list and on the output review card.

**Custom bitrate** sets a fixed Mbps for every file; rules saved before
presets existed keep their bitrate. **Same bitrate (convert only)** keeps
each file's video bitrate and only changes the codec (and, with **Allow format
change**, the container), for example to make WMV/VC-1 files playable. Size is roughly bitrate × duration, so
the files stay about the same size: a more efficient codec at the same bitrate
looks better rather than getting smaller. To keep the original look in less
space, use **Match visual quality** or a preset. These
outputs are not required to be smaller, files already in the selected codec
are skipped, and it is not offered for Resize, where keeping the bitrate would
keep the size.

A file's bitrate is never raised. When a file's video bitrate is already at or
below the target (or typical) bitrate, a Reencode to a different codec runs at
the original bitrate (marked "original bitrate" in the preview, and not
required to shrink); any other case is skipped as "Already at or below target
bitrate".

Presets can save a lot even at **High quality** when the source uses an older
codec: H.265 needs roughly half the bitrate of H.264, and less than VC-1/WMV or
MPEG-4, for similar visual quality. The estimate line shows the average video
bitrate before and after (for example "video about 12.0 → 5.0 Mbps"); use
output review or **Match visual quality** to check before committing a whole
library.

### Estimated savings before previewing

As soon as a rule has scenes, its row and editor show a rough estimate such as
"≈ 24.9 GiB saved of 45.8 GiB (54%)". It uses Stash's total size for the
filter plus a fixed random sample of up to 200 matching scenes (their size,
duration, resolution, bitrate, and frame rate), applying the same skip rules as
the planner with a typical 128 kbps audio track. It treats each rule on its
own, so earlier rules may claim some scenes. **Preview** gives exact numbers.

Codec (H.264 or H.265), encoder, and container live under **Advanced**.
**Detect** next to the encoder tests actual availability (with a 320×240
test frame; NVENC rejects very small frames). Auto GPU tries
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
the same action settings; outputs that could not get smaller are remembered
the same way, so later previews skip them.

Preview never reads whole files. It records each file's size, modification
time, and file ID plus a quick fingerprint of its first and last MiB. When a
run starts, each file is checked against that quick fingerprint (a file changed
since Preview is left alone) and then fingerprinted in full with SHA-256 before
anything is encoded. The full hash guards replacement and recovery, so they
never confuse the original with its compressed copy. Stash's perceptual hash
is not used for this: a compressed output looks the same and so has nearly the
same phash as its original.

**Match visual quality** measurements are remembered per file (quick
fingerprint), output size, encoder, and target. Later previews show them
(including files that would not get smaller), and later runs reuse them
instead of measuring again.

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
- Outputs must be smaller (except **Same bitrate** conversions) and pass
  probing plus a complete decode check.
- When stream metadata omits the video bitrate or reports an impossible value
  (such as the 1 bit/s ffprobe gives many WMV/VC-1 files), it is taken from the
  container bitrate minus the audio streams; only if that is unknown are the
  video packets read and measured.
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
