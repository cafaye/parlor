# HANDOFF — parlor-e2e-social-01

The social path is wired, the three tests are written and collected, and
`publish-siblings` builds and pushes all three siblings. **The suite has never
been run against this stack.** Everything below is what the next packet has to
settle, and nothing below is a guess about how the code works — it is a list of
the things this packet could not measure inside its own hour.

## What is NOT verified, stated first because it is the whole risk

`./bin/e2e` was not run. The brief said not to attempt it on a loaded shared
machine and said the packet after this one runs the suite. So:

- the three social tests have **never executed**;
- the stack has never come up with `oauth-stub` in it, so `identity`'s boot with
  seven `OAUTH_*` variables set has never been observed;
- the compose wiring is proven to PARSE (`docker compose config`) and to PUBLISH
  (three images built and pushed), not to RUN.

The first thing that could be wrong is therefore something neither
`bash -n`, nor `docker compose config`, nor `publish-siblings` can see. Treat
the first run as the real test of this packet.

## The five things to watch on the first run

1. **Does `identity` boot at all with the OAuth block present?** Seven
   variables, and one of them is fatal-by-construction: `OAUTH_ENCRYPTION_KEY`
   must decode to exactly 32 bytes, and identity refuses to start on anything
   else *even when no provider is configured*. The value here is 44 base64
   characters of a known SHA-256; if `identity` refuses to boot, that line is
   the first thing to check, and the symptom is a container that exits with a
   config error rather than a readiness timeout.

2. **`/readyz` on 16004 and 16005.** Both stubs are in `READY_SERVICES`, polled
   from the host. If either is unreachable the failure names the port and the
   budget, and the container's own state — distroless, so no in-container probe —
   is in the compose block's `FINDING`.

3. **The `invalid_client` stall.** This is the failure the brief warned about,
   and it is now supposed to be impossible: `oauth-stub` and
   `oauth-stub-github` each carry the client id identity's `OAUTH_GOOGLE_*` and
   `OAUTH_GITHUB_*` name. If a browser stalls on the provider anyway, curl the
   authorize URL directly — the body names `OAUTH_STUB_CLIENT_ID` and there is no
   guessing.

4. **The GitHub token path.** `/github/access_token`, not `/github/token`. The
   wrong path is a **404** with no error body, and it would present as identity
   failing the exchange rather than as a configuration mistake. Confirmed against
   the published image:

   ```
   $ curl -o /dev/null -w '%{http_code}\n' -X POST .../github/access_token   -> 400 (with a valid code and the right client)
   $ curl -o /dev/null -w '%{http_code}\n' -X POST .../github/token         -> 404
   ```

   The 400 above is the spent-code answer, which is the correct one — a code is
   spent exactly once, and that is the property the double-exchange guard in
   `SocialCallbackScreen` depends on.

5. **The link test's copy.** It asserts this app's sentence ("Your google
   account is attached to the account you were already signed in to. You are
   still signed in as you were — no new session was created"). If it fails on
   wording and not on behaviour, the failure is in the assertion, not the screen:
   `src/components/social/social-callback-screen.tsx` is where the copy is.

## Two decisions a human may want to revisit

- **`MINIMUM_TESTS` was NOT moved.** It is `2` in both readers
  (`tests/assert-e2e-ran.mjs` and `e2e/no-token-artifacts.ts`), and the suite
  now collects 26. That is a FLOOR, not a count, so adding tests cannot make it
  fail and raising it is a separate decision about what "the tier ran" means. The
  brief flagged this; the answer is that no move was required, and this is the
  sentence that records why.

- **16004/16005 overlap `site`'s defaults.** `site` publishes its registry on
  16004 and its stubs on 16005/16006. The two stacks are not simultaneously
  runnable on defaults — which was already true of 16003, 16080 and 16081 before
  this packet. If both ever need to run, `E2E_*_PORT` moves this one and nothing
  else changes. Said here rather than discovered.

## What was deliberately NOT done

- **No `pantry`.** `parlor`'s stack has none and this packet did not add one.
  `SIBLING_SERVICES` being three entries here and four in `site` is a fact about
  two topologies, not an omission.
- **No edit to any sibling.** `oauth-stub` was read and consumed as an image.
  Two instances was the answer to the one-client-pair problem precisely because
  the other two answers are a change to a repository this one may not modify.
- **No `MINIMUM_TESTS` move, and no weakening of any assertion to make a first
  run green.** If a social test fails, the question is which of the five items
  above it is.