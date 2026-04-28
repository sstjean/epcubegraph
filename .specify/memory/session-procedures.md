# Session Procedures

## Start Up

"Start up" means: begin the session by reading all context needed to work effectively.

### Steps

1. Read repo memory (`/memories/repo/`)
2. Read copilot instructions (`.github/copilot-instructions.md`)
3. Read constitution (`.specify/memory/constitution.md`)
4. Read GitHub issues (open issues list)
5. Read spec files (`specs/`)

Do this at the beginning of every session before any work begins.

## Shutdown

"Shutdown" means: save the current state to repo memory so the project is portable across machines.

### Steps

1. Update `/memories/repo/PROJECT_SUMMARY.md` with:
   - Everything accomplished in this session (commits, PRs, fixes, discoveries)
   - Current state of any in-progress work
   - Open issues status changes
   - Any new decisions or context learned
2. Document what to do next session under "What's Next"
3. Note any pending items (running CI, awaiting review, etc.)

The goal is that a fresh Start Up on any machine can pick up exactly where this session left off.
