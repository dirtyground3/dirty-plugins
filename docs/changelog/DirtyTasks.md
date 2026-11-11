# DirtyTasks release notes

Newest first. Each GitHub Release of DirtyTasks uses the entry that names its version.

- **DirtyTasks 1.0.12:** time schedules and library backups.
  - **Schedules:** Move, Rename, Update tags, each encoding rule and the backup
    can **Run on a schedule** at a time on chosen weekdays, in the Stash
    server's time. An open Stash tab runs them at that time through Stash's
    task queue, like Scan and Generate automation.
  - **Missed runs:** a schedule missed while no Stash tab was open shows
    **Missed scheduled tasks** on the next page load. Run the selected ones or
    skip them until their next time; each time runs or is skipped once,
    whichever tab answers.
  - **Backup:** **Back up library data** writes one zip with the Stash
    database, copied safely while Stash runs, and, by choice, blobs,
    `config.yml` with custom CSS, JavaScript and locales, the scrapers folder
    and the DirtyPlugins database. It is also under **Settings → Tasks**.
  - **Backup settings:** a folder chosen with **Browse…** or Stash's backup
    folder, **Keep newest backups**, the included parts, **Back up now**, and
    the last backup's date and size. Backups run manually, after Scan or
    Generate, or on a schedule.

- **DirtyTasks 1.0.11 and DirtyCaptions 1.0.9:** an encoding run that no Stash
  task is running any more, for example after Stash restarted, no longer blocks
  file organization. Organization pauses it and goes ahead, **Pause** and
  **Cancel** act on it at once, and the Stash log says when organization has to
  wait. Bulk edits of selected scenes no longer start one caption-index job per
  scene.

- **DirtyTasks 1.0.10:** Resize/Reencode preserves continuous MP4/M4V timecode
  tracks and copies MOV timecode tracks. Outputs must retain their timecode;
  other unsupported data tracks remain blocked with their format identified.

- **DirtyTasks 1.0.9:** job file-action buttons are enabled only while eligible
  files remain. Availability follows current scene files and primary choices;
  missing replacements, removed originals and shared files disable the affected
  action. Full content checks still run before deletion.

- **DirtyTasks 1.0.8:** validation now reports decode progress. Full content
  checks show byte-based progress, and indexing/attachment show separate
  activity labels. Validation checks and encoding settings are unchanged.

- **DirtyTasks 1.0.7:** **View scenes** beside each encoding rule's filter
  selector opens its matching scenes in a new tab with the selected filter.

- **DirtyTasks 1.0.6:** finished Resize/Reencode job details have **Make all new
  files primary** and **Delete all old files…** actions for the whole job.
  Already-primary new files are skipped. Confirmed deletion verifies each
  replacement and original, retains shared or changed files, and uses Stash's
  trash setting. Actions run in the task queue with progress counts and recovery
  for interrupted work.

- **DirtyTasks 1.0.5:** encoding runs have **Pause** and **Resume**. Pausing
  stops the current encode at once and discards its unfinished output; resuming
  starts that file again and continues with the rest. Results say how much
  smaller each new file is than its original instead of reporting added disk space.

- **DirtyTasks 1.0.4:** the summary of imported Tidy and Compactor settings
  can be closed, and stays closed.

- **DirtyTasks 1.0.3:** show organization recovery as a warning only when an
  abandoned reservation is blocking file work. Active and stopping jobs keep
  the warning hidden; recovery clears it after rechecking the current task.

- **DirtyTasks 1.0.2:** independent Manual, Scan, or Generate triggers for Move,
  Rename, Tags, and each encoding rule. The previous shared choice is copied to
  existing actions while templates, approvals and rule enable states are kept.
  Scan and Generate retain separate deferred work; encoding rule priority and
  duplicate prevention remain unchanged.

- **DirtyTasks 1.0.1:** one shared running strategy controls organization, tag
  updates and every enabled encoding rule: Manual only, after Scan or after
  Generate. Separate automation switches and per-rule modes are removed.
  Existing organization approvals and disabled rules are preserved.

- **DirtyTasks 1.0.0, DirtyPlugins 1.0.6:** DirtyTidy and DirtyCompactor are now one
  plugin with organization, encoding and tag updates. Resize/Reencode add a
  validated alternate file to the existing scene and keep the original primary
  file. Media deletion and output review are removed. Settings migrate once;
  old Delete rules are retired, pending trial outputs are discarded, and a new
  preview is required before enabling automation. Upgrade instructions are in
  [DirtyTasks](../../plugins/DirtyTasks/).

- **DirtyTidy 1.0.6:** optional tag updates after Scan. Choose a configured stash-box
  Tagger source and save to enable the task. It adds missing tags without removing
  existing ones or changing other scene metadata, and saves only scenes gaining tags.
  Duplicate tabs queue one task; unmatched or ambiguous scenes are skipped.
  Tag-only source lookups run in batches of up to 20 without fetching images.
  Successful checks are cached for 24 hours; **Refresh tags now** bypasses the cache.

- **DirtyTidy and DirtyCompactor 1.0.5:** planning work follows the active strategy.
  - Tidy requests only needed template fields, reuses normalized paths within each
    plan, and computes scene-level template values once while retaining file-level values.
  - Quality samples budget encoder and VMAF threads per worker and use single-thread
    decoding/filter pipelines. Up to three workers remain; smaller CPUs use fewer.
    The measurement version changes so saved quality samples are recalculated.

- **DirtyCompactor and DirtyFileExtractor 1.0.5:** subprocess reliability.
  - Quality samples, packet scans, and marker encoders share Windows child
    containment so forced parent termination stops them. Silent pipes cannot
    block cancellation/deadlines; diagnostics remain bounded.
  - Packet scans observe preview/run cancellation. Marker extraction stops and
    reaps its child before removing partial output, and callback cancellation
    can still abort before publication. Forced Stash termination can leave a
    partial file and an empty reservation, without leaving its encoder running.

- **DirtyCaptions 1.0.6, DirtyCompactor and DirtyFileExtractor 1.0.5:** backend efficiency.
  - Captions reuses short database reads during indexing, reads pending revisions
    per scene page, and limits queue batches in SQLite. Unchanged media still
    requires no file access; cancellation, leases, and queue revisions stay fresh.
  - Compactor polling reads no longer reserve the shared database's writer lock.
    Ownership checks before encoding and replacement query the affected scene
    instead of downloading the library. Native rule criteria and the attachment
    set are checked again; files with another owner remain blocked.
  - Extractor resolves scenes in batches of 25 and markers/images in batches
    of 100 while preserving order, missing-item reporting, and collision planning.
    FFmpeg configuration is
    resolved once per run, including runs with multiple failed marker clips.

- **DirtyPlugins, DirtyRank, and DirtyTidy 1.0.5:** workflow and state correctness.
  - Tidy manual confirmation identifies an immutable preview. A later preview
    with the same strategy cannot add unseen moves; each confirmed source and
    destination is checked again before execution. Automation still approves
    a strategy for future library changes. Generate a new preview after updating.
  - Hub settings events refresh the affected plugin while preserving raw edits,
    pending saves, and custom-panel workflows. Numeric autosave now enforces
    authored bounds, integer requirements, and steps.
  - Rank reads ratings/settings with their revision from one database snapshot,
    rejects stale individual replies, and publishes each vote/undo response
    once after updating both performers. Unaffected score caches are retained.

- **DirtyStats 1.0.5 and 1.0.4 for the other plugins:** internal simplification
  with no changes to settings or stored data.
  - The hub registers every plugin once per page. A plugin whose registration
    fails is reported once in the browser console
    (`[<pluginId>] registration failed`) and no longer stops the others.
  - Browser debug timing of patches and routes is recorded only when debugging
    was enabled before the page loaded (set `dirtyPluginsDebug` in localStorage
    and reload). `dirtyPluginsDumpDebugLogs()` still works;
    `DirtyPlugins.dumpDebugLogs()` is removed.
  - Server logs: every backend reports failures in the same form
    (`<Plugin> failed: mode=... after ...ms: ...`), including DirtyCompactor,
    which previously reported them only to the browser. DirtyStats'
    `started`/`finished` lines use the same wording as the other backends.
  - The marker that tells DirtyTidy, DirtyCaptions and DirtyCompactor
    automation to ignore scans started by DirtyCompactor moved to another table
    of the shared database. Markers written before the update are not read, so
    a Compactor-started scan that is still running during the update may be
    treated as an ordinary scan once.
  - Developer-facing: plugins no longer expose `destroy()` handles or the
    `DirtyPlugins.values`/`settingsMetadata`/`unregister*` members.

- **DirtyStats 1.0.4 and 1.0.3 for the other plugins:** internal
  simplification with no behavior changes. The hub's internal modules import
  each other instead of being wired through factory dependency objects, and
  DirtyMultiscreen's components import their bound runtime. Converted
  `var`/`function` code and template-era JSX are modernized, and repeated
  logic is shared: leaderboard paging, the battle vote queue, matchmaking
  scoring, Stats aggregations, shared settings storage, backend start-up and
  the backends' settings parsing and result building.
  Settings, stored data and the hub's public API are unchanged; the
  DirtyPlugins backend's failure log line now matches the other backends.

- **DirtyStats 1.0.3 and 1.0.2 for the other plugins:** dead code and
  compatibility with pre-1.0 developer builds are removed. The hub no longer
  bundles HTM (`react.html`) and exposes only the API members the plugins use;
  older-hub fallbacks and the `?censorMedia=1` alias are gone (use
  `?docsCapture=1`). Readers for data written by pre-1.0 versions were removed
  after a read-only check showed current data no longer uses them: the shared
  Stats rounding key and Stats-only theme, Tidy JSON-string settings, Rank
  cohort-only settings and old category IDs, caption-index records without
  Stash identities, and Compactor outcomes recorded before quick fingerprints.
  DirtyRank's reset message drops its always-zero failure count.

- **DirtyPlugins 1.0.2, DirtyRank 1.0.2, DirtyCompactor 1.0.2:** settings
  labels, defaults, bounds and options, and the constants shared by browser and
  backend, now come from one schema per plugin, so Stash's settings, the browser
  code and the Python backends cannot drift apart. DirtyRank's backend lists
  gender-box categories in a stable order. No visible behavior changes.

- **1.0.1 for all plugins, DirtyStats 1.0.2:** minified release bundles without
  inline source maps, and DirtyStats loads only the ECharts modules it uses.
  Served plugin JavaScript fell from about 8.8 MB to 1.5 MB.

- **1.0.0 for all plugins:** frontends rewritten in TypeScript/TSX, each
  compiled to one bundle that uses Stash's React. Settings, stored data and
  behavior are unchanged.
