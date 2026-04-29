# Session Procedures

## Start Up

"Start up" means: begin the session by reading all context needed to work effectively.

### Steps

1. Read project summary (`.specify/memory/PROJECT_SUMMARY.md`)
2. Read copilot instructions (`.github/agents/copilot-instructions.md`)
3. Read constitution (`.specify/memory/constitution.md`)
4. Read GitHub issues (open issues list)
5. Read spec files (`specs/`)
6. Read any additional Copilot repo memory (`/memories/repo/`) if available

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
4. Commit the updated `PROJECT_SUMMARY.md` to the current branch

The goal is that a fresh Start Up on any machine can pick up exactly where this session left off.
