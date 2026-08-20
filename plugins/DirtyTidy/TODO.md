# DirtyTidy todo

## File naming

- [x] Do not rename a file when every variable used by its filename pattern is
  missing. Keep the existing basename instead of producing names such as
  `Unknown-Unknown`.
- [x] Add `{female_performers}` and `{male_performers}` variables containing the
  complete female and male performer lists, using the configured multi-value
  separator and `Unknown` when no matching performer exists.
- [x] Investigate and fix the error raised when `{first_tag}` is used. Add a
  regression test covering scenes both with and without tags.

## Blocked operations

- [x] In preview notes for blocked operations, link every scene involved in the
  block. This must include all scenes when multiple files target the same
  destination, rather than linking only the row's primary scene.
