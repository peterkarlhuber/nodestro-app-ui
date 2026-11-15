# The artifact and how nodestro-api embeds it

`npm run build` writes `dist/nodestro-app-ui-<version>.tgz`, `dist/nodestro-app-ui-<version>.tgz.sha256` and
`dist/manifest.json`. The archive holds `manifest.json` and every file of `src/` at the top level, in sorted order,
with fixed time, owner and mode, gzip without name and time: the same files give the same bytes on every platform (the
CI builds twice and compares).

`src/manifest.json` lists `name`, `version`, `contract` (`min`, `max`), `languages` and each file with `path`, `size`
and `sha256`. It is generated (`npm run manifest`) and checked in CI (`npm run manifest:check`).

## Embedding

There are no releases yet, so `nodestro-api` embeds the interface of a given commit of this repository:
`scripts/vendor_app_ui.py --commit <sha>` there downloads the repository at that commit, copies `src/` to
`src/nodestro_api/webui/`, checks every file against `manifest.json` and writes `VENDORED.md` (commit, version, hash of
the manifest). Its CI checks the embedded files against the manifest, offline. The commit is also recorded in the
studio lock (`platform/versions.json`, `nodestro-app-ui`). Rolling back means embedding the previous commit.

Once releases are allowed, the same script can take the release archive and its `.sha256` instead.
