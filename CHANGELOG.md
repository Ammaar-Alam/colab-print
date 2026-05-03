# Changelog

All notable changes to ColabPrint are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Refined popup and export UI with consistent design tokens.
- Status indicator with ready / busy states in the popup.
- Shimmering progress bar during PDF composition.
- Footer links to docs and issue tracker in both popup and export pages.
- Repository metadata for discoverability (keywords, homepage, bugs, author).
- `CHANGELOG.md`, `CONTRIBUTING.md`, issue and PR templates.

### Changed
- Export page now defaults to a light, neutral theme that smoothly transitions to a dark palette when exporting a dark notebook — no more jarring white-to-black flash.
- Completion state shows page count and file size inline with the status line.

## [0.2.0] — 2026-04

### Added
- Google Colab support with full-notebook capture (auto-scrolling).
- Direct PDF composition via an in-tree PDF writer; no runtime dependencies.
- Theme-aware page backgrounds for light and dark notebooks.
- A4 and US Letter output.
- In-page progress overlay during capture.
- IndexedDB-backed job store for slice persistence between capture and composition.

### Security
- Permissions limited to `activeTab` and `scripting`.
- No host permissions, no background network access.

[Unreleased]: https://github.com/ammaar-alam/colab-print/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ammaar-alam/colab-print/releases/tag/v0.2.0
