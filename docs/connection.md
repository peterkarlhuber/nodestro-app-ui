# The connection to the backend

`src/connection.js` holds what the interface knows about its backend; `src/app.js` drives it.

## States

| State | Meaning | Shown |
|---|---|---|
| `connecting` | Asking the backend | "Connecting ..." |
| `auth_required` | No session: the sign-in page shows | "Sign-in needed" |
| `connected` | Discovery, sign-in and the app info worked | "Connected to <backend name>" |
| `degraded` | Connected, but no live view (no `events.sse`, or the event stream gave up and the page polls) | "Connected, live view off" |
| `disconnected` | A request did not reach the backend | Banner, retries after 1, 2, 4, 8, 15, 30, 30 ... s; "Try again" |
| `error` | The backend answered with an error while connecting | Banner with "Try again" |
| `incompatible` | No contract version in common | "Backend version not compatible (app v1, backend v2). Update the interface." |

`TRANSITIONS` in `connection.js` lists which state may follow which; `connected` is reached only through
`connecting` (or back from `degraded`), so the status line never says "connected" before discovery, sign-in and app
info all worked. An incompatible backend is left only by a new attempt (a reload).

## Order at start

1. `GET /ui/api/bootstrap` (public): name, languages, whether a session exists. No session: `auth_required`.
2. `GET /ui/api/config` (session): the interface's settings, `api_base`.
3. `GET /api/app` (session cookie): contract versions, backend ID, name and versions, capabilities. `404`: a backend
   without the contract (compatibility mode, the form of step 2). No shared version: `incompatible`.
4. `GET /api/published/{slug}`: the app info with `form` (`form_version` 1), mapped by `fieldsFromForm` to the names
   the form renderer reads (the same mapping as the backend's `ui_form_fields`). Any answer other than a network
   failure or `401` keeps the form of step 2.

## Lost connection

A request that fails without an answer (or the browser's `offline` event) moves to `disconnected`: the banner says
whether a run continues on the backend, and the next attempt waits longer each time up to 30 s. A successful attempt
checks the session (`bootstrap`), runs steps 3 and 4 again and reopens the live view of a running run. The first error
of an event stream triggers one status request, which tells a lost connection from a stream that reconnects by itself.

## Later steps

`BackendConnection` takes a base address (`base`, empty: the page's own origin) and its own `fetch`, so pairing
(NAL-C4) or another backend (NAL-C5) can supply another address and sign-in without changing `app.js`.
