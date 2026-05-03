# Contributing to ColabPrint

Thanks for your interest in contributing. ColabPrint is intentionally small, buildless, and dependency-free. These constraints keep the extension easy to audit, easy to trust with a minimal permission set, and pleasant to read. Please keep them in mind when proposing changes.

## Ground rules

1. **No runtime dependencies.** If a feature can be built without adding a package, build it without. The PDF writer, capture pipeline, and UI are all pure vanilla JS on purpose.
2. **Minimal permissions.** The current permission set is `activeTab` and `scripting`. Anything that requires `debugger`, `<all_urls>`, broad host permissions, or background network access needs a strong justification.
3. **Provider code stays isolated.** Colab-specific selectors and DOM assumptions live in `src/content/main.js` and `src/shared/provider.js`. The compositor and PDF writer should remain provider-agnostic.
4. **Keep the UI small.** The popup is intentionally minimal. New options need a reason, not a surface.

## Local setup

This project is buildless. You do not need `npm install`.

```bash
# syntax-check all source files
npm run check
```

To load the extension:

1. Open your browser's extensions page (e.g. `chrome://extensions`).
2. Enable **Developer Mode**.
3. Click **Load unpacked** and select the repo root.
4. Pin the extension to the toolbar.

Reload the extension from the extensions page after code changes.

## Opening a PR

- Open an issue before a large PR so we can align on scope.
- Keep changes focused — one logical change per PR.
- Match existing code style. Two-space indent, single quotes, no semicolon-related opinions worth dying over.
- Include a short note in `CHANGELOG.md` under `[Unreleased]` describing the change.
- Run `npm run check` before pushing.

## Manual testing

At minimum, verify:

- a short Colab notebook exports cleanly
- a long notebook exports without blank paper gaps between pages
- the notebook scroll position is restored after capture
- the overlay and notebook chrome both disappear after the run finishes

If your change touches the capture path or the PDF writer, test at least one light notebook and one dark notebook.

## Reporting bugs

Please include:

- browser and version (Chrome, Arc, Brave, Edge, etc.)
- operating system
- a link to a sample notebook (or a redacted equivalent) that reproduces the issue
- screenshots of the broken PDF and of the notebook as rendered in the tab
- any errors from the extension's service worker console (chrome://extensions → details → service worker → Inspect)

## Security

If you find a vulnerability that could expose a user's notebook contents or credentials beyond what the extension needs, please open a private security advisory rather than a public issue. See `SECURITY.md` for details.

## Code of Conduct

Be kind. Assume good faith. Full text in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
