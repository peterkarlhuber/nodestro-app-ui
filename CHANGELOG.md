# Changelog

## Unreleased

### Fixed

- File fields showed accepted extensions with two dots (`..pdf`), in the file picker's filter and the drop zone's
  title, because the contract already sends them with their dot.

### Added

- The interface on its own origin (NAL-C5, behind `NODESTRO_CROSS_ORIGIN` in the backend, off by default):
  `npm run build:standalone` writes a form for a static host with the standalone mode and a meta Content Security
  Policy with Trusted Types. `src/standalone.js` keeps a list of backends in `localStorage` (name, address,
  fingerprint, never a secret), pairs with a code through `POST /api/app/token`, keeps the access token in memory
  only and renews it from the partitioned refresh cookie under a Web Lock, and reads run events through `fetch`.
  The view "Backends" adds, renames, removes (revoking the device there, also through its refresh cookie) and
  switches backends; a pairing link of `pair --ui` names the backend, and a backend not yet in the list is added only
  after the person confirms its address. The event reader drops an event larger than 1 MiB.
  The fingerprint of a self-issued certificate is kept at the first pairing and compared from then on. Texts in six
  languages, including the launcher's `origins` messages.
- The embedded interface's policy (and the stand-in backend's) gains `require-trusted-types-for 'script';
  trusted-types 'none'`: the interface writes no HTML from strings.
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
