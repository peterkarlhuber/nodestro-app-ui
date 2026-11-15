# TODO: nodestro-app-ui

> Open work for this repository. GitHub issues are the source of truth for details; this file is the entry point and
> summary. Same rules as the other Nodestro repositories (see "Maintaining this file").
>
> **Created:** 2026-11-15 with the NAL consolidation, against master after #9.

## Summary

| Priority | Count |
|---|---|
| P0 Critical | 0 |
| P1 High | 0 |
| P2 Medium | 1 |
| P3 Low | 0 |
| P4 Optional | 2 |

**Release blockers:** None. The interface ships embedded in nodestro-api (`scripts/vendor_app_ui.py` there).

## Security

### UI-001 · Pairing and the standalone interface need the independent review first

- **Priority:** P2 Medium · **Status:** Needs external review · **Refs:** NAL-C4 (#6), NAL-C5 (#7, #8), nodestro-api
  `docs/pairing.md` and `docs/cross-origin.md`, nodestro-studio `docs/security/nal/p-pair.md` (ST-064)
- **What:** The pairing views and the standalone form (`npm run build:standalone`) work only while the backend's
  `NODESTRO_PAIRING` (and for the standalone form `NODESTRO_CROSS_ORIGIN`) is on; both stay off for productive use
  until the review P-Pair. Accepted residual risks: an XSS in the interface can use the token and cookie while the
  page is open; the fingerprint comparison does not stop an active man in the middle; the static host is trusted;
  browsers that block partitioned third-party cookies pair again after the page is closed.
- **Next step:** The owner decides on the review; nothing to do here until its findings.

## Features and enhancements

### UI-002 · Drafts and result previews in exported apps

- **Priority:** P4 Optional · **Status:** Open · **Refs:** NAL-A4, NAL-C2
- **What:** Exported apps list result files without a preview, so e-mail and webhook drafts (NAL-A4) show only as
  files.
- **Next step:** Add a preview of result files when exported apps should show them.

### UI-003 · App languages from the contract

- **Priority:** P4 Optional · **Status:** Open · **Refs:** NAL-C1, nodestro-api API-070
- **What:** `AppSummary.languages` is always empty, so the interface cannot offer an app's own languages yet.
- **Next step:** Use the field once apps declare languages.

## Maintaining this file

- Add an entry when work is identified but not done in the current PR. Use the next free ID; IDs are never reused.
- When an item is finished, delete its entry in the PR that completes it and mention the ID in the PR description.
- Security issues that are not yet fixed are described only in general terms here. Report details privately
  (GitHub private vulnerability reporting), never in this file or in public issues.
