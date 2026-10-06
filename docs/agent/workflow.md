# Workflow

## Branching

- Feature branches off `main`. Name like `feat/<short-description>`, `fix/<short-description>`, etc.
- One logical change per PR.

## Commit messages

Conventional Commits. Types in use:

| Type | When |
|------|------|
| `feat:` | New capability or content type. |
| `fix:` | Bug fix. |
| `refactor:` | Internal restructure with no behavior change. |
| `chore:` | Tooling, deps, config. |
| `docs:` | Documentation only. |
| `test:` | Test-only changes. |

Scope optional but useful: `feat(adf): ...`, `fix(notion): ...`, `feat(sidepanel): ...`.

Subject line ≤ 72 chars, imperative mood. Body explains **why**, wrapped at 72.

## Author

All commits authored as:

```
emmaliaocode <wanyuliao4@gmail.com>
```

Pass via `git -c` if your global identity differs:

```bash
git -c user.email="wanyuliao4@gmail.com" -c user.name="emmaliaocode" commit -m "..."
```

No `Co-Authored-By` trailers. No AI attribution.

## Pre-commit checks

Before every commit:

```bash
pnpm test
pnpm tsc --noEmit
pnpm build
```

If the change touches the UI or content conversion, also reload the extension in Chrome and run the relevant section of [`docs/superpowers/qa/smoke-checklist.md`](../superpowers/qa/smoke-checklist.md).

## PR description template

```
## Summary

<1-3 bullets describing the change>

## Why

<the user-visible problem or motivating use case>

## Test plan

- [ ] `pnpm test` (count)
- [ ] `pnpm tsc --noEmit`
- [ ] `pnpm build`
- [ ] Manual: <smoke item if applicable>
```

## After merging

- The `worktree-*` branch can be discarded.
- The Chrome extension must be rebuilt and reloaded by anyone using the new version.

## TDD discipline

For bug fixes: write the failing test first, watch it fail, then fix. See [testing-strategy.md](testing-strategy.md).

For new content types: write the IR test in `tests/ir-types.test.ts`, then the parser test, then the renderer test(s), then implementation.

## Gotchas during development

- Chrome does not auto-reload extensions. After `pnpm build`, click the reload icon on the extension card in `chrome://extensions`.
- Side panel state resets on reload, but `chrome.storage.local` persists.
- When debugging the service worker, click **service worker** on the extension card to open its DevTools. The worker is killed after 30s of idle — click again to wake it.
- WXT writes the manifest to `.output/chrome-mv3/manifest.json` on every build. If something looks wrong with permissions, read that file directly.
