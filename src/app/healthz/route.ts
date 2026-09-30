/**
 * Liveness probe.
 *
 * "Can this process serve traffic at all?" — no dependency checks here, so a
 * failing downstream service never takes the container out of the load
 * balancer. Readiness (dependency-aware) lives at /readyz.
 *
 * Shape reserved for cafaye's platform contract; see cafaye.yml.
 */
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
