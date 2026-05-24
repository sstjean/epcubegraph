# Session Procedures

## Start Up

"Start up" means: begin the session by reading all context needed to work effectively.

### Steps

1. Read project summary (`.specify/memory/PROJECT_SUMMARY.md`)
2. **Read session handoff (`.specify/memory/SESSION_HANDOFF.md`) if it exists** —
   this captures in-flight state from the previous session and supersedes
   PROJECT_SUMMARY for anything currently in progress
3. Read copilot instructions (`.github/agents/copilot-instructions.md`)
4. Read constitution (`.specify/memory/constitution.md`)
5. Read GitHub issues (open issues list)
6. Read spec files (`specs/`)
7. Read any additional Copilot repo memory (`/memories/repo/`) if available

Do this at the beginning of every session before any work begins.

## Shutdown

"Shutdown" means: save the current state to the repo so the project is portable across machines.

### Steps

1. Update `.specify/memory/PROJECT_SUMMARY.md` with:
   - Everything accomplished in this session (commits, PRs, fixes, discoveries)
   - Current state of any in-progress work
   - Open issues status changes
   - Any new decisions or context learned
2. Document what to do next session under "What's Next"
3. Note any pending items (running CI, awaiting review, etc.)
4. **If work was left in flight** (uncommitted edits, abandoned branches,
   mid-debug state, unresolved design decisions, or anything the next session
   needs to pick up without losing context), write a detailed handoff note to
   `.specify/memory/SESSION_HANDOFF.md`. The note must capture:
   - Current branch state and any stashes (with names)
   - What was tried and what failed (so the next session does not repeat)
   - The decision made about how to proceed (if any)
   - Concrete next-action steps with file paths and commands
   - Anything the next session must NOT do (e.g., "don't shut down the
     Docker stack — user keeps it running between sessions")
   - Open issues affected
   If there is no in-flight work, delete any stale `SESSION_HANDOFF.md` so
   start-up doesn't pick up an outdated handoff.
5. Commit the updated `PROJECT_SUMMARY.md` (and `SESSION_HANDOFF.md` if
   written) to the current branch. For handoff notes, prefer a dedicated
   `docs/session-handoff-{date}` branch off `main` so the notes are visible
   immediately on next start-up regardless of which feature branch is
   checked out.

The goal is that a fresh Start Up on any machine can pick up exactly where
this session left off without re-deriving context the previous session
already worked out.
