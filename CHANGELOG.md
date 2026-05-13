# Changelog

All notable changes to this project will be documented in this file.

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
