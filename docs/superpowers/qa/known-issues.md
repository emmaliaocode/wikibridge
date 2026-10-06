# WikiBridge — Known Issues

Bugs found post-v1 that have a clear root cause but are deferred to the next iteration.

## CURRENT PAGE doesn't refresh when the active tab changes

**Symptom**: The side panel reads the active tab's URL + title once on mount (`useEffect` with `[]` deps). If the user navigates the same tab to a different Confluence page, or switches to a different tab, the "CURRENT PAGE" line and the resolved `pageId` stay stale. The only workaround today is to close and reopen the side panel.

**Repro**:
1. Open Confluence page A. Open the WikiBridge side panel — it shows page A.
2. Without closing the panel, navigate the same tab to Confluence page B (or click into a different tab that has a different Confluence page open).
3. Side panel still shows page A's title. Hitting Capture would capture page A, not B.

**Root cause**: `src/entrypoints/sidepanel/App.tsx` has a single `useEffect(() => { … chrome.tabs.query(…) …; }, [])` that runs once on mount and never listens for tab changes.

**Fix sketch (next iteration)**:
- Listen to `chrome.tabs.onActivated` (user switched tabs) and `chrome.tabs.onUpdated` (URL of the active tab changed) inside the same `useEffect`.
- On either event, re-query the active tab and update `pageId` + `pageTitle`.
- Clear the `phase` if it's in `done`/`error` state from a previous page, so the user doesn't see stale capture results next to a new page title.
- Remember to remove the listeners on cleanup (`return () => { chrome.tabs.onActivated.removeListener(...); ... }`).

**Acceptance criteria**:
- Switching tabs while the panel is open updates "CURRENT PAGE" within a few hundred ms.
- Navigating the active tab to a different Confluence page updates "CURRENT PAGE".
- Navigating away to a non-Confluence URL shows the "Open a Confluence page in the active tab" prompt and disables Capture.
