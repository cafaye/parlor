import { describe, expect, it } from "vitest";

import { GET } from "./route";

/**
 * `/healthz`'s body, read as the shape `GET()` declares it writes.
 *
 * `Response.json()` is typed `Promise<any>`; the assertion is where that becomes
 * something a reader can check, which is what
 * `@typescript-eslint/no-unsafe-assignment` is pointing at on this one line.
 * Same helper, same reason, as `readyzBody` in `../readyz/route.test.ts`.
 */
async function healthzBody(): Promise<{ status: unknown }> {
  return (await GET().json()) as { status: unknown };
}

describe("GET /healthz", () => {
  it("returns 200", () => {
    expect(GET().status).toBe(200);
  });

  it("returns JSON with status ok", async () => {
    expect(await healthzBody()).toEqual({ status: "ok" });
  });

  it("is not cached by intermediaries", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
