---
description: Sync tasks from tasks.md into User Story GitHub issue bodies as checklist items. Updates existing issue bodies to reflect current task state.
tools: ['github/github-mcp-server', 'runInTerminal', 'readFile', 'listDir', 'searchFiles', 'grepSearch']
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

Per constitution v1.18.0 (GitHub Issue Discipline — Task Tracking): tasks do NOT get individual GitHub issues. Instead, tasks are reflected as checklist items in their parent User Story issue body. This agent syncs tasks.md into the appropriate User Story and Feature issue bodies.

## Outline

### 1. Load Context

Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` from repo root and parse FEATURE_DIR and AVAILABLE_DOCS list. All paths must be absolute. For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

From the executed script, extract the path to **tasks.md**. Read the file.

### 2. Verify GitHub Remote

Get the Git remote by running:

```bash
git config --get remote.origin.url
```

> [!CAUTION]
> ONLY PROCEED TO NEXT STEPS IF THE REMOTE IS A GITHUB URL

Extract the owner and repo from the remote URL.

> [!CAUTION]
> UNDER NO CIRCUMSTANCES EVER MODIFY ISSUES IN REPOSITORIES THAT DO NOT MATCH THE REMOTE URL

### 3. Parse Tasks and Map to Issues

Read tasks.md and build a mapping:

- **Phase grouping**: Identify which phase each task belongs to (Setup, Foundational, US1, US2, US3, Polish, etc.)
- **User Story mapping**: Map tasks to their User Story by the `[US1]`, `[US2]`, `[US3]` markers in the task description. Tasks without a story marker are shared/cross-cutting.
- **Completion state**: Parse `[x]` (done) vs `[ ]` (not done) from each task line.
- **GitHub Issues header**: Read the `**GitHub Issues**:` line at the top of tasks.md to find the User Story issue numbers (e.g., `#33 (U2-1, US1 P1), #34 (U2-2, US2 P2), #35 (U2-3, US3 P3)`).

### 4. Read Feature Issue

Read plan.md to find the Feature issue number (from the Summary section or GitHub Issues references). The Feature issue gets shared/cross-cutting tasks (Setup, Foundational, Polish phases).

### 5. Build Task Checklists

For each User Story issue, build a Markdown checklist section:

```markdown
### Tasks

- [x] T001 — Short description
- [ ] T002 — Short description
```

For the Feature issue, build checklist sections for shared tasks:

```markdown
### Shared Tasks (Setup & Foundational)

Phase 1 — Setup:
- [x] T001 — Short description

Phase 2 — Foundational:
- [x] T005 — Short description

### Cross-Cutting Tasks (Polish)

- [ ] T041 — Short description
```

Task descriptions in checklists should be concise (one line) — use the task ID and a short summary, not the full multi-line description from tasks.md.

### 6. Update Issue Bodies

For each User Story and Feature issue:

1. Read the current issue body using `issue_read` with `method: get`.
2. If a `### Tasks` section already exists, replace it with the updated checklist.
3. If no `### Tasks` section exists, append it before `### Success Criteria` (or at the end if that section doesn't exist).
4. Write the updated body using `issue_write` with `method: update`.

> [!IMPORTANT]
> Preserve ALL existing content in the issue body. Only add/replace the Tasks checklist section. Do not remove or modify any other sections.

### 7. Report Results

After updating all issues, output a summary:

```
Synced tasks.md → GitHub issues:
  #33 (US1): 10 tasks (10 complete, 0 remaining)
  #34 (US2): 6 tasks (0 complete, 6 remaining)
  #35 (US3): 8 tasks (0 complete, 8 remaining)
  #4 (Feature): 16 shared tasks (16 complete, 0 remaining) + 6 polish tasks (0 complete, 6 remaining)
```
