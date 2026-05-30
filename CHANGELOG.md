# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **Agent narrated actions instead of performing them**: on multi-step tasks the model would end a turn with "Now I need to click on it" and print the selector as text (e.g. `a[aria-label="TVM"]`) without emitting the `clickElement` tool call — so the run stopped early and goal verification reported GOAL FAILED. Hardened the system prompt with an "ACT, DON'T ANNOUNCE" rule: announcing an action (or quoting a selector you intend to use) requires emitting that tool call in the same turn, and the agent must keep calling tools until the request is actually answered. Also removed the "call highlightElement before clicking" guidance (the confirm UI now highlights automatically), which had added an extra step where the agent could stall.
- **Tool firewall could not actually stop a tool call** (critical): the `onAsk` handler returns a boolean (`false` on Stop/deny), but lemura only blocked on the exact string `'deny'`, so denials fell through and the tool executed anyway. Fixed in lemura `1.5.3` (fail-safe firewall: only an explicit accept runs the tool). chromai now depends on `lemura@^1.5.3`.
- **Focus region was ignored by action tools**: `clickElement`, `typeText`, `fillForm`, `submitForm`, `pressKey`, `scrollPage`, and `highlightElement` resolved their selector against the whole document, ignoring the active focus region. They now resolve the selector inside the region root first and fall back to the whole page only when not found there (so deeply-nested/ambiguous selectors hit the right element, while portaled dialogs still work).

- **Confirm dialog highlighted nothing useful**: the "Action required" modal showed an indigo highlight that auto-cleared after 2.5s (often before the user decided), ignored the focus region, didn't scroll the element into view, and only marked the first field of a multi-field fillForm — so users were approving blind. The confirm now draws a **persistent, pulsing red border** on the *exact* element(s) the action will touch (region-aware, all fillForm fields), **scrolls the first target into view**, and keeps it up for the whole decision (cleared on confirm/cancel/Stop). If the target can't be located, the modal warns instead of silently approving.

### Added
- **Focus region auto-expands to dialogs**: when a click opens a dialog/modal that renders outside the focus region (`role="dialog"`, `aria-modal`, `<dialog open>`), the region automatically follows it so the agent can keep acting inside the modal. The sidebar pill and highlight update to the new region.
- **Confirm modal is keyboard-ready**: the Confirm button is autofocused, **Enter** confirms and **Escape** cancels, so the user never has to hunt for the button.

## [1.2.0] - 2026-05-13

### Added
- **Visual Context**: New visual context feature with goal planning and tool call display settings.
- **New Page Interaction Tools**: `classifyPage`, `dismissOverlay`, `findCommentBox`, `searchOnPage`, and `readThread` for richer page understanding.
- **Markdown Rendering**: Support for rendering images and tables in chat messages.
- **Voice Input**: Microphone permission UI and handling logic for voice input.

## [1.1.0] - 2026-05-08

### Added
- **Focus Region Picker**: Interactive element picker to define a focused editing region on the page.
- **Region Highlight**: Visual region highlighting with scrollable ancestor detection.
- **`writeToRegion`**: New tool to write content directly into a focused region.
- **Agent Traceability**: Enhanced tracing of agent actions for easier debugging.

### Improved
- Element selector logic for better uniqueness and stability.
- Form filling interaction handling with improved native event compatibility.
- Focus region and clear button styles.

## [1.0.0] - 2026-05-02

### Added
- Initial release of ChromAI.
- AI-powered sidebar for web page analysis and interaction.
- Support for manifest V3.
- Automatic build and release pipeline via GitHub Actions.
- Comprehensive privacy policy and store assets.

### Features
- **Contextual Understanding**: Reads and understands the active tab's content.
- **Smart Sidebar**: Persistent AI assistant interface.
- **Settings Dashboard**: User-configurable settings and API keys.
- **Privacy First**: Local storage and clear data usage policies.
