import handler from "../dist/server/server.mjs";

import { createListener } from "./adapter.mjs";

/**
 * The process entry. Everything interesting is in `server/adapter.mjs`, which
 * has its own tests; this file exists to bind the built handler to a port.
 *
 * `dist/server/server.mjs` is the output of `npm run build`, which is why it is
 * the only module here that a clean checkout cannot resolve — and why
 * `server/adapter.test.ts` does not import this file.
 *
 * `PORT` and `HOST` are read here rather than baked in, because
 * `config/deploy.yml` sets `PORT` and the image sets `HOSTNAME`; a build-time
 * value for either would be an environment-specific image, which is exactly what
 * the Dockerfile's own header refuses.
 */
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? process.env.HOSTNAME ?? "0.0.0.0";

createListener(handler).listen(port, host, () => {
  console.log(`parlor listening on http://${host}:${port}`);
});