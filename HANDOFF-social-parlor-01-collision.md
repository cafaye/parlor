# HANDOFF — social-parlor-01: a second writer is in this worktree

Written by a session that was asked to continue the social-login packet in
`parlor-wt-social-parlor-01` and found another live agent already working the
same packet in the same working tree. **This session committed nothing**, on
purpose: see "Why nothing is committed" below. The tree is currently green
(`tsc` clean, 180 tests passed in the two files this packet touches).

## The collision, with the evidence

Two writers, one working tree, overlapping files:

- `git worktree list` shows `parlor` (master), `parlor-wt-social-parlor-01`
  (this one, branch `wt-social-parlor-01`) and `wt-parlor-prime-01` (a different
  packet).
- `ps` at 18:02 local showed **two** `opencode run --model` processes (PIDs 30690
  and 30805, both started 17:56), plus a `vitest run` (PID 5832) executing in
  `site-wt-social-site-01/node_modules` — the sibling repository's packet.
- File mtimes inside THIS worktree, all uncommitted: `src/lib/identity.test.ts`
  and `src/lib/upstream.test.ts` both 17:57:43 (the same second, neither written
  by this session), `src/lib/identity.ts` 18:01:46, `src/lib/upstream.ts`
  18:01:59 then 18:02:19, `src/lib/upstream.test.ts` again 18:03:38.

The 427 lines added to `src/lib/upstream.test.ts` and the 237 added to
`src/lib/identity.test.ts` are not this session's work. They arrived
mid-session, tests-first, and they are good: they are the spec this packet was
implemented against, and they pin the two things that are easy to get wrong
(which leg redirects, and which leg sets the cookie).

## Why nothing is committed

The working tree is 1158 insertions across those four files and cannot be split
honestly, because the insertions interleave two agents' work line for line. A
commit now would capture one agent's in-flight changes under the other's message,
and the other agent was demonstrably still writing: between 18:02:50 and
18:03:40, while this session was diagnosing a failure, it landed a fix to its own
test file. Committing a file another writer is mid-edit is how a packet ends up
half-reverted.

## What each file's current contents are

| File | Social work in the tree is… | State |
| --- | --- | --- |
| `src/lib/identity.test.ts` | the other writer's, 237 lines | green |
| `src/lib/upstream.test.ts` | the other writer's, 427 lines | green |
| `src/lib/identity.ts` | **this session's**, written to the spec above | green, `tsc` clean |
| `src/lib/upstream.ts` | the other writer's `browserRedirect` design | green, `tsc` clean |

This session wrote `identity.ts` only. It did not write `upstream.ts`'s final
shape: it had put `location` on the global `FORWARDED_RESPONSE_HEADERS` allow
list, and the other writer replaced that with a per-route `browserRedirect?: true`
flag consulted inside `relay(upstream, route)`. **Their design is the better
one**, and this session's own conclusion, as it stands in the tree's comments:
the allow list stays closed at `["content-type", "x-trace-id"]`, the exception is
declared once on the route that means it, and the set of routes that can send a
browser off this origin is readable in one place. Do not "restore" the global
entry — a forwarder that relays a `Location` for any route is the looser
arrangement and this packet is the wrong place to argue for it.

The one argument this session lost, and lost correctly, is the provider segment.
It first closed it to the document's `enum: [google, github]`, which is wrong:
the service answers 404 both for a provider it has no credentials for and for a
name that does not exist, and a closed pattern here would put this app's own
different-looking 404 in front of both, making the two distinguishable and
leaking what a deployment is configured for. The segment is now the slug shape,
and the test named "asks identity about a provider this app does not narrow to
the document's enum" is what holds it there. Both remaining variants of that
argument are worth reading before anyone reopens it.

## A red that appeared and was fixed under this session

At 18:02:50 the narrow tier was 177 passed / 1 failed:

```
FAIL  src/lib/upstream.test.ts > the social surface >
      carries both cookies of a round trip without folding them together
AssertionError: expected '__Host-oauth-state=st_1; Path=/; Max-…'
  to contain '__Host-session=tok_social'
```

The defect was in the test's stub, not in the forwarder. The round-trip stub
decided which leg it was answering with `hop.url.endsWith("/callback")`, but the
callback leg's hop URL carries the rebuilt query string — `.../callback?code=
the-code&state=st_1`, which the test twelve lines above it asserts — so leg two
was answered with leg one's 302 and state cookie. The forwarder had relayed the
request perfectly; the test asked it the wrong question.

At 18:03:38 the other writer changed it to `hop.url.includes("/callback")` with a
comment naming the same reason, and the tier went to 180 passed. Recorded here
because it is the clearest evidence of the collision, and because a session that
found this red at 18:02:50 and reads this file later should know it is stale
rather than re-apply a fix that already landed.

## What the next session should do

1. **Settle who owns this worktree before committing.** Two agents have been
   editing the same four files. One commit for the packet, once that is decided;
   it is not separable, because the table entries, the `browserRedirect` flag, the
   `relay` signature change and the client methods are one change to one security
   property.
2. Read `HANDOFF-social-parlor-01-collision.md`'s two design paragraphs above
   before touching the provider pattern or the `Location` allow-list. Both were
   argued in opposite directions already and both conclusions are load-bearing.
3. Do not touch `src/app/`. It is the pre-migration tree, `vite.config.mts` still
   reads `src/app/globals.css` so it cannot be deleted, and no route in it is
   wired into the router.

## Still unbuilt, deliberately

The packet is transport only. There is no button, no login-form change and no
callback landing page; the UI packet owns all three. Two consequences it needs:

- **The callback is not a page yet.** `GET /v1/auth/oauth/{provider}/callback`
  forwards to identity and relays back a 200 with a JSON body and
  `Set-Cookie: __Host-session`. A browser that lands there today gets raw JSON.
  The callback needs a route on this origin that reads the query and calls
  `completeSocialLogin`.
- **`redirect_uri` is a deployment fact nobody has written down.** identity builds
  it from its own configured public base URL and never from the request's `Host`,
  so the provider brings the browser back wherever identity is configured to
  point. Nothing in this repository declares that address. If it points at
  identity rather than at this origin, the round trip completes and the session
  cookie is set on the wrong origin — which no test in this packet can see,
  because every one of them runs against a stubbed upstream.
