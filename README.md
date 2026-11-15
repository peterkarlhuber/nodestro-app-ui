# Nodestro App UI

The standard web interface of exported Nodestro apps: sign-in, the app's form, live progress, approvals, results and
files, the run history and (for the operator of the computer) the settings. Exported projects and portable packages
embed it; `nodestro-api` serves it at `/` and `/ui/assets/`.

- **Plain files, no build step:** HTML, CSS and JavaScript in `src/`, no framework, no runtime dependencies. The
  development tools in `package.json` (Playwright, axe-core) never reach the artifact.
- **App contract:** the interface speaks `nodestro-app/1` (`nodestro-api` `docs/app-api/v1.md`). It discovers the
  backend with `GET /api/app`, refuses a backend without a shared contract version with a clear message, reads the
  app's form from `GET /api/published/{slug}` and falls back to `/ui/api/config` for a backend without the contract.
- **Security stays in the backend:** sessions (HttpOnly cookie), the cross-site header `X-Nodestro-UI`, the Content
  Security Policy (`connect-src 'self'`, no inline script) and every permission check. Results and form texts are
  shown as text, never as HTML (`npm run lint` refuses `innerHTML` and the like).

## Layout

| Path | What |
|---|---|
| `src/index.html`, `src/app.js`, `src/app.css` | The page, its logic and styles |
| `src/connection.js` | `BackendConnection`: discovery, contract check, connection state, form mapping |
| `src/markdown.js` | Markdown to DOM nodes (no HTML strings) |
| `src/i18n/<lang>.json` | Texts in de, en, es, fr, it, pt-BR |
| `src/brand/` | Logos (dark mode uses the white word mark, never a CSS invert) |
| `src/manifest.json` | Name, version, contract range, languages, every file with SHA-256 (generated) |
| `scripts/` | Manifest, deterministic artifact, lint |
| `test/unit/`, `test/e2e/` | Unit tests (Node) and browser tests against a stand-in backend |
| `docs/` | How the interface works ([connection](docs/connection.md), [artifact](docs/artifact.md)) |

Asset paths are relative (`ui/assets/app.css`), so the same files work wherever the backend serves the page.

## Development

```sh
npm ci
npm run lint            # syntax, safety rules, relative paths, translations
npm test                # unit tests
npm run manifest        # after changing anything in src/
npx playwright install chromium
npm run e2e             # browser tests (CHROMIUM_PATH=... to use an installed Chromium)
npm run build           # dist/nodestro-app-ui-<version>.tgz, .sha256 and manifest.json
```

To try the interface by hand, start the stand-in backend from a Node prompt
(`(await import("./test/e2e/mock-backend.mjs")).startMock()`) and sign in with the key `ndk_test_good`.

## Versions

`package.json` `version` is the interface's version (shown in "About this app"); `manifest.json` `contract` is the
range of app contract versions it speaks. A change that needs a newer contract raises `contract.min`; a backend
outside the range gets the "not compatible" message instead of a broken page.

## License

Proprietary, see [LICENSE](LICENSE).
