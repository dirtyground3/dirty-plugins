# DirtyTidy

DirtyTidy organizes scene files using metadata-based folder and filename
templates. Manual execution applies only operations confirmed in a preview
from the Dirty Plugins settings page. Automation requires a reviewed preview
and explicit approval of the folder and filename rules.
The preview shows totals first; select a total (Ready, Moves, Renames,
Warnings, Unchanged, Blocked) or **Show files** to list matching rows. Empty
categories are hidden. The complete plan is calculated once; filtering
and pagination then happen instantly in the browser without recalculating it.

An approved strategy can run manually, after a completed Scan job, or after a
completed Generate job. Stash does not currently provide Scan/Generate plugin
hooks, so DirtyTidy listens for successfully finished jobs through Stash's
job-status subscription; the Stash UI must remain open until the selected job
finishes. Before queuing a task, the backend atomically claims each job's ID and
start time in shared SQLite storage. Multiple tabs, browsers, or devices queue
only one task, while reused job IDs after a restart still trigger new runs.
Task names describe the enabled actions (folder organization, renaming, or both)
and include the triggering Scan or Generate job ID. Manual tasks are labeled
as applying the confirmed file organization plan.
Automation recalculates the plan from the current library each time, so new
scenes and changed metadata use the approved rules without another approval.

## Screenshot

![DirtyTidy organization and filename template settings](../../docs/images/dirty-tidy-settings.png)

**Move into folders** and **Rename files** are one-line rows with an on/off
switch and a summary of their template; click a row to edit it. Folder levels
are reordered or removed from each level's ⋮ menu, and **+ Variable** inserts a
metadata variable from a grouped menu. Filename length and the multi-value
separator sit under **Advanced**.

The toolbar holds the automation trigger (with an Approved / Needs approval
badge), **Save**, and **Preview**. After previewing, **Run…** opens a
confirmation dialog that saves the previewed strategy, can also approve it for
automation (or approve without running), and queues the plan.

## Safety model

- Missing metadata renders as `Unknown` in folder hierarchies. Missing filename
  variables are omitted and their surrounding separators are cleaned up.
- Stale Stash file records whose source file is missing are shown as warnings
  and skipped; they do not block valid operations for the same scene.
- Files remain inside the same configured Stash source.
- Existing destinations are never overwritten.
- The original extension is preserved when renaming.
- If every variable in a filename pattern is missing, the original filename is
  kept instead of producing an `Unknown`-only name.
- Moving and renaming can independently be limited to scenes that have at least
  one external Stash ID.
- Stash's native `moveFiles` mutation performs the filesystem and database
  update together.
- Execution requires the strategy hash produced by a fresh preview.
- Changing a folder or filename strategy clears its automation approval.
- Automated execution rechecks the saved mode and approved strategy hash before
  moving any file. Approval covers the rules, including future scenes, rather
  than freezing the preview's file list. Each run still skips missing files,
  blocked destinations, and files outside configured Stash sources.

## Templates

The hierarchy is an ordered list of templates, one per directory level. The
filename pattern uses the same variables. Available variables include scene
title and internal or external Stash ID, date parts, rating, grade and rating
bucket, studio, performers, tags,
all female or male performers, the first female or male performer, group,
resolution, duration, source, original name, and extension. Gender-specific
variables use Stash's `FEMALE` and `MALE` performer values and render as
`Unknown` when no match exists. `{females_performers}` is accepted as an alias
for `{female_performers}`.

`{stash_id}` uses the first external Stash ID in deterministic alphabetical
order when a scene has more than one.

`{parent_studio}` uses the parent studio when present and falls back to the
scene's studio when that studio has no parent.

`{grade}` converts the 0–100 scene rating into an alphabetically sortable
letter: A for 90–100, B for 80–89, C for 70–79, D for 60–69, E for 50–59,
and F for 0–49. An unrated scene renders as `Unknown`.

## Installation

DirtyTidy depends on the sibling **DirtyPlugins** settings hub. Install from the
repository package source. For a local install, run `npm ci` and `npm run build`,
then copy the contents of `.build/plugins/DirtyTidy/` into Stash's
`plugins/dirtyTidy/`, with `.build/plugins/DirtyPlugins/` installed as
`plugins/dirtyPlugins/`. Reload plugins
and hard-refresh the Stash browser (Ctrl+F5).

It uses the shared suite toolbar, row list, overflow menus, fields, dialog,
pagination, and status colours. Strategy changes are saved explicitly (**Save**
or the run confirmation) rather than automatically, because they move files. With `?docsCapture=1`, preview paths and note details
appear as placeholders for safe screenshots.

Planned improvements and known bugs are tracked in [TODO.md](TODO.md).

## Development

The strict TypeScript modules and focused TSX controls compile to the sole
staged browser script, `dirtyTidy.js`. React comes from Stash's `PluginApi`;
shared components, GraphQL, settings and completed-job handling use the public
DirtyPlugins API. No React or hub implementation is bundled. Imported modules
do not register effects; the entry registers the settings panel and App patch
once through the hub's `registerPlugin`. Stash cannot remove patches, so a
reloaded bundle is ignored and a failed registration is logged once.
Unmounting components unsubscribe their effects, clear dirty reports and
ignore late results.

Tidy intentionally keeps manual Save and Preview/Confirm/Run. Preview normalizes
the draft without saving it. Confirmation saves before queuing execution;
edits made during that save require a new preview before execution. An older
save cannot replace newer edits, and an unmounted panel never queues after a
save.

```powershell
npm run build
npm run typecheck
node tests/test_dirty_tidy_settings.js
node tests/test_dirty_tidy_workflow.js
node tests/test_dirty_tidy_automation.js
node tests/test_dirty_tidy_ui.js
python -B -m unittest discover -s tests -p test_dirty_tidy.py
npm test
```

Module tests cover normalization, filtering/pagination, manual workflow and
automation; bundle tests cover compiled controls, registration, capture masking
and cleanup. Opt-in real-Stash acceptance uses synthetic media, a disposable
database and a random non-9999 port:
`python -B tests/test_dirty_tidy_stash_integration.py --binary <stash-executable>`.
Add `--serve --stop-file <path>` for browser review and graceful fixture cleanup.
The fixture checks confined native moves/renames, missing metadata/files,
collisions, reviewed-plan validation, approved Scan automation/deduplication,
preserved file bytes and IDs, and the exact served bundle. After
`npm run build:dev`, add `--development` to decode its embedded source map.

## License

DirtyTidy is distributed under the [MIT License](LICENSE).
