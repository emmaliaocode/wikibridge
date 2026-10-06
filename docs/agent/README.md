# WikiBridge — Agent Documentation

Chrome MV3 extension that captures Confluence Cloud pages and republishes them to Notion or local Markdown. Built with WXT + React 19 + TypeScript.

## First-time reading order

New to this codebase? Read these four in order before touching code:

1. [scope-and-principles.md](scope-and-principles.md) — what's in/out of scope, mandatory constraints, what's forbidden.
2. [architecture/overview.md](architecture/overview.md) — the three layers and the component map.
3. [architecture/ir.md](architecture/ir.md) — the IR contract between sources and destinations. Everything else builds on this.
4. [workflow.md](workflow.md) — branching, commit, test gates before any PR.

After that, jump to the task-specific doc via the table below.

## Navigation

Read the doc that matches your task. Each doc is self-contained but cross-references others when needed.

| Task | Start here |
|------|------------|
| Get the extension running locally | [quickstart.md](quickstart.md) |
| Understand the overall architecture | [architecture/overview.md](architecture/overview.md) |
| Modify the ADF parser or add an ADF node type | [architecture/source-confluence.md](architecture/source-confluence.md) |
| Modify Notion output, hit a Notion API limit, or change block mapping | [architecture/destination-notion.md](architecture/destination-notion.md) |
| Modify Markdown output | [architecture/destination-local.md](architecture/destination-local.md) |
| Change UI or capture flow | [architecture/side-panel.md](architecture/side-panel.md) |
| Change token settings UI | [architecture/options-page.md](architecture/options-page.md) |
| Touch the service worker / messaging | [architecture/background-service-worker.md](architecture/background-service-worker.md) and [architecture/messaging.md](architecture/messaging.md) |
| Add a new destination (Obsidian, etc.) | [features/extending-with-new-destination.md](features/extending-with-new-destination.md) |
| Write or modify a test | [testing-strategy.md](testing-strategy.md) |
| Commit, PR, or release | [workflow.md](workflow.md) |
| Code style / lint / type rules | [coding-standards.md](coding-standards.md) |
| What's in/out of scope | [scope-and-principles.md](scope-and-principles.md) |
| Manifest, permissions, MV3 quirks | [extension-manifest.md](extension-manifest.md) |

## Existing references

| Path | Purpose |
|------|---------|
| `docs/superpowers/specs/2026-05-21-wikibridge-design.md` | Original design spec. Partially stale — code is the source of truth where they disagree. |
| `docs/superpowers/plans/2026-05-21-wikibridge.md` | Historical implementation plan, task-by-task. |
| `docs/superpowers/qa/smoke-checklist.md` | Manual end-to-end smoke test. Run after any UI or content-conversion change. |
| `docs/superpowers/qa/known-issues.md` | Open known issues with reproduction steps. |

## IR contract

The intermediate representation in [`src/ir/types.ts`](../../src/ir/types.ts) is the contract between sources and destinations. Adding a new content type touches it; routine bug fixes don't. See [architecture/ir.md](architecture/ir.md).
