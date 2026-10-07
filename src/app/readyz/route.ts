/**
 * Readiness probe.
 *
 * A real dependency sweep, in the shape this route's header reserved: `deps`
 * is an array of results, one per dependency this deployment actually has.
 *
 * WHAT THE LAUNCH STACK HAS, which is not the same as what this app could
 * have. identity is required — the launch deploys it and a sign-in is the one
 * thing this app exists to serve — so it is always probed, and an
 * unreachable identity means not ready. billing is probed only when
 * `BILLING_URL` is set: the launch stack deploys no billing, and an
 * unconfigured dependency is not a failed one. Failing open was the bug this
 * packet removes — a rollout gate that accepts a container which cannot
 * reach identity is a liveness gate wearing a readiness label.
 *
 * BOUNDED, because a probe that hangs is worse than one that fails. Each
 * probe carries a short timeout, and every kind of failure — timeout,
 * refusal, a non-2xx answer — is a dependency that is not ok. The bound is
 * also what keeps the rollout itself bounded: kamal-proxy's healthcheck has
 * its own timeout, and a dependency that stops answering must fail the
 * rollout rather than stall it.
 *
 * The addresses are read here rather than imported from the forwarder's
 * module (`src/app/v1/[...path]/route.ts`) on purpose. That reader throws in
 * production when `IDENTITY_URL` is unset, which is right for a module that
 * cannot serve a sign-in without identity and wrong for a probe: a probe
 * that cannot name its target reports the dependency as failed, which is the
 * answer an orchestrator acts on. The two readers agree on the variable
 * name, the trim and the trailing slash; they differ only in what an unset
 * value means, and that difference is the point.
 *
 * Shape reserved for cafaye's platform contract; see cafaye.yml.
 */

/** How long one dependency gets to answer. Short, and well under any proxy's own probe timeout. */
const PROBE_TIMEOUT_MS = 2000;

/** One dependency's result. `ok` is the whole verdict; a reason would be a host or a port. */
type DepResult = { name: string; ok: boolean };

/**
 * Probe one dependency's own `/readyz`.
 *
 * `null` address means "not configured", which is not-ok rather than an
 * exception: the launch stack deploys no billing, so an absent address is a
 * real deployment state, and identity's absence is a misconfiguration the
 * rollout gate exists to catch. Both are the same verdict — this dependency
 * is not ready — and the response's `deps` array says which one was probed.
 */
async function probe(name: string, address: string | null): Promise<DepResult> {
  if (address === null) return { name, ok: false };
  try {
    const response = await fetch(`${address}/readyz`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    return { name, ok: response.ok };
  } catch {
    return { name, ok: false };
  }
}

export async function GET() {
  const identityUrl = (process.env.IDENTITY_URL?.trim() ?? "").replace(/\/+$/, "");
  const billingUrl = (process.env.BILLING_URL?.trim() ?? "").replace(/\/+$/, "");

  // identity first and always: required. billing joins the sweep only when it
  // is configured, so on the launch stack this array has exactly one entry —
  // which is the honest shape of that deployment rather than a gap in it.
  const probes: Promise<DepResult>[] = [probe("identity", identityUrl === "" ? null : identityUrl)];
  if (billingUrl !== "") {
    probes.push(probe("billing", billingUrl));
  }
  // Together, not in sequence: two dependencies that each take the full
  // timeout would spend twice the bound on one rollout decision.
  const deps = await Promise.all(probes);

  const ok = deps.every((dep) => dep.ok);
  return Response.json(
    { status: ok ? "ok" : "unavailable", deps },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
