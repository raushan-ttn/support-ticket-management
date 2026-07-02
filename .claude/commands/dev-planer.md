---
description: Generate a file-level implementation plan for a backend feature using the feature-planner agent
argument-hint: <feature name or description>
---

You are generating an implementation plan for the Support Ticket Management backend. The feature to plan is:

**$ARGUMENTS**

## Steps

### 1 — Fetch requirements (optional but recommended)

Call the `requirement-fetcher` agent with the feature above. It returns the relevant requirement IDs, RBAC/validation/cache rules, test IDs, and matching `task.md` phase with done/pending status.

- If the feature is already fully done in `task.md` (all items `[x]`), stop and tell the user — no plan needed.
- If no matching requirements are found, proceed to Step 2 but note that the plan will be based on the feature description alone.

### 2 — Generate the plan

Call the `feature-planner` agent. Pass:
- The feature name: **$ARGUMENTS**
- The requirement IDs from Step 1 (if found), so the planner does not re-derive them

The planner will read the schema, auth module, and all rules, then save a complete plan to `.claude/plans/{feature-slug}.md`.

### 3 — Report

After the plan is saved, print:
- The saved plan path
- A short summary: what will be built, which files will be created/modified, and the ordered next steps from the plan

Remind the user they can run `/build-feature $ARGUMENTS` to execute the full pipeline (requirements → plan → implement → review → docs), or invoke `feature-implementer` directly with the plan slug when ready to code.
