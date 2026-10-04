# REPORT — parlor-cloudflare-workers-01

**Branch** `worker/parlor-cloudflare-workers-01`, cut from `master` at `5409760`.
Four commits, tree clean, nothing pushed, no other worktree touched.

```
9b97ef5 vitest's include: the `server/` glob is removed, and what it used to match is named
7aad595 AGENTS.md and README.md: the Cloudflare deploy, and no `npm start` as a lie
a511ad2 the hand-rolled Node server is gone, and the Dockerfile keeps working anyway
91b19ae the Cloudflare Workers build, green: plugin in the documented position, wrangler.jsonc
```

## The gate, as it actually finished

`./bin/prime` exited **0**, with all three of its proofs on the line:

```
Tests  781 passed (781)
47 checks declared, 47 passed, 0 failed, 0 skipped
self_test: 52 breakages declared, 52 proven able to fail, 0 unprovable on this machine
```

`npx tsc --noEmit` clean. `npm run build` exit 0. `npm run build:node` exit 0.
`npx wrangler deploy --dry-run` exit 0 — **no Cloudflare credentials were used and
nothing was logged into**. No deploy was run.

**I ran `./bin/prime` twice, not once.** The first run I piped through `tail` and
lost the exit code (`${PIPESTATUS[0]}` is a bash-ism that does not fire in zsh), so
I had a tail and no verdict. A tail is not evidence and this repository says so
out loud, so I re-ran it capturing the code properly. Flagging it because the brief
said once and I want the deviation on the record rather than buried.

## 1. The build output shape, before and after

| | before | after (Cloudflare, default) | after (Node, `build:node`) |
|---|---|---|---|
| server | `dist/server/server.mjs` 706 kB | `dist/server/index.mjs` 706 kB | `.output/server/index.mjs` + 35 chunks |
| deploy config | — | `dist/server/wrangler.json`, **written by the plugin** | `.output/nitro.json` |
| main | — | `"main": "index.mjs"`, `"assets": {"directory": "../client"}`, `"no_bundle": true` | — |
| client | `dist/client/assets/` | unchanged | `.output/public/assets/` |
| webfonts | 118 `.woff2` in `dist/client/assets/files/` | **118, unchanged** | **118** in `.output/public/assets/files/` |
| entry | `node server/index.mjs` | `wrangler deploy` | `node .output/server/index.mjs` |

`dist/client` being untouched is load-bearing, not cosmetic:
`src/app/v1/[...path]/route.test.ts`'s two build-level assertions byte-search the
**built** client chunks for `NEXT_PUBLIC_` and for the upstreams' hostnames, and
they still look at the directory they were written for.

## 2. The `process.env` call-site audit — the brief's warning, measured

**There is exactly one place in `src/` that reads `process.env`, and it reads it at
module scope.** That is the finding.

| site | when | module scope? |
|---|---|---|
| `src/app/v1/[...path]/route.ts:235` `identityUrl()` → `process.env.IDENTITY_URL` | inside `identityUrl()` | **yes** |
| `src/app/v1/[...path]/route.ts:240` `billingUrl()` → `process.env.BILLING_URL` | inside `billingUrl()` | **yes** |
| `src/lib/identity.ts:41` | a comment naming it | n/a |
| `src/app/v1/[...path]/route.test.ts:88-89` | asserts the source *contains* the strings | n/a |
| `server/index.mjs:18-19` (`PORT`/`HOSTNAME`) | module scope — **file deleted** | n/a |

The functions are *called* from a module-scope `const`:

```ts
const forward = createUpstreamForwarder({
  identityUrl: identityUrl(),   // <- evaluates process.env at import time
  billingUrl: billingUrl(),
});
```

So the brief's stated safe pattern ("reads it *inside the request handler*") is
**not** what this tree does. `route.ts`'s own header is honest about it — *"it is
read once, when this module is first imported, rather than on each request"* — so
the code knows, and the file says so.

**I did not take that on trust.** The guide warns module-scope `process.env`
evaluates to `undefined` even on the server, so I ran the built Worker under
`wrangler dev --local` against a fake identity on `127.0.0.1:16980`:

```
wrangler dev --config dist/server/wrangler.json --var IDENTITY_URL:http://127.0.0.1:16980

GET /v1/me      -> 200 {"marker":"REACHED-THE-FAKE-IDENTITY","url":"/v1/me"}
POST /v1/session-> 200 {"marker":"REACHED-THE-FAKE-IDENTITY","url":"/v1/session"}
GET /v1/probe/abc -> 404, and the fake identity never saw it
```

**Negative control**, same build, no `--var` — wrangler does not pass the shell
environment in, so `IDENTITY_URL` is genuinely absent:

```
GET /v1/me -> 502 upstream_unavailable   (fell back to DEFAULT_IDENTITY_URL)
```

The pair says the module-scope read **works** here, under `nodejs_compat` at
compatibility date 2025-09-02, and that when the value is missing the fallback
silently points at `http://localhost:8080` rather than failing loudly.

Two things I want to be exact about:

- **The `GET /v1/probe/abc` → 404 is the more interesting line.** The BFF's
  allow-list refuses that route *before an address is contacted*, and that
  property now holds on workerd, not only in jsdom. It is the security argument of
  the whole packet re-verified on the new runtime.
- **I mislabelled one intermediate result to myself and corrected it.** I had
  printed a "negative control" that was actually the same still-running session
  carrying `--var`, so it returned 200. The real control is the 502 above. The
  pair is what I am reporting; the discarded one was not evidence.

**What the fix would be, if a successor wants one** — deliberately not applied, per
the brief. Not a `cloudflare:workers` import: that would break the Node target
this tree still ships, and is a larger decision than this packet. The minimal fix is
to make the read per-request while keeping the "built once" property the comment
cares about — a lazily-initialised module-scope singleton:

```ts
let forward: Forwarder | undefined;
function getForward() {
  return (forward ??= createUpstreamForwarder({ identityUrl: identityUrl(), billingUrl: billingUrl() }));
}
```

That is a change to the BFF, which the brief puts out of scope, so it is reported
rather than done. **The residual risk is named, not dismissed:** this works today,
and the next person to move the read into a request handler would be relying on a
different mechanism that nobody has measured here.

## 3. The Dockerfile decision — **keep it working**, via Nitro

Chosen over retiring it. The argument is a fact in this repository, not a
preference:

```
e2e/docker-compose.yml
  parlor:
    build:
      context: .
      dockerfile: Dockerfile
    image: cafaye/e2e-parlor:local
```

That tier is the **only** thing here that proves the app works against a real
`identity` and a real `billing`. Retiring the Dockerfile would not have been
"dropping a dead deploy target"; it would have deleted the whole-stack tier and
taken the e2e workflow's required job with it. It would also have removed the two
checks `tests/validate-ci.sh` makes *on this Dockerfile* (the node pin, and
`NEXT_PUBLIC_` — both currently PASS, both currently load-bearing) and the five
tests in `src/app/readyz/route.test.ts` that read `config/deploy.yml`'s
healthcheck path.

The Node target is therefore kept on the framework's own documented answer,
`nitro`, and the hand-rolled server is not kept.

**This is scope the manager did not ask for, stated loudly as the brief requires:**
`nitro` is a new dependency (14 packages) and a second build path. The
alternative I rejected was carrying `server/index.mjs` and `server/adapter.mjs`
forward, which keeps the build-path count at one — and that adapter is precisely
what this packet exists to delete, being the place where two `Set-Cookie` headers
get joined with `", "` and where a `..` reaches the filesystem. Two build paths
beat keeping the hand-rolled adapter.

**One cost I want on the record:** `nitro-nightly` is an unpinned nightly
(`3.0.1-20261004-132833`), which is what the framework's guide spells and which
can move under this lockfile. Pinning it is a manager decision I did not make.

**Verified rather than asserted:** the image's build path is `npm run build:node`,
`CMD` is `node .output/server/index.mjs`, and the server **boots** —
`/healthz` 200, `/readyz` 200, `/login` 200, `/v1/me` 502 (nothing listening, the
correct failure). I did **not** run `docker build`; docker is not required by this
gate and the e2e tier is what builds this image.

### The defect this found

`npm run build:node` exits 0 and the server boots — and shipped **zero webfonts**:

```
find .output/public -name '*.woff2' | wc -l   ->  0
grep -o 'url([^)]*woff2[^)]*)' .output/public/assets/*.css
  -> url(./files/geist-cyrillic-ext-wght-normal.woff2)   (and 117 more)
```

Nitro populates `.output/public` by copying `dist/client` *during* the build;
`copyFontFiles` ran in `closeBundle`, which is **after** it, so the hook was
writing 118 files into a directory nothing served. Every page unstyled, every
route answering, `/healthz` green — the exact failure that hook exists to prevent,
arriving by a different route, and invisible to a green build. Fixed by passing the
destination in (`copyFontFiles(".output/public/assets/files")`), re-measured at
118, with `GET /assets/files/geist-…woff2` → 200 `font/woff2`, and now asserted in
CI against `.output/public` rather than `dist/client`.

## 4. Deliberately not done

- **No `prerender`, no `ssr: false`, no SPA mode, no `defaultSsr`.** A static build
  is a security regression here, not a simplification: the BFF reads
  `process.env.IDENTITY_URL` server-side and rebuilds the upstream path from an
  allow-list, so static means the browser gets the address baked in — and
  `route.ts`'s own header says "a value the browser can read is a value the
  browser can change, and for a forwarder that is the difference between a fixed
  destination and an attacker's." `/healthz` and `/readyz` are runtime checks and
  could not be prerendered anyway.
- **No change to `src/lib/upstream.ts` or `src/routes/v1/$.ts`.** The BFF is
  correct as it is. I re-verified its allow-list on workerd rather than editing it.
- **The module-scope `process.env` read is left alone**, with the measurement and
  the fix written down. Changing the BFF is a different packet.
- **No real deploy, no login, no credentials.** `wrangler deploy --dry-run` only.
- **No `npm ci`** (the brief forbids it) — `npm install <pkg>` for the three.
- **No other floor moved.** Verified rather than trusted:
  `grep 'server/adapter\|server/index' tests/validate-ci.sh` returns nothing, so
  the 47-check floor and the 52-breakage floor are untouched, and both still read
  the same numbers they did before.
- **`cafaye/site` untouched.**
- **No agents, sub-agents or subprocesses spawned.**

## Findings for the manager

1. **`route.ts` reads `process.env` at module scope, not per request.** It works
   on this runtime, measured with a positive/negative pair. Flagged because the
   file's header and the framework's guide disagree about it, and the next edit to
   that `const` could break it silently.
2. **The suite floor moved DOWN for the first time: 798 → 781**, exactly the 17
   tests in the deleted `server/adapter.test.mjs`. `gate.yml` records why, what
   those 17 asserted, and — the part worth your attention — **that nothing replaces
   them**: `nitro` is not this repository's code, so two `Set-Cookie` headers
   staying two, `duplex: "half"` on a streamed POST, a `..` refused at the
   filesystem boundary, and `/assets/*` being served at all are no longer asserted
   anywhere. That is a real gap, named rather than absorbed.
3. **Two build paths now exist** (`build`, `build:node`) and the gate only runs
   one. CI's `build` job runs both. A `bin/prime` regression in the Node target
   would be caught by CI but not by the per-commit gate — the same class of
   asymmetry the e2e tier has, and the same shape of decision.
4. **`nitro-nightly` is unpinned.**
5. **`scripts.start` is deleted**, so any external thing calling `npm start`
   against this repository breaks. Called out because `cafaye/site` inherits this
   tree.
6. **Not verified, and I will not claim it:** a real `wrangler deploy`, and
   `docker build` of the modified Dockerfile. Both need an environment this gate
   does not have.