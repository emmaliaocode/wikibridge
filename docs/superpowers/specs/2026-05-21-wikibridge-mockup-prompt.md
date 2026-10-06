# WikiBridge — Side Panel Mockup Prompt

For use with nanobanana (or any image-generation model) to produce a polished visual mockup of the v1 side panel.

## Prompt

> A clean, minimal Chrome browser side panel UI mockup for a Chrome extension called "WikiBridge". The panel is approximately 380px wide and full browser height, with a soft off-white background (#fafafa) and rounded inner cards. At the top, a slim header bar shows the wordmark "WikiBridge" on the left in a modern sans-serif font (Inter or similar, 16px, weight 600) and a small gear icon on the right.
>
> Below the header, a labeled section "CURRENT PAGE" (uppercase, 11px, gray) shows a single line of page title text: "Design Doc — Auth v2" with a small Confluence-blue dot indicating the detected source.
>
> Next section "SAVE TO" has two segmented pill buttons side-by-side: "Notion" (selected, with a subtle green accent border and a black Notion logomark) and "Local file" (unselected, gray outline, folder icon).
>
> Below the destination picker, a contextual sub-section "PARENT PAGE" with a dropdown styled as a rounded rectangle reading "Engineering Wiki ▾".
>
> At the bottom of the panel, a large full-width primary button reads "Capture page" in white text on a deep teal (#0a7d6a) background, with a right-arrow icon. Empty space below for progress / status messages.
>
> Use generous padding (16px), subtle hairline dividers (#ececec), and a soft drop shadow on the card. Style: modern, calm, Linear / Notion / Raycast inspired. Light mode. No browser chrome around the panel — just the panel itself.

## Notes

- After the mockup is generated, paste the image back into the WikiBridge conversation. The visual will be used to refine: spacing, typography, button states (idle / hover / loading), and the "after capture" success/failure summary view.
- A second prompt may follow for the dark-mode variant once the light-mode design is approved.
