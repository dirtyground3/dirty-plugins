# DirtyTidy

DirtyTidy organizes scene files using metadata-based folder and filename
templates. Every proposed operation is calculated first and must be confirmed
from the Dirty Plugins settings page before it can be queued.
Preview rows can be filtered across the complete plan by Ready, Warning,
Blocked, or Unchanged status. The complete plan is calculated once; filtering
and pagination then happen instantly in the browser without recalculating it.

An approved strategy can run manually, after a completed Scan job, or after a
completed Generate job. Stash does not currently provide Scan/Generate plugin
hooks, so DirtyTidy listens to Stash's supported job-completion subscription;
the Stash UI must remain open until the selected job finishes.

## Safety model

- Missing metadata renders as `Unknown`.
- Stale Stash file records whose source file is missing are shown as warnings
  and skipped; they do not block valid operations for the same scene.
- Files remain inside the same configured Stash source.
- Existing destinations are never overwritten.
- The original extension is preserved when renaming.
- Stash's native `moveFiles` mutation performs the filesystem and database
  update together.
- Execution requires the strategy hash produced by a fresh preview.
- Changing a folder or filename strategy clears its automation approval.
- Automated execution rechecks the saved mode and approved strategy hash before
  moving any file.

## Templates

The hierarchy is an ordered list of templates, one per directory level. The
filename pattern uses the same variables. Available variables include scene
title and ID, date parts, rating and rating bucket, studio, performers, tags,
the first female or male performer, group, resolution, duration, source,
original name, and extension. Gender-specific variables use Stash's `FEMALE`
and `MALE` performer values and render as `Unknown` when no match exists.

## Installation

DirtyTidy depends on the sibling **DirtyPlugins** settings hub. Install from the
repository package source, or copy both complete directories into the Stash
plugins directory and reload plugins.

## License

DirtyTidy is distributed under the [MIT License](LICENSE).
