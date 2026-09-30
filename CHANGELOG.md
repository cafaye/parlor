# Changelog

All notable changes to parlor are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `src/lib/identity.ts` — a typed client for the four identity endpoints fixed by
  contract: `POST /v1/users`, `POST /v1/session`, `DELETE /v1/session`,
  `GET /v1/me`. Base URL from `NEXT_PUBLIC_IDENTITY_URL`, defaulting to
  `http://localhost:8080`. The transport is a parameter, so tests inject a
  stub and the browser gets `fetch`; there is no msw and no request
  interception. Failures arrive as an `IdentityError` carrying the status, the
  reserved `code`, the `trace_id`, and the per-field `{field, code}` list from a
  422 — read from RFC 9457 problem+json, or from the `{error:{…}}` envelope the
  identity-02 brief describes, since the two disagree and neither has shipped.
- `src/lib/token-store.ts` — the session token in `localStorage` under
  `parlor.session.token`, with a subscribe hook for React. A value that does not
  parse reads as signed out rather than throwing.
- `src/lib/auth.tsx` — session state. The token is the React Query cache key
  (`["session", token]`), so a cached user can never be served to a different
  session than the one it was fetched for. A 401 forgets the token; a failure
  that is not a 401 leaves it and reads as signed out.
- `src/app/providers.tsx` — the provider stack (React Query, then auth),
  mounted once from `layout.tsx`. Both the identity client and the token store
  are injectable.
- `/register` — email and password, local validation before the request, and a
  422 placed on the field it belongs to. A 409 says the address is taken, which
  is the one place the answer is safe to give. On success the account is
  confirmed and the password leaves the screen; nothing signs anyone in, because
  `POST /v1/users` returns no token.
- `/login` — the same two fields, and one generic sentence for every refused
  sign in. A wrong password and an unknown address produce byte-identical
  output, and neither is reported on a field, so the screen cannot be used to
  find out who has an account. A service failure does not borrow that sentence:
  it says something went wrong rather than sending someone to reset a password
  that was fine.
- `src/components/shell/header.tsx` — the session-aware shell. Signed in: the
  address and a sign out control. Signed out: sign in and create account. While
  a stored token is being exchanged it renders neither, so a reload does not
  paint a sign-in link over a live session (verified against the prerendered
  HTML, which contains neither state).
- `src/components/ui/{button,input,field}.tsx` — hand-rolled primitives in
  shadcn's shape, one per file, exported from the existing barrel. `Field` owns
  the label/description/invalid wiring so a call site cannot get it half right.
  Every colour is a token from `src/styles/tokens.css`.
- `@tanstack/react-query` as a runtime dependency (the only one this packet
  adds).

### Changed

- `layout.tsx` mounts `Providers` and the shell header above the route content.
- `src/test/setup.ts` clears `localStorage` after every test. The token is read
  synchronously on render, and one test's session leaking into the next would
  make an auth suite pass for the wrong reason.

### Notes for the next packet

- The session token lives in `localStorage` because the cookie identity sets is
  `HttpOnly` and unreachable from the browser bundle. A BFF route in front of
  identity reverses this and makes the cookie the only authority. See README,
  "Sessions".
- No CORS headers, no cookie proxying, no CSRF token: the browser talks to
  identity directly, and that is a later packet.
