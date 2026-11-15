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
| `src/standalone.js` | The interface on its own origin: list of backends, token session, event stream over fetch |
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
npm run build:standalone # dist/standalone/: the interface for a static host of its own (NAL-C5)
```

To try the interface by hand, start the stand-in backend from a Node prompt
(`(await import("./test/e2e/mock-backend.mjs")).startMock()`) and sign in with the key `ndk_test_good`.

## On a static host of its own (NAL-C5, preview)

`npm run build:standalone` writes `dist/standalone/` (`index.html` and `ui/assets/`): the same files with
`<meta name="nodestro-mode" content="standalone">` and a Content Security Policy in a meta element (`connect-src`
only `https:` and `http://localhost`/`127.0.0.1`, Trusted Types). The interface then keeps a list of backends (name,
address, fingerprint; never a key or token), pairs with a code and holds a 15-minute access token in memory only.
The protocol and its threat model are in `docs/cross-origin.md` of nodestro-api. Each backend must switch it on
(`NODESTRO_CROSS_ORIGIN=on` and `NODESTRO_PAIRING=on`, both off by default until the independent review D1) and allow
the interface's origin (`start.sh origins add https://apps.example`).

The static host must send the headers a meta element cannot set, for example:

```
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=31536000
```

Browsers that block partitioned third-party cookies keep no refresh cookie: the interface then works while the page
is open and asks for a new code afterwards. A backend with a self-issued certificate must be opened once in the same
browser to accept its certificate (after comparing the fingerprint); the interface links to it.

## Versions

`package.json` `version` is the interface's version (shown in "About this app"); `manifest.json` `contract` is the
range of app contract versions it speaks. A change that needs a newer contract raises `contract.min`; a backend
outside the range gets the "not compatible" message instead of a broken page.

## License

Proprietary, see [LICENSE](LICENSE).
