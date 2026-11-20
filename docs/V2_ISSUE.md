# v2 GitHub issue (to create once the repository is on GitHub)

**Title:** v2: Pilot measurement — show note-quality and completion trends per cycle

**Labels:** enhancement, v2

**Body:**

## Why
v1 adds AI help for raters (explanations, behaviour suggestions, note coach). We don't yet measure whether it
improves the feedback. A pilot needs evidence.

## What
- Record, per cycle, how many behaviour notes the note coach judged "good" on first check vs after help (counts only, no text).
- Show on the Dashboard: completion rate over time, share of specific notes, and AI help usage per cycle.
- Optional: extend Filipino to every AI feature (summaries and insights), not only the item help.

## Acceptance criteria
- An admin can see, for each cycle, completion %, % specific notes, and AI help usage.
- No note text or names are stored for these metrics.
- Unit tests cover the metric calculations.
