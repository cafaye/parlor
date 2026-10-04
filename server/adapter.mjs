import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

/**
 * The Node-to-Web adapter, and nothing else. About forty lines, every one
 * load-bearing. It takes a `fetch`-shaped handler and returns a `node:http`
 * listener; it starts nothing and reads no environment, so
 * `server/adapter.test.ts` can exercise it without a build and without a port.
 *
 * The split exists for that reason alone. An entry that both listened and
 * imported the build output could not be tested on a clean checkout, because
 * `bin/prime` runs `npm test` BEFORE `npm run build` — and a test that needs a
 * build is a test that only runs on a machine somebody has already built on.
 * `server/index.mjs` is the part that needs the build; this file does not.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * `npm run build` emits `dist/server/server.mjs`, and that module does not
 * listen: it default-exports `{ fetch(request) }`, the Web-standard shape. The
 * build is the framework's; the socket is Node's, and nothing in this
 * repository connects the two.
 *
 * The framework does publish a preset for this (`@tanstack/nitro-v2-vite-plugin`),
 * and that is the better answer — it is maintained with the framework rather than
 * beside it. It is not used here because adopting it is a dependency decision,
 * and this repository's rule is that adding a dependency needs the manager. It
 * is also one minor version behind the router in `package.json`, which is worth
 * a deliberate answer rather than a quiet resolution. See
 * HANDOFF-parlor-tanstack-start.md.
 *
 * So: the adapter, no new dependency, and — the part that matters — a test per
 * property below, because this is the one place in the app where a byte is
 * translated between two runtimes and a mistake here is invisible until a
 * session stops surviving a reload.
 *
 * ---------------------------------------------------------------------------
 * `getSetCookie()`, NEVER `get()` — THE ONE THAT ACTUALLY BITES
 * ---------------------------------------------------------------------------
 * `Headers.get("set-cookie")` returns every cookie joined with ", ". That
 * string then lands inside a single cookie's `Expires` attribute and destroys
 * both. `src/lib/upstream.ts` carries the same rule and the same reason, and it
 * is repeated here because the fix is different in shape and identical in
 * substance: `getSetCookie()` is an array, one entry per cookie, and each is
 * written with its own `setHeader`.
 *
 * This app ships `__Host-session`, so a cookie that arrives mangled is a sign-in
 * that completes and then forgets. `server/index.test.ts` asserts a response
 * carrying two cookies produces two `Set-Cookie` headers.
 *
 * ---------------------------------------------------------------------------
 * WHY THE URL IS BUILT BY HAND
 * ---------------------------------------------------------------------------
 * A `Request` needs an absolute URL, and `req.url` is a path. The host comes
 * from the `Host` header — which is the right value here for a reason worth
 * stating, because this app has an allow-list elsewhere that ignores it: this is
 * the app's own socket, answering the browser that already reached it, and the
 * URL is only ever read for its path and query. It never selects a destination.
 * The forwarder in `src/lib/upstream.ts` is where a caller-supplied host would be
 * a vulnerability, and it is written to refuse.
 *
 * `x-forwarded-proto` is honoured for the scheme only, for the same reason
 * production sits behind a TLS-terminating proxy and without it every generated
 * URL would be `http://`.
 */
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade"]);

function requestUrl(req) {
  const host = req.headers.host ?? "localhost";
  const forwarded = req.headers["x-forwarded-proto"];
  const scheme = typeof forwarded === "string" && forwarded ? forwarded.split(",")[0].trim() : "http";
  return new URL(req.url ?? "/", `${scheme}://${host}`);
}

function toRequest(req) {
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const one of value) headers.append(name, one);
    } else {
      headers.set(name, value);
    }
  }

  return new Request(requestUrl(req), {
    method: req.method,
    headers,
    // `duplex: "half"` is required by the fetch spec whenever a body is a
    // stream, and its absence is a TypeError at construction — which would be a
    // 500 on every POST, so every sign-in, before anything reached the router.
    ...(hasBody ? { body: Readable.toWeb(req), duplex: "half" } : {}),
  });
}

async function writeResponse(res, response, method) {
  const cookies = response.headers.getSetCookie?.() ?? [];

  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "set-cookie") continue;
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    res.setHeader(name, value);
  }
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);

  // A HEAD response carries the headers of the GET and none of its body.
  if (method === "HEAD" || !response.body) {
    res.end();
    return;
  }

  for await (const chunk of Readable.fromWeb(response.body)) {
    if (!res.write(chunk)) {
      await new Promise((resolve) => res.once("drain", resolve));
    }
  }
  res.end();
}

/**
 * Where the built browser assets live, and how they are served.
 *
 * ---------------------------------------------------------------------------
 * MEASURED, NOT ASSUMED: THE SERVER DOES NOT SERVE THEM
 * ---------------------------------------------------------------------------
 * `dist/server/server.mjs` answers `/`, `/login`, `/healthz`, `/v1/*` and a
 * 404 for everything else. Asked for `/assets/index-*.css` — the URL its own
 * rendered HTML contains — it answers **404**. There is no static handler in
 * the build output and no `serveStatic` call anywhere in it.
 *
 * That is a silent failure of the best kind to catch and the worst kind to ship.
 * Every HTML page renders, every route answers, `/healthz` is green, so a
 * smoke test passes; what a person gets is a page with no stylesheet and no
 * hydration, which means the sign-in form submits into nothing. `bin/e2e` is the
 * tier that would measure it, and it is not in `bin/prime`.
 *
 * The previous framework served these itself from `.next/static`, which is why
 * nothing in this repository had to think about it and why the Dockerfile copied
 * that directory into the image separately. The equivalent here is below.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PATH IS RESOLVED AND THEN CHECKED AGAINST THE ROOT
 * ---------------------------------------------------------------------------
 * Because the request path is caller-supplied and this is the first place in the
 * process where a URL becomes a filesystem path. `resolve` collapses `..` and
 * the explicit prefix test rejects anything that still points outside the root —
 * so `%2e%2e%2f%2e%2e%2fetc%2fpasswd` is a 404 rather than a file read. The
 * filename itself is never interpolated into a shell or an import; it becomes
 * one argument to `createReadStream`.
 *
 * The hashed-filename convention is also why this is safe to be blunt about: a
 * request can only name a file that exists, and every file the build emits under
 * `assets/` is content-hashed and public by construction.
 */
const CLIENT_ROOT = resolve(process.cwd(), "dist/client");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** The asset's absolute path, or `null` if the request cannot name one. */
function assetPath(pathname, root = CLIENT_ROOT) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed percent-escape is not a file.
    return null;
  }
  if (decoded.includes("\0")) return null;

  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  return candidate;
}

/**
 * Serves a built asset if the path names one, and reports whether it did.
 *
 * `fingerprint` is the one judgement call: Vite writes content-hashed names, so
 * an asset is immutable and is safe to cache hard, while anything NOT under
 * `/assets/` — `favicon.ico`, `robots.txt`, anything a fork drops in `public/` —
 * is not fingerprinted and must not be. Getting that backwards in the unsafe
 * direction means a deploy that cannot replace a file; in the safe direction, a
 * deploy that serves a stale one. Immutable for hashed names is the correct
 * side to err on.
 */
async function serveAsset(req, res, pathname, root = CLIENT_ROOT) {
  const path = assetPath(pathname, root);
  if (path === null) return false;

  let size;
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    size = info.size;
  } catch {
    return false;
  }

  const type = CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  res.statusCode = 200;
  res.setHeader("content-type", type);
  res.setHeader("content-length", size);
  res.setHeader(
    "cache-control",
    pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
  );

  if ((req.method ?? "GET") === "HEAD") {
    res.end();
    return true;
  }

  await new Promise((done, fail) => {
    const stream = createReadStream(path);
    stream.on("error", fail);
    stream.on("end", done);
    stream.pipe(res);
  });
  return true;
}

export { assetPath, serveAsset };

/**
 * The listener.
 *
 * A built asset is answered from disk before the handler is consulted, because
 * the HTML the handler renders names those URLs and a 404 on one of them is
 * indistinguishable, to the person looking, from a broken deploy.
 */
export function createListener(handler, options = {}) {
  const root = options.clientRoot ?? CLIENT_ROOT;

  return createServer((req, res) => {
    // `requestUrl` already returns a parsed URL, so its `pathname` is
    // percent-encoded as the browser sent it. Decoding happens in `assetPath`,
    // once, on the value that becomes a path.
    const pathname = requestUrl(req).pathname;

    serveAsset(req, res, pathname, root).then(
      (served) => {
        if (served) return;
        dispatch(handler)(req, res);
      },
      () => dispatch(handler)(req, res),
    );
  });
}

function dispatch(handler) {
  return (req, res) => {
    const request = toRequest(req);

    // An aborted connection must not become an unhandled rejection: the browser
    // navigated away mid-response, which is ordinary, and a crash here takes the
    // process down for everyone else.
    const done = (error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode = 500;
      res.end("internal server error");
      if (error) console.error(error);
    };

    handler
      .fetch(request)
      .then((response) => writeResponse(res, response, req.method ?? "GET"))
      .catch(done);

    req.on("aborted", () => res.destroy());
  };
}

export { toRequest, writeResponse };