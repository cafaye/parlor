import { createFileRoute } from "@tanstack/react-router";

import { GET as readyz } from "@/app/readyz/route";

/**
 * `/readyz` — the readiness probe.
 *
 * A different probe from `/healthz` on purpose. This one answers "should traffic
 * be sent here", and it is the path the rollout gate in `config/deploy.yml`
 * polls, while `/healthz` is the restart check. Keeping the two apart is what
 * stops a slow dependency from restarting a healthy process — and it is why
 * `deps: "none"` is a reserved placeholder string rather than a convenience:
 * when a real check is wired in it becomes an array, and `src/app/readyz/route.test.ts`
 * reads the path out of `config/deploy.yml` so the config and the app cannot
 * drift apart.
 *
 * A real dependency check is its own packet. Nothing here has changed shape,
 * and the response keys are the platform contract's (see `anywaye.yml`).
 */
export const Route = createFileRoute("/readyz")({
  server: {
    handlers: {
      GET: readyz,
    },
  },
});