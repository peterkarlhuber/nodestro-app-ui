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
- `src/manifest.json`, the deterministic artifact `nodestro-app-ui-<version>.tgz` with its SHA-256, lint, unit and
  browser tests (axe), CI.

### Changed

- Asset paths are relative (`ui/assets/...` instead of `/ui/assets/...`).
- The first status request after a broken event stream tells a lost connection from a reconnecting stream; the
  browser's offline and online events are followed.
