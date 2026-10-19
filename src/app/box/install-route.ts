// The bytes kit publishes, imported rather than pasted.
//
// `?raw` because these bytes are served, not executed here: the whole point of
// `curl | sh` is that the operator runs what arrived, so a transform — a
// template, a concatenation, a comment banner — is a Worker that installs
// something nobody reviewed. Vite inlines the file's exact bytes at build
// time, and `install-drift.test.ts` asserts they equal kit's.
import installScript from "./install.sh?raw";

/**
 * `GET /box/install` — the install front door.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * kit's customer substrate, served at the address the plan makes permanent
 * (stability rule 3): `cafaye.com/box/install`. `curl https://cafaye.com/box/install | sh`
 * is the one command that takes a bare box to a running stack, and CI scripts
 * will embed it, so the path is settled and this file is what serves it.
 *
 * The route that used to serve these bytes was kit's own Worker binding on
 * `kit.cafaye.com`. That host is retired by the plan, so the front door moved
 * here — same bytes, one host fewer. What does NOT change is whose bytes they
 * are: kit's `templates/substrate/install.sh` stays the single source of
 * truth, this repository vendors a copy, and the guard beside it compares the
 * two byte for byte.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO COMPONENT AND NO PARAMETER
 * ---------------------------------------------------------------------------
 * The route declares a handler and no `component`, the same shape
 * `healthz.ts` and `readyz.ts` use, and the reason is the same: this is a byte
 * endpoint a supervisor and a curl both hit, and a render pass here would put
 * a session read and a stylesheet in front of the one request that must never
 * pay for either.
 *
 * There is also nothing to vary. No `?v=`, no range, no format negotiation —
 * `curl | sh` asks for the script and gets the script. A parameter that
 * changed the bytes would be a second front door nobody reviewed.
 */
export function GET(): Response {
  return new Response(installScript, {
    status: 200,
    headers: {
      // The script's own type, which is also a statement of intent: this
      // response is a program, not a page.
      "content-type": "text/x-shellscript; charset=utf-8",
      // Not cached by a shared proxy or a CDN edge. A stale install script is
      // a box that installs the previous substrate, and the failure looks like
      // nothing at all.
      "cache-control": "no-store",
    },
  });
}
