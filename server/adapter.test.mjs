import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { createListener, toRequest, writeResponse } from "./adapter.mjs";

/**
 * The one place in this app where a byte is translated between runtimes.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE TESTS EXIST RATHER THAN A SMOKE TEST AGAINST A RUNNING SERVER
 * ---------------------------------------------------------------------------
 * Because the failure is silent and specific. Every property here has a way of
 * being wrong that a request to `localhost` still returns 200 for:
 *
 *   - `Headers.get("set-cookie")` instead of `getSetCookie()` joins every cookie
 *     with ", ", which lands inside one cookie's `Expires` and destroys both.
 *     The browser then drops the cookie and a sign-in that reported success
 *     leaves the person signed out on the next request. A smoke test that checks
 *     the status code passes; one that checks there are still TWO cookies does
 *     not.
 *   - A streaming request body without `duplex: "half"` throws a TypeError at
 *     `Request` construction — which is a 500 on every POST, so every sign-in,
 *     before the router is ever reached.
 *   - A forwarded body to a HEAD response hangs the connection instead of
 *     answering it.
 *
 * So each of those is asserted directly, and the two that involve a socket are
 * driven through a real `node:http` server on an ephemeral port rather than a
 * fake `IncomingMessage`, because the parts most likely to be wrong — stream
 * plumbing, header casing, cookie joining — are exactly the parts a hand-rolled
 * double gets right by construction.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE CAN RUN BEFORE A BUILD
 * ---------------------------------------------------------------------------
 * It imports `server/adapter.mjs` and not `server/index.mjs`. The latter pulls in
 * `dist/server/server.mjs`, which exists only after `npm run build`, and
 * `bin/prime` runs `npm test` before `npm run build`. A test that needs a build
 * is a test that only runs where somebody already built.
 */

/** A real `IncomingMessage`, hung off a socket the way Node does it. */
function incoming({ url = "/", method = "GET", headers = {}, body } = {}) {
  const socket = new Socket();
  const req = new IncomingMessage(socket);

  req.url = url;
  req.method = method;
  for (const [name, value] of Object.entries(headers)) {
    req.headers[name.toLowerCase()] = Array.isArray(value) ? value : String(value);
  }

  // `Readable.toWeb(req)` reads the stream, so the readable side has to be a
  // real one rather than an ended stub.
  if (body !== undefined) {
    req.push(body);
    req.push(null);
  } else {
    req.push(null);
  }

  return req;
}

/** A real `ServerResponse`, so header joining is Node's and not a guess. */
function outgoing() {
  const socket = new Socket();
  const res = new ServerResponse(new IncomingMessage(socket));
  const chunks = [];
  // `write` and `end` are replaced rather than spied on. `ServerResponse`
  // derives them from the socket, and a `Socket` that was never connected has
  // no writable side for them to write to — so capturing the bytes is not a
  // convenience here, it is the only way to see them without a port.
  res.write = (chunk) => {
    chunks.push(chunk);
    return true;
  };
  res.end = (chunk) => {
    if (chunk) chunks.push(chunk);
    res.ended = true;
    return res;
  };
  Object.defineProperty(res, "chunks", { get: () => chunks });
  return res;
}

describe("request construction", () => {
  it("reads the path and query off the Host header into an absolute URL", () => {
    const req = incoming({ url: "/login?token=abc", headers: { host: "example.test" } });

    expect(toRequest(req).url).toBe("http://example.test/login?token=abc");
  });

  it("honours x-forwarded-proto, because production sits behind a TLS proxy", () => {
    const req = incoming({
      url: "/",
      headers: { host: "example.test", "x-forwarded-proto": "https" },
    });

    expect(toRequest(req).url.startsWith("https://")).toBe(true);
  });

  it("takes the first value when a proxy chain appends", () => {
    const req = incoming({
      url: "/",
      headers: { host: "example.test", "x-forwarded-proto": "https, http" },
    });

    expect(toRequest(req).url.startsWith("https://")).toBe(true);
  });

  it("carries a body on a POST, streamed", () => {
    // The assertion that matters: constructing the Request at all. A missing
    // `duplex: "half"` throws here, which is a 500 on every POST in the app.
    const req = incoming({ url: "/v1/session", method: "POST", body: "email=a@b.c" });

    expect(toRequest(req).method).toBe("POST");
  });

  it("sends no body on a GET, which a Request refuses to accept one for", () => {
    expect(() => toRequest(incoming({ method: "GET", body: "ignored" }))).not.toThrow();
  });

  it("passes a header through with its name case-insensitively intact", () => {
    const req = incoming({ headers: { host: "example.test", "content-type": "application/json" } });

    expect(toRequest(req).headers.get("Content-Type")).toBe("application/json");
  });

  it("does not forward a hop-by-hop header, which is a connection's not a message's", () => {
    const req = incoming({ headers: { host: "example.test", connection: "keep-alive" } });

    expect(toRequest(req).headers.get("connection")).toBeNull();
  });

  it("keeps every value of a repeated header", () => {
    const req = incoming({ headers: { host: "example.test", "x-thing": ["a", "b"] } });

    expect(toRequest(req).headers.getSetCookie()).toEqual([]);
    expect(toRequest(req).headers.get("x-thing")).toBe("a, b");
  });
});

describe("response writing", () => {
  it("emits one Set-Cookie header per cookie", async () => {
    const res = outgoing();
    const response = new Response("ok", {
      headers: [
        ["set-cookie", "__Host-session=abc; Path=/; Secure; HttpOnly"],
        ["set-cookie", "other=1; Path=/"],
      ],
    });

    await writeResponse(res, response, "GET");

    // The whole reason this file exists. `headers.get("set-cookie")` returns
    // these joined with ", ", and the joined string lands inside the first
    // cookie's Expires and destroys both.
    expect(res.getHeader("set-cookie")).toEqual([
      "__Host-session=abc; Path=/; Secure; HttpOnly",
      "other=1; Path=/",
    ]);
  });

  it("carries a plain header without inventing a cookie", async () => {
    const res = outgoing();

    await writeResponse(res, new Response("ok", { headers: { "content-type": "text/plain" } }), "GET");

    expect(res.getHeader("content-type")).toBe("text/plain");
    expect(res.getHeader("set-cookie")).toBeUndefined();
  });

  it("answers a HEAD with the status and none of the body", async () => {
    const res = outgoing();
    // A 200 rather than a 204: a 204 is null-body status, so the Response
    // constructor refuses to attach a body to one and this test would assert
    // nothing about the code that drops the bytes. The claim under test is
    // "a HEAD gets the headers of a GET and none of its body", and a GET has a
    // body.
    await writeResponse(res, new Response("a body that must not be sent"), "HEAD");

    expect(res.statusCode).toBe(200);
    expect(res.chunks).toEqual([]);
  });

  it("sends the body on a GET", async () => {
    const res = outgoing();

    await writeResponse(res, new Response("parlor"), "GET");

    expect(res.chunks.join("")).toBe("parlor");
  });

  it("passes an upstream status through, so a 401 cannot render as a success", async () => {
    const res = outgoing();

    await writeResponse(res, new Response("nope", { status: 401 }), "GET");

    expect(res.statusCode).toBe(401);
  });
});

describe("the listener", () => {
  /** Ask the adapter's own server something, and read the real response. */
  async function ask(handler, request) {
    const server = createListener(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
      const response = await fetch(`http://127.0.0.1:${port}${request.path}`, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
      });
      return { status: response.status, headers: response.headers, body: await response.text() };
    } finally {
      server.close();
    }
  }

  it("gives the handler a URL whose path is the one that was requested", async () => {
    const seen = [];
    const answer = await ask(
      { fetch: async (request) => {
        seen.push(request.url);
        return new Response("ok");
      } },
      { path: "/billing/plans?page=2" },
    );

    expect(answer.status).toBe(200);
    expect(new URL(seen[0]).pathname).toBe("/billing/plans");
    expect(new URL(seen[0]).search).toBe("?page=2");
  });

  it("delivers a POST body to the handler", async () => {
    const answer = await ask(
      { fetch: async (request) => new Response(await request.text()) },
      { path: "/v1/session", method: "POST", body: "email=a@b.c" },
    );

    expect(answer.body).toBe("email=a@b.c");
  });

  it("answers 500 rather than crashing the process when the handler throws", async () => {
    // The failure a crashed listener turns into: one request nobody can parse
    // takes the process down for everybody else, and `Dockerfile`'s HEALTHCHECK
    // reports the container as unhealthy with no log explaining it.
    const answer = await ask(
      {
        fetch: async () => {
          throw new Error("upstream is on fire");
        },
      },
      { path: "/login" },
    );

    expect(answer.status).toBe(500);
  });

  it("survives a session cookie across a real socket", async () => {
    // End to end through the adapter, because the join happens between the two
    // runtimes and neither unit above can see it: a handler sets a cookie, and
    // the client has to receive a cookie it can send back.
    const answer = await ask(
      { fetch: async () => new Response("ok", { headers: { "set-cookie": "__Host-session=abc; Path=/; Secure; HttpOnly" } }) },
      { path: "/login" },
    );

    expect(answer.headers.getSetCookie()).toEqual([
      "__Host-session=abc; Path=/; Secure; HttpOnly",
    ]);
  });
});