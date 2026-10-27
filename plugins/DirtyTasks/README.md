# DirtyTasks

DirtyTasks combines file organization, encoding and optional scene tag updates.
It depends on DirtyPlugins, Python 3.9+, and (for encoding) FFmpeg/FFprobe.
Open **Dirty Plugins → DirtyTasks**.

## Action triggers

Move into folders, Rename files, Update scene tags, and each encoding rule have
an independent **Manual only**, **Run after Scan**, or **Run after Generate**
selector. Triggers autosave. A Stash tab must remain open to observe successful
job completion; queued work continues without the browser. Changing a trigger
does not launch work. Manual Preview/Run and Refresh tags now remain available.

Move and Rename run only their scheduled action, using the approved file
strategy. For example, Scan can move files and Generate can rename them. Tag
updates use their own trigger and do not need file-organization approval.
Queued work rechecks its trigger before starting. Deferred Scan and Generate
work are retained separately.

On upgrade from the shared running strategy, its selection is copied to every
existing action and encoding rule. Templates, approvals, rule order and enabled
states are preserved. New and duplicated encoding rules start with Manual.

## File organization and tags

Folder and filename strategies retain explicit Save and Preview/Confirm/Run.
Manual runs apply only the immutable confirmed preview. Automation applies the
approved strategy after a successful Scan or Generate observed by an open Stash
tab. Multiple files in a scene receive stable file-ID suffixes when renamed.

Optional tag updates merge tags from a selected configured stash-box source
using its selected trigger. Existing tags and other metadata stay intact. Successful checks
are cached for one day; Refresh tags now bypasses that cache.

An interrupted organization task shows a warning and **Recover organization
task** button only when its saved reservation remains and Stash has no active
organization job. Recovery releases the abandoned reservation and resumes
waiting tasks; it does not undo file operations. The warning stays hidden
while tasks are running, queued, or stopping. Its status refreshes when this
page opens, organization jobs change, and the Stash tab regains focus.

## Encoding

Ordered rules choose scenes through native Stash filters and either resize or
reencode them. The first enabled matching rule wins, for both manual and automatic evaluations.
If that rule uses a different trigger, the scene is skipped instead of falling
through to a later rule. Rules autosave; new rules are disabled.
Quality presets, visual-quality measurement, custom bitrate, codec, hardware
encoder detection/CPU fallback and container preservation remain available.

Preview and confirm a manual run. Each validated output is saved beside its
source with a distinct name, scanned, and attached to the **same scene**.
Both files remain on disk and attached. The original remains the primary file;
there is no media Delete action, replacement, or output-review step.
Size differences compare versions; **Added to disk** reports actual additional
storage, not reclaimed space. Outputs must pass stream, dimensions, duration,
size and decode validation before publication. Generated versions are skipped
by later encoding runs, and the same original/settings combination is not
encoded again while its output remains attached.

Cancel stops the encoder and cleans its unfinished temporary output. Once an
output is published, attachment finishes before cancellation. An interrupted
publication or failed attachment keeps the output and offers Retry recovery;
recovery never replaces or deletes the original. File organization and encoding
reserve file work through shared SQLite so they cannot run concurrently.
Internal refresh scans do not trigger another automation cycle.

## Upgrade from DirtyTidy / DirtyCompactor

1. Finish or cancel old workers. Resolve interrupted replacements with the old
   Compactor first; keep all recorded original backups until recovery succeeds.
2. Disable DirtyTidy and DirtyCompactor, install DirtyTasks and the updated
   DirtyPlugins hub (1.0.6 or newer), and reload plugins.
3. Hard-refresh Stash (Ctrl+F5) and open DirtyTasks. The one-time migration imports
   both settings sections, removes Delete rules, discards pending trial review
   outputs, and imports the running strategy. Its summary stays at the top of the
   panel until you close it. Review a fresh preview before running.
4. Choose the trigger for each action. Remove the disabled old plugin
   installations only after migration succeeds.

Historical records and tag checks stay in DirtyPlugins' shared SQLite database.
Migration does not launch any work. Organization automation needs a new approval because multi-file naming now
keeps each version distinct. Encoding uses a
new journal namespace so old replacement jobs cannot resume as additive jobs.

## Development

Run `npm ci` and `npm test`. Install only `.build/plugins/DirtyTasks/` into
Stash's `plugins/dirtyTasks/`, alongside the staged DirtyPlugins hub. The single
Python protocol entry is `dirty_tasks.py`; organization and encoding remain
independent internal modules. Metadata comes from `schemas/dirtyTasks.settings.json`.
All transport, shared UI, capture masking, autosave and navigation protection
use DirtyPlugins. Runtime data and temporary media are excluded from packages.

Use isolated Stash fixtures with synthetic media for attachment/recovery checks.
`?docsCapture=1` masks private paths and media in the interface.

## License

MIT; see [LICENSE](LICENSE). FFmpeg is provided by the host and is not bundled.
