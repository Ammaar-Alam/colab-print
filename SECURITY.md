# Security Policy

ColabPrint is a Manifest V3 Chromium extension with a deliberately small permission footprint (`activeTab`, `scripting`). It does not send any data off the user's machine. The generated PDF is constructed locally in the browser and never leaves the device.

## Reporting a vulnerability

If you discover a security issue that could:

- expose a user's notebook contents or credentials beyond what the extension itself needs
- allow a page to elevate to the extension's privileges
- cause the extension to exfiltrate data to a remote endpoint

please report it privately rather than opening a public issue.

Contact: open a private security advisory through [GitHub Security Advisories](https://github.com/ammaar-alam/colab-print/security/advisories/new).

You can expect:

- an acknowledgement within 72 hours
- a fix timeline based on severity
- credit in the release notes if you wish

## Scope

In scope:

- the extension source in this repository
- the runtime behavior of the MV3 service worker, content script, popup, and export page
- any data persisted to `IndexedDB` or `chrome.storage` by this extension

Out of scope:

- issues in Google Colab itself
- issues in Chromium, Chrome, Arc, Brave, Edge, or other Chromium forks
- general browser fingerprinting concerns unrelated to this extension

## Supported versions

The latest released version is supported. Older versions do not receive backported fixes.
