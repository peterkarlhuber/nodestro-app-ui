# Changelog

## Unreleased

### Added

- The interface moved here from `nodestro-api` (NAL-C2, files of `e8c84c4`, see `PROVENANCE.md`).
- `src/connection.js` (`BackendConnection`): discovery with `GET /api/app`, contract version check (`nodestro-app/1`),
  the connection states `disconnected`, `connecting`, `auth_required`, `connected`, `degraded`, `error`,
  `incompatible`, and the form of the app contract (`form_version` 1) with a fallback to `/ui/api/config`.
- Status line in the top bar and the dialog "About this app" (interface version, contract, backend name, ID and
  versions, app release); a banner when the connection is lost ("the run continues") with automatic retries
  (1 s growing to 30 s) and a retry button; a clear message for an incompatible backend. Six languages.
- The launcher's messages for the commands of the folder model of portable packages (NAL-C3: `verify`, `backup`,
  `restore`, `update`, `rollback`, `adopt`, `ui install|reset|status`), six languages.
- Pairing (NAL-C4, behind `NODESTRO_PAIRING` in the backend, off by default): a code form on the sign-in page, filled
  from a pairing link (`/?pair#code=…&fp=…`, the code leaves the address at once), a block when the link's fingerprint
  does not match the backend's (or the backend reports none), renewal of the session from the device cookie (tabs
  renew one after the other under a Web Lock), "Remove this device" instead of
  "Sign out" for a paired browser, and the permanent "restricted trust" notice with the SHA-256 fingerprint for a
  self-issued certificate; "About this app" names the encryption. Six languages, browser tests over HTTPS.
- `src/manifest.json`, the deterministic artifact `nodestro-app-ui-<version>.tgz` with its SHA-256, lint, unit and
  browser tests (axe), CI.

### Changed

- The sign-in is reachable from every state but `incompatible` (a stray `401` while disconnected), and malformed
  form entries are skipped instead of stopping the interface (internal review).

- Asset paths are relative (`ui/assets/...` instead of `/ui/assets/...`).
- The first status request after a broken event stream tells a lost connection from a reconnecting stream; the
  browser's offline and online events are followed.
