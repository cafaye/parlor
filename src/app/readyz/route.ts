/**
 * Readiness probe.
 *
 * `deps: "none"` is a placeholder: the shell has no datastores or upstream
 * calls yet, so it is ready as soon as the process serves. Phase 2 swaps this
 * for a real dependency sweep (identity session store, billing, courier)
 * without changing the response shape — `deps` becomes an array of results.
 *
 * Shape reserved for cafaye's platform contract; see cafaye.yml.
 */
export function GET() {
  return Response.json(
    { status: "ok", deps: "none" },
    { headers: { "cache-control": "no-store" } },
  );
}
