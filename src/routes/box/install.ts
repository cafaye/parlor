import { createFileRoute } from "@tanstack/react-router";

import { GET as install } from "@/app/box/install-route";

/**
 * `/box/install` — the `curl | sh` front door.
 *
 * A server handler and nothing else: no `component`, for the reason
 * `healthz.ts` gives — a byte endpoint a supervisor and a curl both hit must
 * never pay for a session read or a stylesheet.
 *
 * The bytes are kit's, vendored and guarded. `src/app/box/install-route.ts`
 * serves them; `src/app/box/install-drift.test.ts` proves they are kit's.
 */
export const Route = createFileRoute("/box/install")({
  server: {
    handlers: {
      GET: install,
    },
  },
});
